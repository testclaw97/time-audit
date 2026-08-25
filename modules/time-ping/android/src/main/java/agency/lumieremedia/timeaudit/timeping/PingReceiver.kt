package agency.lumieremedia.timeaudit.timeping

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
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
                    fire(context, slotStart)
                    // Chain the next boundary so the queue never runs dry, even if the app
                    // process is dead and JS never reschedules.
                    try {
                        PingScheduler.scheduleNext(context)
                    } catch (_: Throwable) {
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
         * Post the FSI notification for [slotStart]. Shared by a real alarm (onReceive) and by
         * [PingScheduler.triggerTestPing] so the "Test the popup" button is byte-for-byte the
         * real thing. Safe to call from any thread; all failures are swallowed.
         */
        fun fire(ctx: Context, slotStart: Long) {
            try {
                ensureChannel(ctx)

                // Full-screen intent: launches PingActivity over everything (incl. the lock
                // screen / screen off). The activity paints the chooser. Passing the slot so a
                // late tap still lands on the right slot.
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

                // Up to 3 one-tap category buttons. WHY: on Android 14+ the full-screen intent
                // may be down-ranked to a heads-up if the special access isn't granted; these
                // quick actions preserve the "single tap to log" promise from the shade.
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

                // Belt-and-suspenders for the "screen is ON / phone in active use" case. A full-
                // screen INTENT only reliably launches its activity when the device is locked or
                // asleep; while the user is actively using the phone Android keeps it as a heads-up
                // (and on Android 14+ it degrades to a heads-up entirely unless the FSI special
                // access is granted). If the user has granted "Display over other apps"
                // (SYSTEM_ALERT_WINDOW), that permission ALSO lifts the background-activity-launch
                // restriction — so we can start PingActivity DIRECTLY and it covers the WHOLE screen
                // every time, unlocked or not. Without the permission this is a no-op (a background
                // activity start is blocked) and the FSI notification above stays the mechanism.
                // PingActivity is singleTask, so a direct launch + the FSI can never stack two
                // choosers. This is the same overlay-backed launch Mr. Productive's block screen uses.
                try {
                    if (Settings.canDrawOverlays(ctx)) {
                        ctx.startActivity(activityIntent)
                    }
                } catch (_: Throwable) {
                }
            } catch (_: Throwable) {
                // Best-effort: a failed ping must not take anything else down.
            }
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
