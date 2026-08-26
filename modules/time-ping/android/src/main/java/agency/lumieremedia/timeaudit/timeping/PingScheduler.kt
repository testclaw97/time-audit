package agency.lumieremedia.timeaudit.timeping

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * The AlarmManager brain — now ALARM-ONLY and SELF-RESCHEDULING (one alarm at a time, re-armed on
 * every fire, NOT a 24h batch).
 *
 * WHY the rebuild dropped the batch: cadence must survive Doze and OEM process kills without any
 * in-process timer (a Handler drifts and double-fires because the CPU is frozen in Doze). So the
 * ONLY thing driving the 15-minute cadence is a single exact alarm on the next in-window boundary;
 * when it fires, [PingReceiver] renders the check-in AND calls [scheduleNext] to arm the FOLLOWING
 * boundary. That self-perpetuating chain IS the clock. [BootReceiver] re-seeds it after a reboot.
 *
 * The scheduler also owns the persistent [PingService] lifecycle: [schedule] starts it (the
 * process-survival anchor that renders each ping), [cancelAll] stops it.
 *
 * TODO (device-tuning knob): if setExactAndAllowWhileIdle still gets Doze-delayed on a specific
 * OEM (some Xiaomi/Huawei builds defer even allow-while-idle exact alarms by minutes), switch
 * [armExact] to AlarmManager.setAlarmClock(). setAlarmClock is the strongest guarantee the
 * platform offers — it is never deferred by Doze — at the cost of showing a persistent alarm icon
 * in the status bar (and, on some skins, a "next alarm" chip on the lock screen). Left as exact
 * for now to keep the status bar clean; flip it if a real device proves the delay.
 */
object PingScheduler {

    /**
     * (Re)arm tracking. Persists the params, ENSURES the persistent [PingService] is running (it
     * renders each ping + keeps the process warm), then arms the SINGLE next in-window boundary
     * alarm. Idempotent — safe to call on every foreground / setting change (it cancels the old
     * alarm first and re-uses the one [PingStore.REQ_CHAIN] slot). Returns 1 if an alarm was armed,
     * else 0 (e.g. an all-suppressed window, or no AlarmManager).
     */
    fun schedule(
        ctx: Context,
        intervalMin: Int,
        wakeMin: Int,
        sleepMin: Int,
        pausedUntilMs: Long = 0L,
        lockScreenPopup: Boolean = PingStore.DEFAULT_LOCK_SCREEN_POPUP
    ): Int {
        // Clamp the interval so a corrupt value can't zero the step (divide-by-zero) or spin.
        val interval = if (intervalMin in 1..1440) intervalMin else PingStore.DEFAULT_INTERVAL
        val wake = ((wakeMin % 1440) + 1440) % 1440
        val sleep = ((sleepMin % 1440) + 1440) % 1440

        // Persist lockScreenPopup alongside the cadence params so PingService.render (which may run
        // with no JS process) can gate the lock-screen full-screen intent, and BootReceiver can
        // restore the user's choice after a reboot.
        PingStore.saveParams(ctx, interval, wake, sleep, pausedUntilMs, lockScreenPopup)

        // Bring up (or keep up) the persistent engine. Guarded inside PingService.send — if an OEM
        // refuses the FGS start here, we still arm the alarm below and the first fire retries the
        // start under the exact-alarm exemption. Called from the JS module (app foreground) or
        // BootReceiver (BOOT_COMPLETED exemption), both allowed FGS-start contexts.
        PingService.start(ctx)

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return 0
        // Sweep any alarm this app may have armed — the single chain slot AND any legacy batch
        // alarms left by a prior (batch-based) version on upgrade.
        cancelRange(ctx, am)

        return if (armNextBoundary(ctx, am, PingStore.REQ_CHAIN)) 1 else 0
    }

    /**
     * Arm ONLY the single next in-window boundary — called by [PingReceiver] after each fire to
     * chain, and by [PingService] (ACTION_START / restart) to ensure an alarm exists. Reads the
     * persisted params so it works with no app process. Uses the dedicated [PingStore.REQ_CHAIN]
     * request code, so repeated calls collapse onto ONE alarm rather than stacking.
     */
    fun scheduleNext(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        armNextBoundary(ctx, am, PingStore.REQ_CHAIN)
    }

    /**
     * Turn tracking off: cancel the alarm(s), stop the persistent engine, and forget the params so
     * a reboot won't resurrect the pings.
     */
    fun cancelAll(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        if (am != null) cancelRange(ctx, am)
        try {
            PingService.stop(ctx)
        } catch (_: Throwable) {
        }
        PingStore.clearParams(ctx)
    }

    /**
     * Fire the chooser NOW for the current slot (Settings "Test the popup" + e2e). slotStart is
     * floored to the interval, then we go through the REAL AlarmManager → [PingReceiver] path
     * (~4s out) with EXTRA_TEST set, so the test exercises exactly what a genuine BACKGROUND ping
     * does — including the FGS-start + lock-screen route. Tap it, lock the phone, and the popup
     * lands over the lock screen (proving the locked path end-to-end). ignorePause is honoured in
     * the service's render; the test never chains.
     */
    fun triggerTestPing(ctx: Context) {
        val interval = PingStore.getInterval(ctx)
        val stepMs = (if (interval in 1..1440) interval else PingStore.DEFAULT_INTERVAL) * 60_000L
        val now = System.currentTimeMillis()
        val slotStart = (now / stepMs) * stepMs

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        if (am == null) {
            // No AlarmManager (should never happen) → render immediately via the service.
            PingService.render(ctx, slotStart, isTest = true)
            return
        }
        val intent = buildFireIntent(ctx, slotStart, interval, PingStore.getWake(ctx), PingStore.getSleep(ctx))
            .apply { putExtra(PingStore.EXTRA_TEST, true) }
        val pi = broadcastPI(ctx, PingStore.REQ_TEST, intent)
        val fireAt = now + 4_000L
        try {
            if (canExact(am)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
        }
    }

    // --- helpers -----------------------------------------------------------------------

    /**
     * Compute the next in-window, non-suppressed boundary and arm one exact alarm on it under
     * [requestCode]. Returns true if armed, false if the search found none (e.g. an all-suppressed
     * window). Reads params from [PingStore] so it is process-independent.
     */
    private fun armNextBoundary(ctx: Context, am: AlarmManager, requestCode: Int): Boolean {
        val rawInterval = PingStore.getInterval(ctx)
        val interval = if (rawInterval in 1..1440) rawInterval else PingStore.DEFAULT_INTERVAL
        val wake = PingStore.getWake(ctx)
        val sleep = PingStore.getSleep(ctx)
        val pausedUntil = PingStore.getPausedUntil(ctx)
        val stepMs = interval * 60_000L

        val now = System.currentTimeMillis()
        // First boundary strictly AFTER now, epoch-aligned — matches JS slotStartFor(from)+step.
        var t = (now / stepMs) * stepMs + stepMs

        // Bound the search to a day of steps + headroom so an empty/all-suppressed window can't
        // spin. When a snooze is active the next ping may be past today, so extend by the pause.
        val pauseSteps = if (pausedUntil > now) ((pausedUntil - now) / stepMs).toInt() + 2 else 0
        val maxSteps = (1440 / maxOf(1, interval)) + 8 + pauseSteps
        var i = 0
        while (i < maxSteps) {
            // SNOOZE: skip any boundary at/before the pause horizon — render() would no-op it
            // anyway, so don't burn the alarm on it; land on the first boundary AFTER the pause.
            if (t > pausedUntil && PingStore.inPingWindow(minuteOfDay(t), wake, sleep)) {
                armExact(
                    ctx, am,
                    requestCode = requestCode,
                    fireTime = t,
                    slotStart = t - stepMs,
                    interval = interval, wake = wake, sleep = sleep
                )
                return true
            }
            t += stepMs
            i++
        }
        return false
    }

    /** Cancel the whole request-code range (legacy batch + chain), whether or not each exists. */
    private fun cancelRange(ctx: Context, am: AlarmManager) {
        for (rc in PingStore.REQ_ALARM_BASE..PingStore.REQ_CHAIN) {
            val pi = broadcastPI(ctx, rc, buildFireIntent(ctx, 0L, 0, 0, 0))
            am.cancel(pi)
        }
    }

    private fun armExact(
        ctx: Context,
        am: AlarmManager,
        requestCode: Int,
        fireTime: Long,
        slotStart: Long,
        interval: Int,
        wake: Int,
        sleep: Int
    ) {
        val pi = broadcastPI(
            ctx, requestCode,
            buildFireIntent(ctx, slotStart, interval, wake, sleep)
        )
        // setExactAndAllowWhileIdle punches through Doze so the ping lands ON the boundary, even
        // with the screen off, AND (being an exact/allow-while-idle alarm) grants the short
        // temporary allow-list PingReceiver needs to start the foreground service on fire. If the
        // user hasn't granted SCHEDULE_EXACT_ALARM (Android 12+), degrade to the inexact-but-
        // still-Doze-tolerant variant — a slightly-late ping beats none. See the setAlarmClock
        // TODO on the object if even this proves too soft on a given OEM.
        try {
            if (canExact(am)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireTime, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireTime, pi)
            }
        } catch (_: SecurityException) {
            // Some OEMs throw if exact was revoked mid-flight — fall back gracefully.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireTime, pi)
        }
    }

    private fun canExact(am: AlarmManager): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true

    private fun buildFireIntent(
        ctx: Context, slotStart: Long, interval: Int, wake: Int, sleep: Int
    ): Intent =
        Intent(ctx, PingReceiver::class.java).apply {
            action = PingStore.ACTION_FIRE
            putExtra(PingStore.EXTRA_SLOT_START, slotStart)
            putExtra(PingStore.EXTRA_INTERVAL, interval)
            putExtra(PingStore.EXTRA_WAKE, wake)
            putExtra(PingStore.EXTRA_SLEEP, sleep)
        }

    private fun broadcastPI(ctx: Context, requestCode: Int, intent: Intent): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, requestCode, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    /** Minute-of-day of an epoch in LOCAL time (mirrors JS minuteOfDay). */
    private fun minuteOfDay(t: Long): Int {
        val cal = Calendar.getInstance()
        cal.timeInMillis = t
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    }
}
