package agency.lumieremedia.timeaudit.timeping

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * The ONE persistent foreground service that owns the whole ping surface. It replaces the old
 * transient PingOverlayService (one-shot service per ping) with a SINGLE long-lived process
 * anchor — modelled on Mr. Productive's BlockerService (startAsForeground + overlay window +
 * START_STICKY).
 *
 * WHY persistent, and why this is the real-device fix:
 *
 *   The confirmed failure on Samsung/Xiaomi Android 14/15 was that a ping fired from a background
 *   AlarmManager broadcast tried to surface UI from a dead/background process. Three things bite
 *   there: (1) a full-screen INTENT only launches its Activity when the phone is LOCKED — while
 *   the phone is in use the OS degrades it to a bare heads-up, so "nothing pops up"; (2) on
 *   Android 14+ USE_FULL_SCREEN_INTENT is auto-revoked until the user grants it; (3) OEMs
 *   aggressively kill work kicked off from a background alarm. The cure is to keep a live,
 *   foregrounded process ALWAYS running while tracking is on, so every ping has a warm
 *   WindowManager/overlay context to render from immediately — no cold background start.
 *
 * The service does NOT keep any in-process timer for cadence. The CPU is frozen in Doze; a
 * Handler would drift and double-fire. Cadence comes ONLY from the self-rescheduling exact alarm
 * in [PingScheduler]; this service just RENDERS when [PingReceiver] pokes it via [ACTION_RENDER].
 *
 * Command surface (see [onStartCommand]):
 *   · [PingStore.ACTION_START]  — come up foreground + ensure the next alarm is armed. This is
 *                                 also what a START_STICKY restart (null intent) is treated as.
 *   · [PingStore.ACTION_RENDER] — render a check-in NOW for the carried slotStart.
 *   · [PingStore.ACTION_STOP]   — tear the overlay down, stopForeground, stopSelf.
 *
 * Robustness is paramount — this process holds a window that can sit on top of the phone. Every
 * entry point is try/caught; a failed ping must never crash the host app or wedge the screen.
 */
class PingService : Service() {

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        // Flip the liveness flag the moment the process anchor exists so `isEngineRunning()` can
        // report engine health to the JS layer (see [TimePingModule] + the companion flag).
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Come up as a foreground service FIRST — API 34+ demands startForeground() within the
        // grace window regardless of which action we're handling. If we can't even foreground,
        // don't linger as a zombie (but this is the persistent engine, so this should be rare).
        try {
            startAsForeground()
        } catch (_: Throwable) {
            stopSelfSafely()
            return START_NOT_STICKY
        }

        // A null intent means the OS re-created us after a kill (START_STICKY redelivery). Treat
        // that exactly like ACTION_START: re-anchor foreground (already done) and re-arm the next
        // alarm, so an OEM kill self-heals into a running engine again.
        val action = intent?.action ?: PingStore.ACTION_START

        try {
            when (action) {
                PingStore.ACTION_STOP -> {
                    // Tracking was turned off (or cancelAll). Drop the overlay, leave foreground,
                    // and stop. Nothing to resurrect — the alarm is cancelled by the scheduler.
                    teardown()
                    stopForegroundCompat()
                    stopSelfSafely()
                    return START_NOT_STICKY
                }

                PingStore.ACTION_RENDER -> {
                    val slotStart = try {
                        intent?.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)?.takeIf { it > 0L }
                            ?: System.currentTimeMillis()
                    } catch (_: Throwable) {
                        System.currentTimeMillis()
                    }
                    val isTest = try {
                        intent?.getBooleanExtra(PingStore.EXTRA_TEST, false) ?: false
                    } catch (_: Throwable) {
                        false
                    }
                    render(slotStart, isTest)
                }

                else -> {
                    // ACTION_START (or a redelivered null intent): just stay foreground and make
                    // sure a "next boundary" alarm exists. Idempotent — scheduleNext uses the
                    // single REQ_CHAIN slot, so calling it repeatedly can't stack alarms.
                    try {
                        PingScheduler.scheduleNext(this)
                    } catch (_: Throwable) {
                    }
                }
            }
        } catch (_: Throwable) {
            // A failed command must never crash the app or drop the engine.
        }

        // START_STICKY: this is the always-on engine. If Android kills it under memory pressure,
        // let it restart (with a null intent, handled as ACTION_START above) so tracking self-heals.
        return START_STICKY
    }

    override fun onDestroy() {
        // Never leave a window on top of the phone. Clear the flag last so `isEngineRunning()`
        // flips false only once we're actually gone.
        try {
            teardown()
        } catch (_: Throwable) {
        }
        isRunning = false
        super.onDestroy()
    }

    // --- the check-in surface (belt-and-suspenders) ------------------------------------

    /**
     * Render a check-in for [slotStart]. The reliability contract, in order:
     *
     *   d. SNOOZE — if a pause horizon is active ([PingStore.getPausedUntil] > now) and this is
     *      not a manual test, render is a NO-OP: no notice, no overlay. (The alarm still re-armed
     *      in [PingReceiver], so cadence resumes automatically once the snooze passes.)
     *
     *   a. FLOOR — ALWAYS post the HIGH-importance check-in notification ([PingStore.CHANNEL_CHECKIN]),
     *      with up to 4 category quick-action buttons (each broadcasts [PingStore.ACTION_PICK] to
     *      record a PendingLog with NO special permission — this path must never fail) and a
     *      contentIntent that opens the app to this slot. This is the floor: even if the overlay
     *      and FSI are both unavailable, the user can still log from the heads-up / shade.
     *
     *   b. UPGRADE (unlocked & interactive & canDrawOverlays) — ALSO draw the full-screen
     *      [ChooserUi] overlay window from THIS live service (no Activity start, no background-
     *      activity-launch). A chip tap records the log, removes the overlay and cancels the floor.
     *
     *   c. UPGRADE (locked / screen-off / no overlay) — instead attach setFullScreenIntent(→
     *      [PingActivity], true) to that SAME floor notification, so it launches the chooser over
     *      the keyguard when FSI is granted; if it isn't granted it harmlessly stays a heads-up.
     *
     * Note the floor is posted in every branch; b and c only decide the UPGRADE layered on top.
     */
    private fun render(slotStart: Long, isTest: Boolean) {
        try {
            // d. snooze gate --------------------------------------------------------------
            if (!isTest && PingStore.getPausedUntil(this) > System.currentTimeMillis()) {
                return
            }

            // Decide the upgrade path from device state. All reads guarded — a thrown service call
            // must degrade to the floor, never abort the whole render.
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val interactive = try { pm?.isInteractive ?: false } catch (_: Throwable) { false }
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            val locked = try { km?.isKeyguardLocked ?: false } catch (_: Throwable) { false }
            val canOverlay = try { Settings.canDrawOverlays(this) } catch (_: Throwable) { false }

            val useOverlay = canOverlay && interactive && !locked

            // Lock-screen popup preference: does the user allow a LOCKED-screen ping to take over the
            // keyguard with the full-screen chooser? Read from the persisted params (this may run with
            // no JS process). Defaults ON. Only gates the locked branch; the overlay branch is
            // unaffected (it never attaches an FSI anyway).
            val lockScreenPopup = try { PingStore.getLockScreenPopup(this) } catch (_: Throwable) { true }

            // a + c. Always post the floor. Attach the FSI ONLY on the locked / screen-off / no-overlay
            // case (!useOverlay) AND only when the user permits a lock-screen takeover. When the popup
            // is disabled a locked-screen ping stays just the floor notification — no full-screen
            // takeover of the keyguard — while the unlocked/overlay branch below is untouched.
            postCheckinNotification(slotStart, withFullScreen = !useOverlay && lockScreenPopup)

            // b. Unlocked & in use & permitted → also draw the overlay window from this live svc.
            if (useOverlay) {
                acquireWake()
                drawOverlay(slotStart)
                // If drawOverlay fails, the floor notice already posted above still stands.
            }
        } catch (_: Throwable) {
            // Best-effort: a failed ping must not take anything else down.
        }
    }

    /**
     * The reliability FLOOR: a HIGH-importance check-in notification. Up to 4 category quick
     * actions broadcast [PingStore.ACTION_PICK] (a permission-free, cannot-fail log path), the tap
     * body opens the app to this slot, and — when [withFullScreen] — a full-screen intent launches
     * [PingActivity] over the keyguard. Stable id [PingStore.CHECKIN_NOTIF_ID]: one live ping at a
     * time; a new ping replaces the old.
     */
    private fun postCheckinNotification(slotStart: Long, withFullScreen: Boolean) {
        ensureCheckinChannel()

        // Tap-body / full-screen target: PingActivity (paints the same ChooserUi over the lock
        // screen). Carrying the slot so a late tap still lands on the correct slot, never "now".
        val activityIntent = Intent(this, PingActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(PingStore.EXTRA_SLOT_START, slotStart)
        }
        val activityPI = PendingIntent.getActivity(
            this, REQ_FSI, activityIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val builder = NotificationCompat.Builder(this, PingStore.CHANNEL_CHECKIN)
            .setContentTitle("What are you doing right now?")
            .setContentText("Tap a category to log this moment.")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOngoing(false)
            .setContentIntent(activityPI)

        // c. Only the locked / no-overlay branch gets the full-screen intent. When FSI is granted
        // it launches PingActivity over the keyguard; when it isn't (Android 14+ auto-revoke) the
        // notice harmlessly stays a HIGH heads-up — still the floor, never lost.
        if (withFullScreen) {
            builder.setFullScreenIntent(activityPI, true)
        }

        // Up to 4 one-tap category buttons. WHY: this ACTION_PICK path needs NO special permission
        // (no overlay, no FSI, no exact-alarm) — it is the guaranteed way to log even when every
        // upgrade is unavailable, so it must never fail.
        try {
            val cats = PingStore.getCategories(this)
            for ((i, cat) in cats.take(4).withIndex()) {
                val pickIntent = Intent(this, PingReceiver::class.java).apply {
                    action = PingStore.ACTION_PICK
                    putExtra(PingStore.EXTRA_CATEGORY, cat.id)
                    putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                }
                val pickPI = PendingIntent.getBroadcast(
                    this, REQ_PICK_BASE + i, pickIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                builder.addAction(0, "${cat.emoji} ${cat.label}", pickPI)
            }
        } catch (_: Throwable) {
            // Even with no category buttons the notice still surfaces the question + opens the app.
        }

        // On Android 13+ this silently no-ops without POST_NOTIFICATIONS (the correct degrade;
        // the app requests that permission in onboarding).
        try {
            NotificationManagerCompat.from(this).notify(PingStore.CHECKIN_NOTIF_ID, builder.build())
        } catch (_: Throwable) {
        }
    }

    /** The HIGH-importance check-in channel — required for heads-up AND for the FSI to launch. */
    private fun ensureCheckinChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(PingStore.CHANNEL_CHECKIN) != null) return
        val channel = NotificationChannel(
            PingStore.CHANNEL_CHECKIN,
            "Time-audit check-ins",
            NotificationManager.IMPORTANCE_HIGH
        )
        channel.description = "The 15-minute prompt asking what you're doing right now."
        channel.setBypassDnd(false)
        nm.createNotificationChannel(channel)
    }

    // --- overlay window (reused from the old PingOverlayService, drawn from the live svc) ---

    /** Draw the [ChooserUi] as a full-screen overlay window. Returns false if it couldn't show. */
    private fun drawOverlay(slotStart: Long): Boolean {
        val canDraw = try { Settings.canDrawOverlays(this) } catch (_: Throwable) { false }
        if (!canDraw) return false

        val wm = try {
            getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        } catch (_: Throwable) {
            null
        } ?: return false
        windowManager = wm

        // Fresh window every time — a stale overlay from a previous ping shouldn't linger.
        removeOverlay()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        // Focusable + touchable (no NOT_FOCUSABLE / NOT_TOUCHABLE) so the chips receive taps.
        // TURN_SCREEN_ON + SHOW_WHEN_LOCKED + DISMISS_KEYGUARD wake/surface the window if the
        // display was just dimming; KEEP_SCREEN_ON stops it dimming out mid-decision; OPAQUE so
        // the app underneath doesn't bleed through. LAYOUT_IN_SCREEN + LAYOUT_NO_LIMITS make the
        // window fill the ENTIRE screen (including behind the status bar) — the chooser must
        // cover the whole screen, same as Mr. Productive's block screen.
        @Suppress("DEPRECATION")
        val flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS

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

    // --- chip callbacks (persistent svc: dismiss the surface, but STAY ALIVE) -----------

    /** A real category was tapped: record it, remove the overlay, cancel the floor notice. */
    private fun onPick(slotStart: Long, categoryId: String) {
        try {
            PingStore.addPendingLog(this, slotStart, categoryId, System.currentTimeMillis())
        } catch (_: Throwable) {
        }
        dismissSurface()
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
        dismissSurface()
    }

    /** "Skip": record nothing, just dismiss the surface. */
    private fun onSkip() {
        dismissSurface()
    }

    /**
     * Take the check-in surface down — overlay window, wakelock and floor notice — WITHOUT
     * stopping the service. Unlike the old transient service, the persistent engine stays alive
     * for the next ping; only the momentary surface goes away.
     */
    private fun dismissSurface() {
        removeOverlay()
        releaseWake()
        try {
            NotificationManagerCompat.from(this).cancel(PingStore.CHECKIN_NOTIF_ID)
        } catch (_: Throwable) {
        }
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

    private fun stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Throwable) {
        }
    }

    // --- wakelock ----------------------------------------------------------------------

    /**
     * Briefly wake / brighten the screen so a ping that lands while the display has just dimmed is
     * actually seen. SCREEN_BRIGHT + ACQUIRE_CAUSES_WAKEUP turns it on; ON_AFTER_RELEASE keeps it
     * up a beat after release; a ~30s timeout is a hard backstop so a leaked lock can never pin
     * the screen on. (Deprecated flags, but the only way to wake the display from a background
     * component; the overlay window's own FLAG_TURN_SCREEN_ON complements it.) Only acquired on
     * the overlay branch — the locked branch relies on the FSI/heads-up to wake the screen.
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

    // --- foreground-service plumbing (the process-survival anchor) ----------------------

    /**
     * Come up (or stay) foreground on the LOW-importance [PingStore.CHANNEL_ALIVE] with a permanent,
     * silent, ongoing notice. This notice is the whole point of the persistent design: it keeps our
     * process warm so a scheduled ping always has a live context to render from. Tapping it opens
     * the app. Safe to call on every onStartCommand — createNotificationChannel + startForeground
     * are both idempotent.
     */
    private fun startAsForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm != null && nm.getNotificationChannel(PingStore.CHANNEL_ALIVE) == null) {
                val channel = NotificationChannel(
                    PingStore.CHANNEL_ALIVE,
                    "Time Audit engine",
                    NotificationManager.IMPORTANCE_LOW // silent, no heads-up — it's just the anchor
                )
                channel.description = "Keeps Time Audit running so your 15-minute check-ins fire on time."
                nm.createNotificationChannel(channel)
            }
        }

        val open = packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val contentIntent = if (open != null) {
            PendingIntent.getActivity(
                this, REQ_ALIVE_CONTENT, open,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        } else null

        val notification: Notification =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, PingStore.CHANNEL_ALIVE)
                    .setContentTitle("Time Audit is on")
                    .setContentText("Tracking your 15-min check-ins.")
                    .setSmallIcon(android.R.drawable.ic_menu_recent_history)
                    .setOngoing(true)
                    .also { if (contentIntent != null) it.setContentIntent(contentIntent) }
                    .build()
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
                    .setContentTitle("Time Audit is on")
                    .setContentText("Tracking your 15-min check-ins.")
                    .setSmallIcon(android.R.drawable.ic_menu_recent_history)
                    .setOngoing(true)
                    .also { if (contentIntent != null) it.setContentIntent(contentIntent) }
                    .build()
            }

        // API 34+ requires the FGS type at start-time AND that it match the manifest (specialUse).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                PingStore.ALIVE_NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(PingStore.ALIVE_NOTIF_ID, notification)
        }
    }

    companion object {
        private const val WAKE_TAG = "timeaudit:ping-service"
        private const val WAKE_TIMEOUT_MS = 30_000L

        // Distinct request codes for this service's PendingIntents (kept clear of the alarm range
        // in PingStore, which tops out at REQ_TEST = 47061).
        private const val REQ_ALIVE_CONTENT = 48000
        private const val REQ_FSI = 48001
        private const val REQ_PICK_BASE = 48010

        /**
         * Whether the persistent engine process anchor is alive. Set true in [onCreate], false in
         * [onDestroy]; read by `TimePing.isEngineRunning()` so the app can show engine health.
         * @Volatile: written on the service's main thread, read from Expo's async executor.
         */
        @Volatile
        var isRunning: Boolean = false
            private set

        /** Start / keep the persistent engine foregrounded and ensure the next alarm is armed. */
        fun start(ctx: Context) {
            send(ctx, PingStore.ACTION_START, null, false)
        }

        /** Poke the (already-live, or start-if-killed) engine to render a check-in for [slotStart]. */
        fun render(ctx: Context, slotStart: Long, isTest: Boolean) {
            send(ctx, PingStore.ACTION_RENDER, slotStart, isTest)
        }

        /** Tear the engine down (tracking off). */
        fun stop(ctx: Context) {
            send(ctx, PingStore.ACTION_STOP, null, false)
        }

        /**
         * Fire an FGS command. Uses startForegroundService so the OS grants the start; the service
         * calls startForeground immediately in onStartCommand. Fully guarded — a failed start (e.g.
         * an OEM refusing a background FGS start outside the exact-alarm exemption) must never crash
         * the caller (an alarm receiver, the boot receiver, or the JS module).
         */
        private fun send(ctx: Context, action: String, slotStart: Long?, isTest: Boolean) {
            try {
                val i = Intent(ctx, PingService::class.java).apply {
                    this.action = action
                    if (slotStart != null) putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                    if (isTest) putExtra(PingStore.EXTRA_TEST, true)
                }
                ContextCompat.startForegroundService(ctx, i)
            } catch (_: Throwable) {
                // Best-effort: if we can't start the service, the alarm chain still re-arms and the
                // next fire retries the start under the exact-alarm FGS-start exemption.
            }
        }
    }
}
