package agency.lumieremedia.timeaudit.timeping

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * The AlarmManager brain. Given an interval + awake window, it arms one EXACT alarm on each
 * in-window slot boundary for roughly the next 24h (capped at [PingStore.ALARM_CAP]). Each
 * alarm targets [PingReceiver] with [PingStore.ACTION_FIRE]; when it fires the receiver posts
 * the full-screen chooser AND calls [scheduleNext] to arm the following boundary — so the
 * queue self-perpetuates past the initial batch and survives long idle stretches without
 * relying on the app process being alive.
 *
 * WHY a batch AND a self-chain: the batch gives a reliable near-term queue even if the app is
 * never reopened; the single chained alarm ([REQ_CHAIN]) keeps the cadence going indefinitely
 * once the batch drains. Together they mean pings keep landing whether or not JS ever runs
 * again (until the user turns tracking off or reboots — [BootReceiver] handles the reboot).
 */
object PingScheduler {

    /**
     * Cancel any prior alarms, compute the in-window boundaries for the next ~24h stepping by
     * [intervalMin], and arm an exact alarm on each (capped at [PingStore.ALARM_CAP]). Persists
     * the params for the chain + boot restore. Returns the number of alarms scheduled.
     */
    fun schedule(ctx: Context, intervalMin: Int, wakeMin: Int, sleepMin: Int): Int {
        // Clamp the interval to something sane so a corrupt value can't zero the step (which
        // would divide-by-zero below) or spin the loop.
        val interval = if (intervalMin in 1..1440) intervalMin else PingStore.DEFAULT_INTERVAL
        val wake = ((wakeMin % 1440) + 1440) % 1440
        val sleep = ((sleepMin % 1440) + 1440) % 1440

        PingStore.saveParams(ctx, interval, wake, sleep)

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return 0
        cancelRange(ctx, am)

        val stepMs = interval * 60_000L
        val now = System.currentTimeMillis()
        // First boundary strictly AFTER now, epoch-aligned — matches JS
        // slotStartFor(from)+step in src/lib/time.ts. (Whole-hour/half-hour zones align to
        // :00/:15/… ; sub-hour-offset zones would shift by the offset, acceptable here.)
        var t = (now / stepMs) * stepMs + stepMs
        val end = now + 24L * 60L * 60L * 1000L

        var count = 0
        while (t <= end && count < PingStore.ALARM_CAP) {
            if (PingStore.inPingWindow(minuteOfDay(t), wake, sleep)) {
                armExact(
                    ctx, am,
                    requestCode = PingStore.REQ_ALARM_BASE + count,
                    fireTime = t,
                    slotStart = t - stepMs,
                    interval = interval, wake = wake, sleep = sleep
                )
                count++
            }
            t += stepMs
        }
        return count
    }

    /**
     * Arm ONLY the single next in-window boundary (called by [PingReceiver] to chain). Reads
     * the persisted params so it works even when the app process is gone. Uses the dedicated
     * [PingStore.REQ_CHAIN] request code so it never collides with the initial batch.
     */
    fun scheduleNext(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val interval = PingStore.getInterval(ctx)
        val wake = PingStore.getWake(ctx)
        val sleep = PingStore.getSleep(ctx)
        val stepMs = (if (interval in 1..1440) interval else PingStore.DEFAULT_INTERVAL) * 60_000L

        val now = System.currentTimeMillis()
        var t = (now / stepMs) * stepMs + stepMs
        // Bound the search to one day of steps + headroom so an empty window can't spin.
        val maxSteps = (1440 / maxOf(1, interval)) + 8
        var i = 0
        while (i < maxSteps) {
            if (PingStore.inPingWindow(minuteOfDay(t), wake, sleep)) {
                armExact(
                    ctx, am,
                    requestCode = PingStore.REQ_CHAIN,
                    fireTime = t,
                    slotStart = t - stepMs,
                    interval = interval, wake = wake, sleep = sleep
                )
                return
            }
            t += stepMs
            i++
        }
    }

    /** Cancel every tracked alarm and forget the params so tracking stays off across reboot. */
    fun cancelAll(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        if (am != null) cancelRange(ctx, am)
        PingStore.clearParams(ctx)
    }

    /**
     * Fire the chooser NOW for the current slot (Settings "Test the popup" + e2e). slotStart is
     * now floored to the interval, then we invoke the exact same fire path a real alarm uses,
     * so the test popup is indistinguishable from a genuine ping. Does NOT chain.
     */
    fun triggerTestPing(ctx: Context) {
        val interval = PingStore.getInterval(ctx)
        val stepMs = (if (interval in 1..1440) interval else PingStore.DEFAULT_INTERVAL) * 60_000L
        val now = System.currentTimeMillis()
        val slotStart = (now / stepMs) * stepMs
        // "Test the popup" is pressed from INSIDE the app on an unlocked, foreground screen. A
        // full-screen INTENT only launches its activity when the device is locked/asleep —
        // otherwise Android degrades it to a heads-up, so the user (and CI) would never see the
        // real chooser. For the preview we therefore launch PingActivity DIRECTLY, which always
        // shows the chooser now regardless of lock state. Real SCHEDULED pings keep going through
        // the FSI path in PingReceiver.fire (correct for screen-off / over-the-lock-screen). If
        // the direct launch throws for any reason, fall back to the notification/FSI path.
        try {
            val i = Intent(ctx, PingActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(PingStore.EXTRA_SLOT_START, slotStart)
            }
            ctx.startActivity(i)
        } catch (_: Throwable) {
            PingReceiver.fire(ctx, slotStart)
        }
    }

    // --- helpers -----------------------------------------------------------------------

    /** Cancel the whole request-code range (initial batch + chain), whether or not each exists. */
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
        // setExactAndAllowWhileIdle punches through Doze so the ping lands ON the boundary,
        // even with the screen off. If the user hasn't granted SCHEDULE_EXACT_ALARM (Android
        // 12+), we degrade to the inexact-but-still-Doze-tolerant variant so pings still fire,
        // just less punctually — better a slightly-late ping than none.
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
