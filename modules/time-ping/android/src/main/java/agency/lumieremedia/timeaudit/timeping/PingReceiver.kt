package agency.lumieremedia.timeaudit.timeping

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/**
 * The alarm sink + quick-action sink. Two jobs, keyed on the intent action:
 *
 *  · [PingStore.ACTION_FIRE] (from AlarmManager) — poke the persistent [PingService] to RENDER a
 *    check-in for the carried slot (via startForegroundService + [PingStore.ACTION_RENDER]; this
 *    wakes the already-live engine, or re-starts it if the OEM killed it), THEN chain the next
 *    boundary via [PingScheduler.scheduleNext]. The receiver itself no longer draws anything —
 *    all surfacing (floor notice / overlay / FSI) is owned by the live service, which always has a
 *    warm WindowManager/overlay context. That is the real-device fix: nothing UI-facing is started
 *    from this cold background broadcast.
 *
 *  · [PingStore.ACTION_PICK] (from a check-in notification button) — record the chosen category as
 *    a PendingLog for the carried slot and cancel the check-in notice, WITHOUT opening the chooser.
 *    This path needs NO special permission and must never fail.
 *
 * Everything is wrapped so a thrown exception can never crash the host app or, worse, break the
 * alarm chain and silently stop the audit.
 *
 * WHY startForegroundService is allowed from here even in the background: the ACTION_FIRE alarm is
 * armed with setExactAndAllowWhileIdle (RTC_WAKEUP), which grants the app a short temporary
 * allow-list to start a foreground service when it fires — the documented exemption from the
 * Android 12+ background-FGS-start restriction. (If an OEM still refuses, PingService.send swallows
 * it and the next chained fire retries.)
 */
class PingReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        try {
            when (intent.action) {
                PingStore.ACTION_FIRE -> {
                    val slotStart = intent.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)
                    // A "Test the popup" fire ignores an active snooze (handled in the service's
                    // render) and must NOT perturb the real cadence — it never chains.
                    val isTest = intent.getBooleanExtra(PingStore.EXTRA_TEST, false)

                    // Poke the persistent engine to surface the check-in now.
                    try {
                        PingService.render(context, slotStart, isTest)
                    } catch (_: Throwable) {
                    }

                    if (!isTest) {
                        // Chain the next boundary so the cadence never runs dry, even if the app
                        // process is otherwise idle and JS never reschedules. This self-
                        // perpetuation IS the cadence (there is no in-service timer).
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
                    // The user answered from the shade — take the check-in notice down.
                    NotificationManagerCompat.from(context).cancel(PingStore.CHECKIN_NOTIF_ID)
                }

                PingStore.ACTION_OTHER -> {
                    // "Other" on the notification: stash the slot so the app opens quick-entry for it,
                    // open the app, and clear the check-in notice. Nothing is logged here — the user
                    // types a custom label in-app (which is then saved as a category).
                    val slotStart = intent.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)
                    try {
                        PingStore.setFocusSlot(context, slotStart)
                        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                        if (launch != null) {
                            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            launch.putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                            context.startActivity(launch)
                        }
                    } catch (_: Throwable) {
                    }
                    NotificationManagerCompat.from(context).cancel(PingStore.CHECKIN_NOTIF_ID)
                }
            }
        } catch (_: Throwable) {
            // Never let a ping crash the app.
        }
    }
}
