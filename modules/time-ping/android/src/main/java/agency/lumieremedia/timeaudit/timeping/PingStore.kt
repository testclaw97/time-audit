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
    // Kept here so PingReceiver (which posts the notification + FSI PendingIntent) and
    // PingActivity (which cancels that same notification when a chip is tapped) can never
    // drift on the id/channel — a mismatch would leave the notification stuck on screen.

    /** High-importance channel that carries the full-screen-intent ping. */
    const val CHANNEL_ID = "time-ping-fullscreen"

    /** Stable notification id — one live ping at a time; a new ping replaces the old. */
    const val NOTIF_ID = 4088

    /** AlarmManager broadcast: "fire a ping now" (carries slotStart + schedule params). */
    const val ACTION_FIRE = "agency.lumieremedia.timeaudit.timeping.ACTION_FIRE"

    /** Notification quick-action broadcast: "log this category for this slot" (no chooser). */
    const val ACTION_PICK = "agency.lumieremedia.timeaudit.timeping.ACTION_PICK"

    /** Intent extras shared across alarm / notification / activity. */
    const val EXTRA_SLOT_START = "slotStart"   // Long epoch ms of the slot being asked about
    const val EXTRA_INTERVAL = "intervalMin"   // Int minutes between pings
    const val EXTRA_WAKE = "wakeMin"           // Int minute-of-day the awake window opens
    const val EXTRA_SLEEP = "sleepMin"         // Int minute-of-day the awake window closes
    const val EXTRA_CATEGORY = "picked_category" // String category id for ACTION_PICK

    // requestCode scheme for the alarm PendingIntents. A PendingIntent's identity ignores
    // its extras, so DISTINCT request codes per boundary are what keep the scheduled alarms
    // from collapsing into one. The initial batch uses [REQ_ALARM_BASE .. +ALARM_CAP-1];
    // [REQ_CHAIN] is the single self-perpetuating "next" alarm armed by PingReceiver.
    const val REQ_ALARM_BASE = 47000
    const val ALARM_CAP = 60                       // hard cap on the initial batch (spec)
    const val REQ_CHAIN = REQ_ALARM_BASE + ALARM_CAP // 47060

    // --- SharedPreferences plumbing ----------------------------------------------------
    private const val PREFS = "time_ping"
    private const val KEY_CATEGORIES = "categories"
    private const val KEY_PENDING = "pending_logs"
    private const val KEY_INTERVAL = "interval"
    private const val KEY_WAKE = "wake"
    private const val KEY_SLEEP = "sleep"

    // Fallback schedule params if something reads before the first schedule() call.
    const val DEFAULT_INTERVAL = 15
    private const val DEFAULT_WAKE = 7 * 60   // 07:00
    private const val DEFAULT_SLEEP = 23 * 60 // 23:00

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

    // --- schedule params (receiver re-chain + boot restore) ----------------------------

    /** Remember the last schedule() args so PingReceiver can chain + BootReceiver can restore. */
    fun saveParams(ctx: Context, intervalMin: Int, wakeMin: Int, sleepMin: Int) {
        synchronized(lock) {
            prefs(ctx).edit()
                .putInt(KEY_INTERVAL, intervalMin)
                .putInt(KEY_WAKE, wakeMin)
                .putInt(KEY_SLEEP, sleepMin)
                .apply()
        }
    }

    /** True once schedule() has run at least once — BootReceiver only re-arms if tracking. */
    fun hasParams(ctx: Context): Boolean =
        prefs(ctx).contains(KEY_INTERVAL)

    fun getInterval(ctx: Context): Int = prefs(ctx).getInt(KEY_INTERVAL, DEFAULT_INTERVAL)
    fun getWake(ctx: Context): Int = prefs(ctx).getInt(KEY_WAKE, DEFAULT_WAKE)
    fun getSleep(ctx: Context): Int = prefs(ctx).getInt(KEY_SLEEP, DEFAULT_SLEEP)

    /** Wipe the stored params (called on cancelAll) so a reboot won't resurrect the pings. */
    fun clearParams(ctx: Context) {
        synchronized(lock) {
            prefs(ctx).edit()
                .remove(KEY_INTERVAL)
                .remove(KEY_WAKE)
                .remove(KEY_SLEEP)
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
