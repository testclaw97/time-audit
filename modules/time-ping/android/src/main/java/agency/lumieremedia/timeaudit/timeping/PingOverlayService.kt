package agency.lumieremedia.timeaudit.timeping

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.core.content.ContextCompat

/**
 * The UNLOCKED / in-use ping surface. Draws the [ChooserUi] chooser as a full-screen
 * TYPE_APPLICATION_OVERLAY window from a foreground service — NOT via an Activity start.
 *
 * WHY a service + overlay window and not just start [PingActivity]:
 *   On Android 14/15 a full-screen INTENT posted from a background AlarmManager broadcast is
 *   subject to the background-activity-launch restriction, so while the phone is unlocked and in
 *   use the OS silently degrades the FSI to a heads-up notification and the chooser never covers
 *   the screen (the confirmed real-device bug). SYSTEM_ALERT_WINDOW ("Display over other apps")
 *   is NOT subject to that restriction: an overlay window drawn from a foreground service paints
 *   over whatever app is in front, every time — exactly how Mr. Productive's block screen works.
 *
 * The locked / screen-off case still uses the FSI → [PingActivity] path (an overlay can't draw
 * over a secure keyguard; an Activity with setShowWhenLocked can) — [PingReceiver.fire] routes
 * between the two by device state.
 *
 * Robustness is paramount: this window sits ON TOP of the user's phone, so a stuck window would
 * be a trap. Every entry point is try/caught and the service tears the window down + releases
 * its wakelock in onDestroy, so it can never wedge the screen.
 */
class PingOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Come up as a foreground service FIRST (API 34+ demands startForeground within the
        // grace window) — everything else is best-effort and guarded.
        try {
            startAsForeground()
        } catch (_: Throwable) {
            // If we can't even foreground, don't linger as a zombie.
            stopSelfSafely()
            return START_NOT_STICKY
        }

        val slotStart = try {
            intent?.getLongExtra(EXTRA_SLOT_START, 0L)?.takeIf { it > 0L }
                ?: System.currentTimeMillis()
        } catch (_: Throwable) {
            System.currentTimeMillis()
        }

        // Nudge the screen on (a ping while the display has just dimmed should still be seen).
        acquireWake()
        // Draw the chooser. If we can't (no overlay permission, addView threw), give up cleanly
        // rather than sit as an invisible foreground service.
        if (!drawOverlay(slotStart)) {
            stopSelfSafely()
        }

        // START_NOT_STICKY: this is a transient popup, not a long-running guard. If Android kills
        // it, there is nothing to resurrect — the next scheduled alarm arms the next ping.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    // --- overlay window ----------------------------------------------------------------

    /** Draw the chooser as a full-screen overlay window. Returns false if it couldn't be shown. */
    private fun drawOverlay(slotStart: Long): Boolean {
        // Lost / never had the overlay permission → we simply can't draw. Bail (the FSI path in
        // PingReceiver is the fallback for that case anyway; routing shouldn't have sent us here).
        val canDraw = try {
            Settings.canDrawOverlays(this)
        } catch (_: Throwable) {
            false
        }
        if (!canDraw) return false

        val wm = try {
            (getSystemService(Context.WINDOW_SERVICE) as? WindowManager)
        } catch (_: Throwable) {
            null
        } ?: return false
        windowManager = wm

        // Fresh window every time (defensive — a stale one shouldn't exist for a transient svc).
        removeOverlay()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        // Focusable + touchable (no NOT_FOCUSABLE / NOT_TOUCHABLE) so the chips receive taps —
        // same approach as BlockerService. TURN_SCREEN_ON + SHOW_WHEN_LOCKED + DISMISS_KEYGUARD
        // wake/surface the window if the display was just dimming; KEEP_SCREEN_ON stops it
        // dimming out mid-decision. OPAQUE so the app underneath doesn't bleed through.
        @Suppress("DEPRECATION")
        val flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            flags,
            PixelFormat.OPAQUE
        )
        params.gravity = Gravity.CENTER

        val view = try {
            ChooserUi.build(
                ctx = this,
                slotStart = slotStart,
                onPick = { categoryId -> onPick(slotStart, categoryId) },
                onOther = { onOther(slotStart) },
                onSkip = { onSkip() }
            )
        } catch (_: Throwable) {
            return false
        }

        return try {
            wm.addView(view, params)
            overlayView = view
            true
        } catch (_: Throwable) {
            overlayView = null
            false
        }
    }

    private fun removeOverlay() {
        val v = overlayView ?: return
        try {
            windowManager?.removeView(v)
        } catch (_: Throwable) {
            // Already detached — ignore.
        }
        overlayView = null
    }

    // --- chip callbacks ----------------------------------------------------------------

    /** A real category was tapped: record it for the slot, then dismiss. */
    private fun onPick(slotStart: Long, categoryId: String) {
        try {
            PingStore.addPendingLog(this, slotStart, categoryId, System.currentTimeMillis())
        } catch (_: Throwable) {
        }
        teardown()
        stopSelfSafely()
    }

    /** "Other": record the sentinel (JS opens a custom-label prompt on drain) + open the app. */
    private fun onOther(slotStart: Long) {
        try {
            PingStore.addPendingLog(this, slotStart, ChooserUi.OTHER_SENTINEL, System.currentTimeMillis())
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                launch.putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                startActivity(launch)
            }
        } catch (_: Throwable) {
        }
        teardown()
        stopSelfSafely()
    }

    /** "Skip": record nothing, just dismiss. */
    private fun onSkip() {
        teardown()
        stopSelfSafely()
    }

    // --- lifecycle plumbing ------------------------------------------------------------

    /** Remove the window + release the wakelock. Idempotent; every step guarded. */
    private fun teardown() {
        removeOverlay()
        releaseWake()
    }

    private fun stopSelfSafely() {
        try {
            stopSelf()
        } catch (_: Throwable) {
        }
    }

    // --- wakelock ----------------------------------------------------------------------

    /**
     * Briefly wake / brighten the screen so a ping that lands while the display has just dimmed
     * is actually seen. SCREEN_BRIGHT + ACQUIRE_CAUSES_WAKEUP turns it on; ON_AFTER_RELEASE keeps
     * it up a beat after we release; a ~30s timeout is a hard backstop so a leaked lock can never
     * pin the screen on. (These flags are deprecated but remain the only way to wake the display
     * from a background component; the overlay window's own FLAG_TURN_SCREEN_ON complements it.)
     */
    private fun acquireWake() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            @Suppress("DEPRECATION")
            val lock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                WAKE_TAG
            )
            lock.setReferenceCounted(false)
            lock.acquire(WAKE_TIMEOUT_MS)
            wakeLock = lock
        } catch (_: Throwable) {
        }
    }

    private fun releaseWake() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Throwable) {
        }
        wakeLock = null
    }

    // --- foreground-service plumbing ---------------------------------------------------

    private fun startAsForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm != null && nm.getNotificationChannel(PingStore.OVERLAY_CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    PingStore.OVERLAY_CHANNEL_ID,
                    "Time-audit check-in",
                    NotificationManager.IMPORTANCE_LOW // silent, no heads-up — the overlay IS the UI
                )
                channel.description = "Briefly shown while the category chooser is on screen."
                nm.createNotificationChannel(channel)
            }
        }

        val notification: Notification =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, PingStore.OVERLAY_CHANNEL_ID)
                    .setContentTitle("What are you doing right now?")
                    .setContentText("Tap a category to log this moment.")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
                    .setContentTitle("What are you doing right now?")
                    .setContentText("Tap a category to log this moment.")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .build()
            }

        // API 34+ requires the FGS type at start-time AND that it match the manifest (specialUse).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                PingStore.OVERLAY_NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(PingStore.OVERLAY_NOTIF_ID, notification)
        }
    }

    companion object {
        private const val EXTRA_SLOT_START = PingStore.EXTRA_SLOT_START
        private const val WAKE_TAG = "timeaudit:ping-overlay"
        private const val WAKE_TIMEOUT_MS = 30_000L

        /**
         * Start the overlay service to show the chooser for [slotStart]. Uses
         * startForegroundService so the OS grants the FGS start; the service itself calls
         * startForeground immediately in onStartCommand. Fully guarded — a failed start must
         * never crash the caller (an alarm receiver).
         */
        fun show(ctx: Context, slotStart: Long) {
            try {
                val i = Intent(ctx, PingOverlayService::class.java)
                    .putExtra(EXTRA_SLOT_START, slotStart)
                ContextCompat.startForegroundService(ctx, i)
            } catch (_: Throwable) {
                // Best-effort: if we can't start the service, the caller may still fall back.
            }
        }
    }
}
