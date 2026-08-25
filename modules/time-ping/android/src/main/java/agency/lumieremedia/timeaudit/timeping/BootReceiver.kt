package agency.lumieremedia.timeaudit.timeping

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms the ping schedule after a reboot. AlarmManager's queue is wiped on power-cycle, so
 * without this the audit would silently stop until the app happened to be reopened (the known
 * "reboot landmine"). On BOOT_COMPLETED (and the OEM quickboot aliases some devices send
 * instead) we read the last-known interval/window from [PingStore] and, only if tracking was
 * actually on, rebuild the batch via [PingScheduler.schedule].
 *
 * exported=true (see the manifest) is required for the system to deliver BOOT_COMPLETED; we
 * guard the body so a malformed broadcast can't crash early boot.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        try {
            val action = intent.action ?: return
            if (action != Intent.ACTION_BOOT_COMPLETED &&
                action != "android.intent.action.QUICKBOOT_POWERON" &&
                action != "com.htc.intent.action.QUICKBOOT_POWERON"
            ) {
                return
            }
            // Only re-arm if the user had tracking on (schedule() ran at least once and
            // cancelAll() didn't wipe the params).
            if (!PingStore.hasParams(context)) return
            PingScheduler.schedule(
                context,
                PingStore.getInterval(context),
                PingStore.getWake(context),
                PingStore.getSleep(context),
                // Carry the snooze horizon across reboot so a paused audit stays paused.
                PingStore.getPausedUntil(context)
            )
        } catch (_: Throwable) {
            // Never crash during boot.
        }
    }
}
