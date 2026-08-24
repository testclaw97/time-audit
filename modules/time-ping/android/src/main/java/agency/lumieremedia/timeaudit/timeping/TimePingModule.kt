package agency.lumieremedia.timeaudit.timeping

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS <-> native bridge for the full-screen category ping. Every function is a THIN delegate:
 * scheduling goes to [PingScheduler], persistence to [PingStore], and permission gates bounce
 * the user into the relevant Settings screen. This class never schedules, stores, or draws
 * directly — it just marshals arguments across the boundary.
 *
 * `Name("TimePing")` is the handle JS resolves via `requireOptionalNativeModule("TimePing")`
 * — it MUST stay in lockstep with modules/time-ping/index.ts. Each AsyncFunction is wrapped in
 * try/catch so a native hiccup surfaces as a benign default rather than crashing the host app.
 */
class TimePingModule : Module() {

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("TimePing")

        // --- scheduling ------------------------------------------------------------------
        AsyncFunction("schedule") { opts: Map<String, Any?> ->
            try {
                val interval = intOf(opts["intervalMinutes"], PingStore.DEFAULT_INTERVAL)
                val wake = intOf(opts["wakeMinutes"], 7 * 60)
                val sleep = intOf(opts["sleepMinutes"], 23 * 60)
                PingScheduler.schedule(context, interval, wake, sleep)
            } catch (_: Throwable) {
                0
            }
        }

        AsyncFunction("cancelAll") {
            try {
                PingScheduler.cancelAll(context)
            } catch (_: Throwable) {
            }
        }

        AsyncFunction("triggerTestPing") {
            try {
                PingScheduler.triggerTestPing(context)
            } catch (_: Throwable) {
            }
        }

        // --- categories + pending logs ---------------------------------------------------
        AsyncFunction("setCategories") { cats: List<Map<String, Any?>> ->
            try {
                PingStore.setCategories(context, cats)
            } catch (_: Throwable) {
            }
        }

        AsyncFunction("getPendingLogs") {
            try {
                PingStore.getPendingLogs(context)
            } catch (_: Throwable) {
                emptyList<Map<String, Any>>()
            }
        }

        AsyncFunction("clearPendingLogs") {
            try {
                PingStore.clearPendingLogs(context)
            } catch (_: Throwable) {
            }
        }

        // --- special-access permission gates (each is a Settings bounce) -----------------
        AsyncFunction("hasExactAlarm") {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                    am?.canScheduleExactAlarms() ?: false
                } else {
                    // No such gate before Android 12 — exact alarms are always allowed.
                    true
                }
            } catch (_: Throwable) {
                false
            }
        }

        AsyncFunction("requestExactAlarm") {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    launchSettings(
                        Intent(
                            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                }
                // Older OSes: nothing to request.
            } catch (_: Throwable) {
            }
        }

        AsyncFunction("hasFullScreenIntent") {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    val nm = context.getSystemService(android.app.NotificationManager::class.java)
                    nm?.canUseFullScreenIntent() ?: false
                } else {
                    // Before Android 14 the declared permission is enough — always usable.
                    true
                }
            } catch (_: Throwable) {
                false
            }
        }

        AsyncFunction("requestFullScreenIntent") {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    launchSettings(
                        Intent(
                            Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                }
            } catch (_: Throwable) {
            }
        }

        AsyncFunction("hasBatteryExemption") {
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
            } catch (_: Throwable) {
                false
            }
        }

        AsyncFunction("requestBatteryExemption") {
            try {
                // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows the system dialog directly
                // for our package (the matching permission is declared in the manifest).
                launchSettings(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:${context.packageName}")
                    )
                )
            } catch (_: Throwable) {
            }
        }
    }

    // --- helpers -----------------------------------------------------------------------

    /**
     * Coerce a JS numeric (which arrives as Double) — or a String — into an Int minute value.
     * Falls back to [fallback] on anything non-finite so a corrupt setting can't break math.
     */
    private fun intOf(value: Any?, fallback: Int): Int = when (value) {
        is Number -> {
            val d = value.toDouble()
            if (d.isFinite()) d.toLong().toInt() else fallback
        }
        is String -> value.trim().toDoubleOrNull()?.toInt() ?: fallback
        else -> fallback
    }

    /** A module Context is NOT an Activity, so NEW_TASK is required to start a Settings screen. */
    private fun launchSettings(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
