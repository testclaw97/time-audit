package agency.lumieremedia.timeaudit.timeping

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Single source of truth for everything the OTHER components (module, alarm receiver,
 * chooser activity, boot receiver) need to agree on — the category set, the queue of
 * chooser-recorded logs, and the last schedule params — plus the process-wide constants
 * (channel id / notification id / action + extra names / requestCode scheme).
 *
 * WHY a persisted native store rather than JS-held state (mirrors mp-blocker's BlockerStore):
 *
 *   1. The chooser [PingActivity] can be launched by the OS (via the full-screen intent)
 *      while the JS runtime is DEAD — the app may be swiped away or the phone asleep. It has
 *      to render its chips and stamp its PendingLog from native storage alone; a round-trip
 *      to JS is impossible at that moment.
 *   2. [BootReceiver] must re-arm alarms after a reboot with NO app process running, so the
 *      last-known interval/window has to survive in SharedPreferences.
 *   3. Category seeding: a ping can fire before JS has ever called `setCategories` (freshly
 *      installed, opened once, killed). Seeding [DEFAULT_CATEGORIES] on first read guarantees
 *      the chooser always has something to show — it can never come up empty.
 *
 * Every method takes a Context and touches only SharedPreferences, so this object leaks no
 * references and is safe to call from the module, a receiver, or the activity.
 */
object PingStore {

    // --- process-wide constants (the ONE place these are defined) ----------------------
    // Kept here so the persistent service [PingService] (which posts the alive + check-in
    // notifications and draws the overlay), [PingReceiver] (which cancels the check-in notice
    // on a quick-action tap) and [PingActivity] (which cancels it on a lock-screen tap) can
    // never drift on an id/channel — a mismatch would leave a notification stuck on screen.
    //
    // The new architecture (real-device reliability rebuild) has TWO channels, deliberately
    // separated by importance because they do opposite jobs:
    //
    //   · CHANNEL_ALIVE  (LOW)  — the ONE permanent, silent, ongoing "engine is on" notice that
    //     [PingService] posts as its foreground-service anchor. It never heads-up; its only job
    //     is to keep our process alive so a scheduled ping always has a live context to render
    //     from (starting things from a dead background process is what OEMs kill).
    //   · CHANNEL_CHECKIN (HIGH) — the per-ping "What are you doing right now?" surface. HIGH is
    //     mandatory: it is what lets the notice heads-up AND what a full-screen-intent requires
    //     to launch its Activity over the keyguard. This notice is the reliability FLOOR — it is
    //     posted on EVERY ping regardless of overlay/FSI availability, so a check-in is never
    //     silently lost; the overlay / FSI are strict upgrades layered on top of it.

    /** LOW-importance channel carrying [PingService]'s permanent ongoing "engine is on" notice. */
    const val CHANNEL_ALIVE = "time-ping-alive"

    /** HIGH-importance channel carrying the per-ping check-in (floor notice + FSI + heads-up). */
    const val CHANNEL_CHECKIN = "time-ping-checkin"

    /** Stable id of the permanent alive/foreground notice. Distinct from [CHECKIN_NOTIF_ID]. */
    const val ALIVE_NOTIF_ID = 4089

    /** Stable id of the per-ping check-in notice — one live ping at a time; a new one replaces it. */
    const val CHECKIN_NOTIF_ID = 4088

    /** AlarmManager broadcast: "fire a ping now" (carries slotStart + schedule params). */
    const val ACTION_FIRE = "agency.lumieremedia.timeaudit.timeping.ACTION_FIRE"

    /** Notification quick-action broadcast: "log this category for this slot" (no chooser). */
    const val ACTION_PICK = "agency.lumieremedia.timeaudit.timeping.ACTION_PICK"

    /** From the check-in notification's "Other" button — open the app to type a custom label. */
    const val ACTION_OTHER = "agency.lumieremedia.timeaudit.timeping.ACTION_OTHER"

    // --- [PingService] intent actions (the persistent FGS command surface) --------------
    // The service is a single long-lived process anchor poked by distinct actions rather than a
    // fleet of transient services. See [PingService.onStartCommand] for the handlers.

    /** Start/keep the persistent FGS foregrounded and ensure the next alarm is armed. */
    const val ACTION_START = "agency.lumieremedia.timeaudit.timeping.ACTION_START"

    /** Render a check-in for the carried [EXTRA_SLOT_START] right now (floor notice ± overlay/FSI). */
    const val ACTION_RENDER = "agency.lumieremedia.timeaudit.timeping.ACTION_RENDER"

    /** Tear down any overlay and stop the persistent FGS (tracking turned off). */
    const val ACTION_STOP = "agency.lumieremedia.timeaudit.timeping.ACTION_STOP"

    /** Intent extras shared across alarm / notification / activity. */
    const val EXTRA_SLOT_START = "slotStart"   // Long epoch ms of the slot being asked about
    const val EXTRA_INTERVAL = "intervalMin"   // Int minutes between pings
    const val EXTRA_WAKE = "wakeMin"           // Int minute-of-day the awake window opens
    const val EXTRA_SLEEP = "sleepMin"         // Int minute-of-day the awake window closes
    const val EXTRA_CATEGORY = "picked_category" // String category id for ACTION_PICK
    const val EXTRA_TEST = "test_ping"           // Boolean: a "Test the popup" fire (ignore pause, don't chain)

    // requestCode scheme for the alarm PendingIntents. The rebuild uses ONE alarm at a time —
    // a single self-rescheduling "next boundary" alarm ([REQ_CHAIN]) re-armed on every fire — so
    // the cadence is a chain, not a 24h batch. The [REQ_ALARM_BASE .. REQ_CHAIN] range is retained
    // ONLY so [PingScheduler.cancelAll]/schedule can sweep any leftover batch alarms armed by a
    // PRIOR (batch-based) version of the app on upgrade; the live scheduler never arms into it.
    const val REQ_ALARM_BASE = 47000
    const val ALARM_CAP = 60                       // width of the legacy-batch sweep range (upgrade cleanup)
    const val REQ_CHAIN = REQ_ALARM_BASE + ALARM_CAP // 47060 — the single self-rescheduling "next" alarm
    const val REQ_TEST = REQ_CHAIN + 1               // 47061 — one-shot "Test the popup" alarm
    const val REQ_SHOW = REQ_CHAIN + 2               // 47062 — setAlarmClock "show" intent (opens app)

    // --- SharedPreferences plumbing ----------------------------------------------------
    private const val PREFS = "time_ping"
    private const val KEY_CATEGORIES = "categories"
    private const val KEY_PENDING = "pending_logs"
    private const val KEY_INTERVAL = "interval"
    private const val KEY_WAKE = "wake"
    private const val KEY_SLEEP = "sleep"
    private const val KEY_PAUSED_UNTIL = "paused_until" // epoch-ms; pings before this are suppressed
    private const val KEY_LOCK_SCREEN_POPUP = "lock_screen_popup" // Boolean; gate the FSI over keyguard
    private const val KEY_FOCUS_SLOT = "focus_slot" // epoch-ms of a slot the user tapped "Other" for
    private const val KEY_HARDCORE = "hardcore_mode" // Boolean; block the phone on unlock until answered
    private const val KEY_LAST_PROMPTED = "last_prompted_slot" // epoch-ms; throttle hardcore to 1/slot

    // Fallback schedule params if something reads before the first schedule() call.
    const val DEFAULT_INTERVAL = 15
    private const val DEFAULT_WAKE = 7 * 60   // 07:00
    private const val DEFAULT_SLEEP = 23 * 60 // 23:00
    // Default for the lock-screen popup: ON. A locked-screen ping takes over the keyguard with the
    // full-screen chooser unless the user explicitly opts out (then it degrades to the floor notice).
    const val DEFAULT_LOCK_SCREEN_POPUP = true

    // A guard so any reads/writes that touch the same key don't interleave across threads
    // (the module runs on Expo's async executor; receivers on the main thread).
    private val lock = Any()

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * The 10 seed categories. These ids/emoji/colors are kept BYTE-FOR-BYTE identical to the
     * JS `DEFAULT_CATEGORIES` (src/lib/store.ts) and to the spec table — a PendingLog records
     * a category *id*, so the id space MUST match or JS can't resolve the label on drain.
     */
    private val DEFAULT_CATEGORIES: List<Category> = listOf(
        Category("work", "💼", "Work", "#f5a623"),
        Category("deep", "🎯", "Deep work", "#ffb84d"),
        Category("scroll", "📱", "Scrolling", "#ff5d6c"),
        Category("eat", "🍽️", "Eating", "#38c8b0"),
        Category("move", "🏋️", "Exercise", "#7bd88f"),
        Category("rest", "😴", "Rest", "#6c8cff"),
        Category("people", "👥", "People", "#b98cff"),
        Category("fun", "🎬", "Leisure", "#ff9f43"),
        Category("travel", "🚗", "Travel", "#8a94a6"),
        Category("learn", "🧠", "Learning", "#4dd0e1")
    )

    /** A category as rendered on a chip. Mirrors PingCategory in index.ts. */
    data class Category(
        val id: String,
        val emoji: String,
        val label: String,
        val color: String
    )

    // --- categories --------------------------------------------------------------------

    /**
     * Persist the category set (called by the module on every category edit). Each incoming
     * map is coerced to the four string fields so a malformed value from JS can't poison the
     * store. Anything without an id is dropped (an id is required to record a log against it).
     */
    fun setCategories(ctx: Context, cats: List<Map<String, Any?>>) {
        synchronized(lock) {
            val arr = JSONArray()
            for (c in cats) {
                val id = (c["id"] ?: "").toString().trim()
                if (id.isEmpty()) continue
                val obj = JSONObject()
                obj.put("id", id)
                obj.put("emoji", (c["emoji"] ?: "").toString())
                obj.put("label", (c["label"] ?: "").toString())
                obj.put("color", (c["color"] ?: "#f5a623").toString())
                arr.put(obj)
            }
            prefs(ctx).edit().putString(KEY_CATEGORIES, arr.toString()).apply()
        }
    }

    /**
     * The categories the chooser should render. If the key was never written (fresh install,
     * chooser fires before JS ran), SEED [DEFAULT_CATEGORIES] and persist them, so a ping can
     * always show chips. Corrupt JSON also falls back to the defaults rather than throwing.
     */
    fun getCategories(ctx: Context): List<Category> {
        synchronized(lock) {
            val raw = prefs(ctx).getString(KEY_CATEGORIES, null)
            if (raw == null) {
                seedDefaults(ctx)
                return DEFAULT_CATEGORIES
            }
            return try {
                val arr = JSONArray(raw)
                val out = ArrayList<Category>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val id = o.optString("id", "")
                    if (id.isEmpty()) continue
                    out.add(
                        Category(
                            id = id,
                            emoji = o.optString("emoji", ""),
                            label = o.optString("label", id),
                            color = o.optString("color", "#f5a623")
                        )
                    )
                }
                if (out.isEmpty()) DEFAULT_CATEGORIES else out
            } catch (_: Throwable) {
                DEFAULT_CATEGORIES
            }
        }
    }

    private fun seedDefaults(ctx: Context) {
        val arr = JSONArray()
        for (c in DEFAULT_CATEGORIES) {
            val o = JSONObject()
            o.put("id", c.id); o.put("emoji", c.emoji)
            o.put("label", c.label); o.put("color", c.color)
            arr.put(o)
        }
        prefs(ctx).edit().putString(KEY_CATEGORIES, arr.toString()).apply()
    }

    // --- pending logs (chooser -> JS drain) --------------------------------------------

    /**
     * Append one chooser tap. Read-modify-write under [lock] because the chooser can log
     * while a notification quick-action logs on another slot — neither may clobber the other.
     * `category` is a Category.id or the "__other__" sentinel.
     */
    fun addPendingLog(ctx: Context, slotStart: Long, category: String, ts: Long) {
        synchronized(lock) {
            val arr = try {
                JSONArray(prefs(ctx).getString(KEY_PENDING, "[]"))
            } catch (_: Throwable) {
                JSONArray()
            }
            val o = JSONObject()
            o.put("slotStart", slotStart)
            o.put("category", category)
            o.put("ts", ts)
            arr.put(o)
            prefs(ctx).edit().putString(KEY_PENDING, arr.toString()).apply()
        }
    }

    /** All queued logs as JS-friendly maps ({slotStart:Number, category:String, ts:Number}). */
    fun getPendingLogs(ctx: Context): List<Map<String, Any>> {
        synchronized(lock) {
            return try {
                val arr = JSONArray(prefs(ctx).getString(KEY_PENDING, "[]"))
                val out = ArrayList<Map<String, Any>>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    out.add(
                        mapOf(
                            // Longs are handed to JS as Doubles by expo-modules-core; that's
                            // lossless for epoch-ms values (well within 2^53).
                            "slotStart" to o.optLong("slotStart"),
                            "category" to o.optString("category"),
                            "ts" to o.optLong("ts")
                        )
                    )
                }
                out
            } catch (_: Throwable) {
                emptyList()
            }
        }
    }

    /** Empty the queue after JS has merged it (called by clearPendingLogs). Idempotent. */
    fun clearPendingLogs(ctx: Context) {
        synchronized(lock) {
            prefs(ctx).edit().putString(KEY_PENDING, "[]").apply()
        }
    }

    /**
     * ATOMICALLY read-and-clear the pending queue: return every queued log AND reset the store to
     * empty inside ONE [lock] block, so a chip tap that lands between a JS read and a JS clear can
     * never be wiped unread. This replaces the racy get()+clear() pair the JS drain used to do as
     * two separate native calls — a ping recorded during that gap was blanket-erased by the clear.
     * Anything added AFTER this returns stays queued for the next drain; nothing in the returned
     * batch is left behind. Same JS-friendly map shape as [getPendingLogs].
     */
    fun takePendingLogs(ctx: Context): List<Map<String, Any>> {
        synchronized(lock) {
            val out = try {
                val arr = JSONArray(prefs(ctx).getString(KEY_PENDING, "[]"))
                val list = ArrayList<Map<String, Any>>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    list.add(
                        mapOf(
                            "slotStart" to o.optLong("slotStart"),
                            "category" to o.optString("category"),
                            "ts" to o.optLong("ts")
                        )
                    )
                }
                list
            } catch (_: Throwable) {
                emptyList<Map<String, Any>>()
            }
            // Clear in the SAME critical section as the read — this is what makes it atomic.
            prefs(ctx).edit().putString(KEY_PENDING, "[]").apply()
            return out
        }
    }

    // --- schedule params (receiver re-chain + boot restore) ----------------------------

    /**
     * Remember the last schedule() args so PingReceiver can chain + BootReceiver can restore.
     * [pausedUntilMs] is the snooze horizon (epoch-ms): pings whose fire time is at/before it are
     * suppressed. 0 (the default) means "no snooze active".
     */
    fun saveParams(
        ctx: Context,
        intervalMin: Float,
        wakeMin: Int,
        sleepMin: Int,
        pausedUntilMs: Long = 0L,
        lockScreenPopup: Boolean = DEFAULT_LOCK_SCREEN_POPUP
    ) {
        synchronized(lock) {
            prefs(ctx).edit()
                .putFloat(KEY_INTERVAL, intervalMin) // Float: supports sub-minute test cadences (30s)
                .putInt(KEY_WAKE, wakeMin)
                .putInt(KEY_SLEEP, sleepMin)
                .putLong(KEY_PAUSED_UNTIL, pausedUntilMs)
                .putBoolean(KEY_LOCK_SCREEN_POPUP, lockScreenPopup)
                .apply()
        }
    }

    /** True once schedule() has run at least once — BootReceiver only re-arms if tracking. */
    fun hasParams(ctx: Context): Boolean =
        prefs(ctx).contains(KEY_INTERVAL)

    /** Interval in minutes as a Float (supports sub-minute test cadences, e.g. 0.5 = 30s). Guarded:
     *  a store written by an older build put an Int under this key — getFloat would throw on that,
     *  so fall back to the default rather than crash. */
    fun getInterval(ctx: Context): Float = try {
        prefs(ctx).getFloat(KEY_INTERVAL, DEFAULT_INTERVAL.toFloat())
    } catch (_: Throwable) {
        DEFAULT_INTERVAL.toFloat()
    }
    fun getWake(ctx: Context): Int = prefs(ctx).getInt(KEY_WAKE, DEFAULT_WAKE)
    fun getSleep(ctx: Context): Int = prefs(ctx).getInt(KEY_SLEEP, DEFAULT_SLEEP)

    /** Snooze horizon (epoch-ms). 0 = no active snooze. Read by fire() + the scheduler. */
    fun getPausedUntil(ctx: Context): Long = prefs(ctx).getLong(KEY_PAUSED_UNTIL, 0L)

    // --- "Other" focus slot (chooser -> app custom-label handoff) -----------------------
    // When the user taps the "Other" chip (locked path: PingActivity; unlocked: PingService) we
    // open the app so they can type a custom label — but the app needs to know WHICH slot. We stash
    // the slot here and JS reads-and-clears it on foreground (TimePing.consumeLaunchSlot) to open
    // Today's quick-entry for that slot. Without this the "Other" tap opened the app to nothing and
    // the custom label was silently lost.

    /** Remember the slot the user tapped "Other" for, so JS can open its quick-entry on foreground. */
    fun setFocusSlot(ctx: Context, slotStart: Long) {
        synchronized(lock) {
            prefs(ctx).edit().putLong(KEY_FOCUS_SLOT, slotStart).apply()
        }
    }

    /**
     * Read-and-clear the pending "Other" focus slot (0 if none), atomically so it's delivered to JS
     * exactly once. JS consumes this on cold start / foreground to open quick-entry for that slot.
     */
    fun takeFocusSlot(ctx: Context): Long {
        synchronized(lock) {
            val v = prefs(ctx).getLong(KEY_FOCUS_SLOT, 0L)
            if (v != 0L) prefs(ctx).edit().remove(KEY_FOCUS_SLOT).apply()
            return v
        }
    }

    /**
     * Whether a LOCKED-screen ping is allowed to take over the keyguard with the full-screen
     * chooser. Read by [PingService.render] to decide whether to attach setFullScreenIntent on the
     * locked branch; when false the locked ping stays just the floor notification. Defaults to ON
     * ([DEFAULT_LOCK_SCREEN_POPUP]) so a store written before this key existed keeps the old
     * full-screen-over-lock behaviour. Does NOT affect the unlocked/overlay branch.
     */
    fun getLockScreenPopup(ctx: Context): Boolean =
        prefs(ctx).getBoolean(KEY_LOCK_SCREEN_POPUP, DEFAULT_LOCK_SCREEN_POPUP)

    // --- hardcore (opt-in) : block the phone on unlock until the current block is answered --------

    fun setHardcore(ctx: Context, on: Boolean) {
        synchronized(lock) { prefs(ctx).edit().putBoolean(KEY_HARDCORE, on).apply() }
    }
    fun getHardcore(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_HARDCORE, false)

    /** Start epoch-ms of the interval block that CONTAINS `now` (floored to the interval step). */
    fun currentSlotStart(ctx: Context, now: Long = System.currentTimeMillis()): Long {
        val interval = getInterval(ctx)
        val safe = if (interval in 0.25f..1440f) interval else DEFAULT_INTERVAL.toFloat()
        val stepMs = (safe * 60_000f).toLong().coerceAtLeast(1L)
        return (now / stepMs) * stepMs
    }

    /**
     * Claim a slot for a hardcore prompt exactly once. Returns true (and records it) if this slot
     * hasn't been prompted yet; false if it already has — so unlocking 10× in one block prompts once.
     */
    fun claimHardcorePrompt(ctx: Context, slotStart: Long): Boolean {
        synchronized(lock) {
            val last = prefs(ctx).getLong(KEY_LAST_PROMPTED, 0L)
            if (last == slotStart) return false
            prefs(ctx).edit().putLong(KEY_LAST_PROMPTED, slotStart).apply()
            return true
        }
    }

    /** Wipe the stored params (called on cancelAll) so a reboot won't resurrect the pings. */
    fun clearParams(ctx: Context) {
        synchronized(lock) {
            prefs(ctx).edit()
                .remove(KEY_INTERVAL)
                .remove(KEY_WAKE)
                .remove(KEY_SLEEP)
                .remove(KEY_PAUSED_UNTIL)
                .remove(KEY_LOCK_SCREEN_POPUP)
                .apply()
        }
    }

    // --- window predicate (mirrors JS inPingWindow in src/lib/time.ts) -----------------

    /**
     * Is a FIRE time's minute-of-day inside the awake window? Byte-identical to the JS
     * `inPingWindow`: pings land in (wake, sleep] so the first ping is one slot AFTER wake,
     * and an overnight window (sleep < wake, e.g. 22:00->06:00) wraps midnight. wake==sleep
     * means "24h — always fire".
     */
    fun inPingWindow(mod: Int, wake: Int, sleep: Int): Boolean {
        if (wake == sleep) return true
        return if (wake < sleep) mod > wake && mod <= sleep
        else mod > wake || mod <= sleep
    }
}
