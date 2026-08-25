package agency.lumieremedia.timeaudit.timeping

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The alarm sink + quick-action sink. Two jobs, keyed on the intent action:
 *
 *  · [PingStore.ACTION_FIRE] (from AlarmManager) — post the high-importance full-screen-intent
 *    notification that launches [PingActivity] over the lock screen, attach up to 3 one-tap
 *    category buttons (so even a SUPPRESSED full-screen intent still allows a single-tap log
 *    from the shade), then chain the next alarm via [PingScheduler.scheduleNext].
 *
 *  · [PingStore.ACTION_PICK] (from a notification button) — record the chosen category as a
 *    PendingLog for the carried slot and dismiss the notification, WITHOUT opening the chooser.
 *
 * Everything is wrapped so a thrown exception can never crash the host app or, worse, break the
 * alarm chain and silently stop the audit.
 */
class PingReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        try {
            when (intent.action) {
                PingStore.ACTION_FIRE -> {
                    val slotStart = intent.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)
                    // A "Test the popup" fire ignores an active snooze and must NOT perturb the
                    // real cadence (it's a one-shot alarm, so it also never needs to chain).
                    val isTest = intent.getBooleanExtra(PingStore.EXTRA_TEST, false)
                    fire(context, slotStart, ignorePause = isTest)
                    if (!isTest) {
                        // Chain the next boundary so the queue never runs dry, even if the app
                        // process is dead and JS never reschedules.
                        try {
                            PingScheduler.scheduleNext(context)
                        } catch (_: Throwable) {
                        }
                    }
                }

                PingStore.ACTION_PICK -> {
                    val slotStart = intent.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)
                    val category = intent.getStringExtra(PingStore.EXTRA_CATEGORY) ?: return
                    PingStore.addPendingLog(context, slotStart, category, System.currentTimeMillis())
                    // The user answered from the shade — take the notification down.
                    NotificationManagerCompat.from(context).cancel(PingStore.NOTIF_ID)
                }
            }
        } catch (_: Throwable) {
            // Never let a ping crash the app.
        }
    }

    companion object {
        /**
         * Surface the ping for [slotStart], routing by device state. Shared by a real alarm
         * (onReceive) and by [PingScheduler.triggerTestPing]. Safe to call from any thread; all
         * failures are swallowed.
         *
         * SNOOZE: unless [ignorePause] is set, a ping whose surface time is inside an active
         * snooze horizon ([PingStore.getPausedUntil]) is dropped silently — no overlay, no
         * notification. The manual "Test the popup" passes ignorePause=true so it always shows.
         *
         * ROUTING (the real-device fix):
         *   · UNLOCKED + interactive + overlay permission → draw the chooser as a full-screen
         *     overlay WINDOW from [PingOverlayService] (NOT an activity start). This is the only
         *     reliable way to cover the whole screen while the phone is in use — a background
         *     full-screen INTENT is degraded to a heads-up on Android 14/15. We deliberately do
         *     NOT also post the notification here (it would heads-up on top of the overlay).
         *   · LOCKED / screen-off / no overlay permission → post the high-importance FSI
         *     notification that launches [PingActivity] (an Activity with setShowWhenLocked can
         *     draw over a secure keyguard; an overlay window cannot). Its quick-action buttons
         *     preserve one-tap logging from the shade.
         */
        fun fire(ctx: Context, slotStart: Long, ignorePause: Boolean = false) {
            try {
                // --- snooze gate -----------------------------------------------------------
                if (!ignorePause && PingStore.getPausedUntil(ctx) > System.currentTimeMillis()) {
                    return
                }

                // --- device-state routing --------------------------------------------------
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val interactive = try { pm?.isInteractive ?: false } catch (_: Throwable) { false }
                val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                val locked = try { km?.isKeyguardLocked ?: false } catch (_: Throwable) { false }
                val canOverlay = try { Settings.canDrawOverlays(ctx) } catch (_: Throwable) { false }

                if (canOverlay && interactive && !locked) {
                    // Unlocked & in use → overlay window. Nothing else (no competing heads-up).
                    PingOverlayService.show(ctx, slotStart)
                    return
                }

                // --- locked / screen-off → FSI notification → PingActivity -----------------
                postFsiNotification(ctx, slotStart)
            } catch (_: Throwable) {
                // Best-effort: a failed ping must not take anything else down.
            }
        }

        /**
         * The original FSI-notification path, unchanged: a high-importance notification whose
         * setFullScreenIntent launches [PingActivity] over the lock screen / screen-off, plus up
         * to 3 one-tap category quick actions for the shade.
         */
        private fun postFsiNotification(ctx: Context, slotStart: Long) {
            ensureChannel(ctx)

            // Full-screen intent: launches PingActivity over everything (incl. the lock screen /
            // screen off). The activity paints the chooser. Passing the slot so a late tap still
            // lands on the right slot.
            val activityIntent = Intent(ctx, PingActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(PingStore.EXTRA_SLOT_START, slotStart)
            }
            val fsiPI = PendingIntent.getActivity(
                ctx, REQ_FSI, activityIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )

            val builder = NotificationCompat.Builder(ctx, PingStore.CHANNEL_ID)
                .setContentTitle("What are you doing right now?")
                .setContentText("Tap to log this moment.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setOngoing(false)
                // The tap target AND the full-screen launch both go to the chooser.
                .setContentIntent(fsiPI)
                .setFullScreenIntent(fsiPI, true)

            // Up to 3 one-tap category buttons. WHY: on the lock screen a suppressed full-screen
            // intent still lets the user log with a single tap from the shade.
            val cats = PingStore.getCategories(ctx)
            for ((i, cat) in cats.take(3).withIndex()) {
                val pickIntent = Intent(ctx, PingReceiver::class.java).apply {
                    action = PingStore.ACTION_PICK
                    putExtra(PingStore.EXTRA_CATEGORY, cat.id)
                    putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                }
                val pickPI = PendingIntent.getBroadcast(
                    ctx, REQ_PICK_BASE + i, pickIntent,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                builder.addAction(0, "${cat.emoji} ${cat.label}", pickPI)
            }

            // On Android 13+ this silently no-ops without POST_NOTIFICATIONS, which is the
            // correct degrade (the app requests that permission in onboarding).
            NotificationManagerCompat.from(ctx).notify(PingStore.NOTIF_ID, builder.build())
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(PingStore.CHANNEL_ID) != null) return
            // HIGH importance is required for a full-screen intent to be honoured (and to
            // heads-up as the fallback). Named for the user's channel list.
            val channel = NotificationChannel(
                PingStore.CHANNEL_ID,
                "Time-audit pings",
                NotificationManager.IMPORTANCE_HIGH
            )
            channel.description = "Full-screen prompt asking what you're doing right now."
            channel.setBypassDnd(false)
            nm.createNotificationChannel(channel)
        }

        // Distinct request codes for the notification's PendingIntents (kept clear of the
        // alarm range in PingStore, which tops out at REQ_CHAIN = 47060).
        private const val REQ_FSI = 48000
        private const val REQ_PICK_BASE = 48010
    }
}
