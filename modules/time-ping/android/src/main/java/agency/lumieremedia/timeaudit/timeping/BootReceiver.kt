package agency.lumieremedia.timeaudit.timeping

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms the ping schedule after a reboot. AlarmManager's queue is wiped AND the persistent
 * [PingService] is killed on power-cycle, so without this the audit would silently stop until the
 * app happened to be reopened (the known "reboot landmine"). On BOOT_COMPLETED (and the OEM
 * quickboot aliases some devices send instead) we read the last-known interval/window from
 * [PingStore] and, only if tracking was actually on, call [PingScheduler.schedule] — which both
 * re-starts the persistent engine service AND arms the next boundary alarm.
 *
 * WHY calling schedule() at boot is safe on Android 14/15: schedule() starts the FGS FIRST (guarded
 * — BOOT_COMPLETED is one of the contexts allowed to start a foreground service; but if a strict
 * OEM still refuses a specialUse FGS at boot, PingService.send swallows it) and then ALWAYS arms
 * the alarm regardless. So even if the engine can't come up at boot, the alarm is set and the first
 * fire brings the engine up under the exact-alarm FGS-start exemption. Either way the audit resumes.
 *
 * exported=true (see the manifest) is required for the system to deliver BOOT_COMPLETED; we guard
 * the body so a malformed broadcast can't crash early boot.
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
            // cancelAll() didn't wipe the params). This restarts the persistent engine + arms the
            // next boundary alarm.
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
