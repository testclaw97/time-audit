package agency.lumieremedia.timeaudit.timeping

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.ColorUtils
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The full-screen category chooser — the whole point of the app: one tap logs a slot straight
 * from the lock screen. Built entirely in Kotlin (no res/ XML, like mp-blocker's
 * BlockerService) so the module stays self-contained: a dark full-bleed surface with amber
 * accents, the slot's clock time, and a scrollable 2-column grid of category chips.
 *
 * Robustness is paramount: this activity can be shown OVER the lock screen, so a crash here
 * could wedge the user out of their phone. Every path that could throw is guarded and simply
 * [finish]es on failure — the activity can never get stuck.
 */
class PingActivity : Activity() {

    private var slotStart: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            showOverLockScreen()

            slotStart = intent?.getLongExtra(PingStore.EXTRA_SLOT_START, 0L) ?: 0L
            if (slotStart <= 0L) {
                // Defensive: fall back to "now" so a stray launch still targets a real slot.
                slotStart = System.currentTimeMillis()
            }

            setContentView(buildRoot())
        } catch (_: Throwable) {
            // Anything unexpected: never wedge the lock screen — just close.
            finishSafely()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        // singleTask: a fresh ping while one is up reuses this instance — refresh the slot.
        super.onNewIntent(intent)
        try {
            setIntent(intent)
            slotStart = intent?.getLongExtra(PingStore.EXTRA_SLOT_START, 0L)
                ?.takeIf { it > 0L } ?: System.currentTimeMillis()
            setContentView(buildRoot())
        } catch (_: Throwable) {
            finishSafely()
        }
    }

    // --- lock-screen surfacing ---------------------------------------------------------

    private fun showOverLockScreen() {
        // API 27+ has the first-class setShowWhenLocked/setTurnScreenOn; older devices use the
        // equivalent window flags. KEEP_SCREEN_ON stops the chooser dimming mid-decision.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Ask the keyguard to step aside so the tap goes straight to a chip (no unlock first).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            km?.requestDismissKeyguard(this, null)
        }
    }

    // --- view tree ---------------------------------------------------------------------

    private fun buildRoot(): View {
        val scroll = ScrollView(this)
        scroll.setBackgroundColor(BG)
        scroll.isFillViewport = true

        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setBackgroundColor(BG)
        root.setPadding(dp(20), dp(48), dp(20), dp(28))
        // A ScrollView is a FrameLayout, so its child's params must be FrameLayout.LayoutParams
        // (Kotlin can't resolve the inherited `ScrollView.LayoutParams` via the subclass name).
        scroll.addView(
            root,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // --- header: the question + the slot's clock time -----------------------------
        val title = TextView(this)
        title.text = "What are you doing right now?"
        title.setTextColor(Color.parseColor("#f4f4f6"))
        title.textSize = 24f
        title.setTypeface(Typeface.DEFAULT_BOLD)
        root.addView(title)

        val time = TextView(this)
        time.text = clockFor(slotStart)
        time.setTextColor(ACCENT)
        time.textSize = 16f
        time.setTypeface(Typeface.DEFAULT_BOLD)
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.topMargin = dp(6); it.bottomMargin = dp(22); time.layoutParams = it }
        root.addView(time)

        // --- the 2-column grid of category chips --------------------------------------
        try {
            val cats = PingStore.getCategories(this)
            var row: LinearLayout? = null
            for ((i, cat) in cats.withIndex()) {
                if (i % 2 == 0) {
                    row = newRow()
                    root.addView(row)
                }
                row!!.addView(buildChip(cat.emoji, cat.label, cat.color) {
                    recordAndFinish(cat.id)
                })
            }

            // "Other" chip (sentinel) — opens the app for a custom typed label.
            val otherRow = if (cats.size % 2 == 0) newRow().also { root.addView(it) } else row!!
            otherRow.addView(buildChip("📝", "Other", "#8a94a6") {
                openAppForOther()
            })
            // If Other started a fresh row it's alone; pad the second cell so it keeps 50% width.
            if (cats.size % 2 == 0) {
                otherRow.addView(spacerCell())
            }
        } catch (_: Throwable) {
            // If the grid can't be built for any reason, don't leave a broken half-screen on
            // the lock screen — bail out cleanly.
            finishSafely()
            return scroll
        }

        // --- quiet "Skip" — records nothing -------------------------------------------
        val skip = TextView(this)
        skip.text = "Skip"
        skip.setTextColor(Color.parseColor("#6b7280"))
        skip.textSize = 15f
        skip.gravity = Gravity.CENTER
        skip.setPadding(dp(12), dp(20), dp(12), dp(8))
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.topMargin = dp(8); skip.layoutParams = it }
        skip.setOnClickListener { finishSafely() }
        root.addView(skip)

        return scroll
    }

    private fun newRow(): LinearLayout {
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        return row
    }

    /**
     * A single tappable chip: rounded surface tinted ~18% from the category color, a colored
     * dot, a big emoji and the label. min 64dp tall + generous padding for a thumb target.
     */
    private fun buildChip(
        emoji: String,
        label: String,
        colorHex: String,
        onTap: () -> Unit
    ): View {
        val catColor = parseColor(colorHex, ACCENT)

        val chip = LinearLayout(this)
        chip.orientation = LinearLayout.HORIZONTAL
        chip.gravity = Gravity.CENTER_VERTICAL
        chip.minimumHeight = dp(64)
        chip.setPadding(dp(14), dp(14), dp(14), dp(14))

        val bg = GradientDrawable()
        bg.cornerRadius = dp(16).toFloat()
        // 18% of the category color blended over the dark surface — a subtle, on-brand tint.
        bg.setColor(ColorUtils.blendARGB(BG, catColor, 0.18f))
        bg.setStroke(dp(1), ColorUtils.setAlphaComponent(catColor, 0x66))
        chip.background = bg

        // colored dot
        val dot = View(this)
        val dotBg = GradientDrawable()
        dotBg.shape = GradientDrawable.OVAL
        dotBg.setColor(catColor)
        dot.background = dotBg
        (LinearLayout.LayoutParams(dp(10), dp(10))).also {
            it.rightMargin = dp(10); dot.layoutParams = it
        }
        chip.addView(dot)

        val emojiView = TextView(this)
        emojiView.text = emoji
        emojiView.textSize = 22f
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.rightMargin = dp(8); emojiView.layoutParams = it }
        chip.addView(emojiView)

        val labelView = TextView(this)
        labelView.text = label
        labelView.setTextColor(Color.parseColor("#e8e8ec"))
        labelView.textSize = 16f
        labelView.setTypeface(Typeface.DEFAULT_BOLD)
        labelView.maxLines = 2
        chip.addView(labelView)

        // Each cell takes half the row (weight 1) with a small gutter + vertical rhythm.
        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        lp.setMargins(dp(4), dp(4), dp(4), dp(4))
        chip.layoutParams = lp

        chip.isClickable = true
        chip.setOnClickListener { onTap() }
        return chip
    }

    /** An empty half-width cell so a lone chip in a row still occupies 50%. */
    private fun spacerCell(): View {
        val v = View(this)
        v.layoutParams = LinearLayout.LayoutParams(0, dp(1), 1f)
        return v
    }

    // --- actions -----------------------------------------------------------------------

    private fun recordAndFinish(categoryId: String) {
        try {
            PingStore.addPendingLog(this, slotStart, categoryId, System.currentTimeMillis())
        } catch (_: Throwable) {
        }
        dismissNotification()
        finishSafely()
    }

    /** "Other" → open the app's launcher so the user can type a custom label for this slot. */
    private fun openAppForOther() {
        try {
            PingStore.addPendingLog(this, slotStart, OTHER_SENTINEL, System.currentTimeMillis())
            val launch = packageManager.getLaunchIntentForPackage(packageName)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                launch.putExtra(PingStore.EXTRA_SLOT_START, slotStart)
                startActivity(launch)
            }
        } catch (_: Throwable) {
        }
        dismissNotification()
        finishSafely()
    }

    private fun dismissNotification() {
        try {
            NotificationManagerCompat.from(this).cancel(PingStore.NOTIF_ID)
        } catch (_: Throwable) {
        }
    }

    private fun finishSafely() {
        try {
            finish()
        } catch (_: Throwable) {
        }
    }

    // --- helpers -----------------------------------------------------------------------

    private fun clockFor(epoch: Long): String =
        try {
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epoch))
        } catch (_: Throwable) {
            ""
        }

    private fun parseColor(hex: String, fallback: Int): Int =
        try {
            Color.parseColor(hex)
        } catch (_: Throwable) {
            fallback
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val OTHER_SENTINEL = "__other__"
        private val BG = Color.parseColor("#0c0c0f")
        private val ACCENT = Color.parseColor("#f5a623")
    }
}
