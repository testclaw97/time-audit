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
                // Snooze horizon (epoch-ms). JS sends a Double; absent/invalid → 0 (no snooze).
                val pausedUntil = longOf(opts["pausedUntilMs"], 0L)
                // Lock-screen popup: JS Boolean; absent/invalid → true (default ON). When false a
                // LOCKED-screen ping degrades to the floor notification instead of taking over the
                // keyguard with the full-screen chooser (see PingService.render).
                val lockScreenPopup = boolOf(opts["lockScreenPopup"], true)
                PingScheduler.schedule(context, interval, wake, sleep, pausedUntil, lockScreenPopup)
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

        /**
         * Is the persistent ping engine ([PingService]) currently alive? Lets the app surface
         * engine health (e.g. a "tracking is running" indicator). Reads the @Volatile liveness
         * flag the service sets in onCreate/onDestroy — cheap, no IPC, no round-trip to the service.
         */
        AsyncFunction("isEngineRunning") {
            try {
                PingService.isRunning
            } catch (_: Throwable) {
                false
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

        // Atomic read-and-clear — the race-free drain path (see PingStore.takePendingLogs). JS
        // should prefer this over getPendingLogs()+clearPendingLogs(), which lost a log recorded
        // in the gap between the two calls.
        AsyncFunction("takePendingLogs") {
            try {
                PingStore.takePendingLogs(context)
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

        // "Display over other apps" (SYSTEM_ALERT_WINDOW). This is the key grant for showing the
        // FULL-SCREEN chooser while the phone is unlocked/in use: it lets [PingService] draw the
        // overlay window over whatever app is in front (see PingService.render's overlay branch).
        // Settings-granted, no runtime dialog.
        AsyncFunction("hasOverlayPermission") {
            try {
                Settings.canDrawOverlays(context)
            } catch (_: Throwable) {
                false
            }
        }

        AsyncFunction("requestOverlayPermission") {
            try {
                launchSettings(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${context.packageName}")
                    )
                )
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

        // --- OEM proprietary switches (MIUI / One UI / ColorOS / FuntouchOS / EMUI) ------------
        // These are NOT standard Android permissions: they live in the OEM's own security app, and
        // standard APIs can neither grant NOR read them. The ONLY thing we can do is deep-link the
        // user straight to the right OEM screen and let them flip the toggle by hand. Proven on a
        // real Xiaomi: enabling MIUI's "Display pop-up windows while running in the background" +
        // "Show on lock screen" + autostart is what actually makes the background popup fire.

        /**
         * Build.MANUFACTURER lowercased ("xiaomi", "samsung", "oppo", "vivo", "huawei", …) so JS
         * can show the correct OEM-specific onboarding step + wording. Empty string on any failure.
         */
        AsyncFunction("getManufacturer") {
            try {
                Build.MANUFACTURER?.lowercase() ?: ""
            } catch (_: Throwable) {
                ""
            }
        }

        /**
         * Open the OEM's per-app "other permissions" editor — the screen that hosts MIUI's "Display
         * pop-up windows while running in the background" and "Show on lock screen" ops, which no
         * standard Android permission covers. We try the known OEM editors in order (first that
         * RESOLVES on this device wins) and fall back to the universal app-details settings page.
         * We cannot READ the resulting state (OEM-private), so the app relies on the user confirming
         * they enabled them. Fully guarded — a bad deep-link must never crash the host app.
         */
        AsyncFunction("openOemAppPermissions") {
            try {
                val pkg = context.packageName
                // MIUI (Xiaomi/Redmi/POCO): the permission editor is an action + explicit component,
                // and it needs the target package passed via the OEM-specific "extra_pkgname" extra.
                val miui = Intent("miui.intent.action.APP_PERM_EDITOR").apply {
                    setClassName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.permissions.PermissionsEditorActivity"
                    )
                    putExtra("extra_pkgname", pkg)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                launchFirstResolvable(listOf(miui))
            } catch (_: Throwable) {
            }
        }

        /**
         * Open the OEM's autostart / auto-launch manager — the switch that lets our process be
         * (re)started in the background after an OEM kill, which is what keeps the alarm chain and
         * the persistent service alive on aggressive skins. Try each vendor's known component in
         * order (first that resolves wins), else fall back to app-details settings. Guarded.
         */
        AsyncFunction("openOemAutostart") {
            try {
                launchFirstResolvable(
                    listOf(
                        // MIUI (Xiaomi/Redmi/POCO)
                        oemComponent(
                            "com.miui.securitycenter",
                            "com.miui.permcenter.autostart.AutoStartManagementActivity"
                        ),
                        // Samsung One UI — newer "Device care" battery screen …
                        oemComponent(
                            "com.samsung.android.lool",
                            "com.samsung.android.sm.ui.battery.BatteryActivity"
                        ),
                        // … and the older Smart Manager "Auto run" list.
                        oemComponent(
                            "com.samsung.android.sm",
                            "com.samsung.android.sm.ui.ram.AutoRunActivity"
                        ),
                        // Oppo / Realme / OnePlus (ColorOS) startup manager.
                        oemComponent(
                            "com.coloros.safecenter",
                            "com.coloros.safecenter.permission.startup.StartupAppListActivity"
                        ),
                        // Vivo / iQOO (FuntouchOS/OriginOS) background-startup manager.
                        oemComponent(
                            "com.vivo.permissionmanager",
                            "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                        ),
                        // Huawei / Honor (EMUI) startup manager.
                        oemComponent(
                            "com.huawei.systemmanager",
                            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
                        )
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

    /**
     * Coerce a JS numeric (Double) — or a String — into a Long epoch-ms value. Falls back to
     * [fallback] on anything non-finite so a corrupt snooze value can't poison the schedule. A
     * Double is lossless for epoch-ms values (well within 2^53).
     */
    private fun longOf(value: Any?, fallback: Long): Long = when (value) {
        is Number -> {
            val d = value.toDouble()
            if (d.isFinite()) d.toLong() else fallback
        }
        is String -> value.trim().toDoubleOrNull()?.toLong() ?: fallback
        else -> fallback
    }

    /**
     * Coerce a JS Boolean (or a "true"/"false"/1/0 stand-in) into a Kotlin Boolean, falling back to
     * [fallback] on null/anything unrecognised — so an absent `lockScreenPopup` opt reads as ON.
     */
    private fun boolOf(value: Any?, fallback: Boolean): Boolean = when (value) {
        is Boolean -> value
        is Number -> value.toDouble() != 0.0
        is String -> when (value.trim().lowercase()) {
            "true", "1", "yes" -> true
            "false", "0", "no" -> false
            else -> fallback
        }
        else -> fallback
    }

    /** A module Context is NOT an Activity, so NEW_TASK is required to start a Settings screen. */
    private fun launchSettings(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /**
     * Build an explicit intent at an OEM security-app component, carrying the target package via
     * BOTH the OEM-specific "extra_pkgname" extra (some skins key their screen off it) and
     * FLAG_ACTIVITY_NEW_TASK (the module Context isn't an Activity). Harmless where the extra is
     * ignored.
     */
    private fun oemComponent(pkg: String, cls: String): Intent =
        Intent().apply {
            setClassName(pkg, cls)
            putExtra("extra_pkgname", context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

    /**
     * Try each OEM deep-link in order and launch the FIRST one that actually resolves to an activity
     * on THIS device (resolveActivity != null) — most candidates belong to other vendors' security
     * apps and simply won't resolve. If none resolve (or every launch throws), fall back to the
     * always-present per-app details settings page so the user still lands somewhere useful. Every
     * step is guarded: a proprietary screen that exists but refuses our start must not crash the app.
     */
    private fun launchFirstResolvable(intents: List<Intent>) {
        val pm = context.packageManager
        for (intent in intents) {
            try {
                if (intent.resolveActivity(pm) != null) {
                    context.startActivity(intent)
                    return
                }
            } catch (_: Throwable) {
                // This candidate blew up (e.g. an OEM restricting the component) — try the next.
            }
        }
        // FINAL fallback: the universal app-details settings screen. Always resolvable.
        try {
            launchSettings(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${context.packageName}")
                )
            )
        } catch (_: Throwable) {
        }
    }
}
