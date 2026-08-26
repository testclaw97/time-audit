package agency.lumieremedia.timeaudit.timeping

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The ONE implementation of the full-screen category chooser view tree, shared by the two
 * surfaces that can present it:
 *
 *   · [PingActivity]  — the locked / screen-off path (an Activity with setShowWhenLocked can draw
 *                       over a secure keyguard; an overlay window cannot).
 *   · [PingService]   — the unlocked / in-use path (a TYPE_APPLICATION_OVERLAY window drawn from
 *                       the persistent foreground service; this sidesteps the Android 14+
 *                       background-activity-launch restriction that silently degrades a full-screen
 *                       INTENT to a heads-up while the phone is in use — the exact same mechanism
 *                       Mr. Productive's block screen uses).
 *
 * Both render IDENTICAL chips by calling [build] here, so the user sees the same UI whether the
 * ping arrives locked or unlocked. No res/ XML — the whole tree is built in Kotlin (matching
 * mp-blocker's BlockerService) so the module stays self-contained.
 *
 * The three callbacks let each caller decide what "picked / other / skipped" MEANS in its own
 * lifecycle (an Activity finish()es; the service tears down its window and stopSelf()s) while
 * the pixels stay in one place. Every callback is invoked from a chip's click listener on the
 * main thread; callers keep their own try/catch so a thrown callback can never wedge the screen.
 */
object ChooserUi {

    /** Sentinel category id for the "Other" chip — JS resolves it to a custom-label prompt. */
    const val OTHER_SENTINEL = "__other__"

    // Brand palette — deliberately amber, NOT Mr. Productive's violet (separate app).
    val BG = Color.parseColor("#0c0c0f")
    private val ACCENT = Color.parseColor("#f5a623")

    /**
     * Build the chooser view. [slotStart] is the epoch-ms of the slot being asked about (used
     * only to render the clock label). Chip taps fan out to:
     *   · [onPick] (categoryId)  — a real category was chosen
     *   · [onOther]              — the "📝 Other" chip (custom label in-app)
     *   · [onSkip]               — the quiet "Skip" (record nothing)
     *
     * Never throws for the common cases: if the category grid can't be built it degrades to just
     * the header + Skip rather than a broken half-screen.
     */
    fun build(
        ctx: Context,
        slotStart: Long,
        onPick: (categoryId: String) -> Unit,
        onOther: () -> Unit,
        onSkip: () -> Unit
    ): View {
        val scroll = ScrollView(ctx)
        scroll.setBackgroundColor(BG)
        scroll.isFillViewport = true

        val root = LinearLayout(ctx)
        root.orientation = LinearLayout.VERTICAL
        root.setBackgroundColor(BG)
        root.setPadding(dp(ctx, 20), dp(ctx, 48), dp(ctx, 20), dp(ctx, 28))
        // A ScrollView is a FrameLayout, so its child's params must be FrameLayout.LayoutParams
        // (Kotlin can't resolve the inherited `ScrollView.LayoutParams` via the subclass name).
        scroll.addView(
            root,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // --- header: the question + the slot's clock time ------------------------------
        val title = TextView(ctx)
        title.text = "What are you doing right now?"
        title.setTextColor(Color.parseColor("#f4f4f6"))
        title.textSize = 24f
        title.setTypeface(Typeface.DEFAULT_BOLD)
        root.addView(title)

        val time = TextView(ctx)
        time.text = clockFor(slotStart)
        time.setTextColor(ACCENT)
        time.textSize = 16f
        time.setTypeface(Typeface.DEFAULT_BOLD)
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.topMargin = dp(ctx, 6); it.bottomMargin = dp(ctx, 22); time.layoutParams = it }
        root.addView(time)

        // --- the 2-column grid of category chips ---------------------------------------
        try {
            val cats = PingStore.getCategories(ctx)
            var row: LinearLayout? = null
            for ((i, cat) in cats.withIndex()) {
                if (i % 2 == 0) {
                    row = newRow(ctx)
                    root.addView(row)
                }
                row!!.addView(buildChip(ctx, cat.emoji, cat.label, cat.color) {
                    onPick(cat.id)
                })
            }

            // "Other" chip (sentinel) — a custom typed label for this slot.
            val otherRow = if (cats.size % 2 == 0) newRow(ctx).also { root.addView(it) } else row!!
            otherRow.addView(buildChip(ctx, "📝", "Other", "#8a94a6") {
                onOther()
            })
            // If Other started a fresh row it's alone; pad the second cell so it keeps 50% width.
            if (cats.size % 2 == 0) {
                otherRow.addView(spacerCell(ctx))
            }
        } catch (_: Throwable) {
            // Grid failed to build for any reason — fall through to just the Skip affordance so
            // the surface is still dismissable rather than a broken half-screen.
        }

        // --- quiet "Skip" — records nothing --------------------------------------------
        val skip = TextView(ctx)
        skip.text = "Skip"
        skip.setTextColor(Color.parseColor("#6b7280"))
        skip.textSize = 15f
        skip.gravity = Gravity.CENTER
        skip.setPadding(dp(ctx, 12), dp(ctx, 20), dp(ctx, 12), dp(ctx, 8))
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.topMargin = dp(ctx, 8); skip.layoutParams = it }
        skip.isClickable = true
        skip.setOnClickListener { onSkip() }
        root.addView(skip)

        return scroll
    }

    private fun newRow(ctx: Context): LinearLayout {
        val row = LinearLayout(ctx)
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
        ctx: Context,
        emoji: String,
        label: String,
        colorHex: String,
        onTap: () -> Unit
    ): View {
        val catColor = parseColor(colorHex, ACCENT)

        val chip = LinearLayout(ctx)
        chip.orientation = LinearLayout.HORIZONTAL
        chip.gravity = Gravity.CENTER_VERTICAL
        chip.minimumHeight = dp(ctx, 64)
        chip.setPadding(dp(ctx, 14), dp(ctx, 14), dp(ctx, 14), dp(ctx, 14))

        val bg = GradientDrawable()
        bg.cornerRadius = dp(ctx, 16).toFloat()
        // 18% of the category color blended over the dark surface — a subtle, on-brand tint.
        bg.setColor(ColorUtils.blendARGB(BG, catColor, 0.18f))
        bg.setStroke(dp(ctx, 1), ColorUtils.setAlphaComponent(catColor, 0x66))
        chip.background = bg

        // colored dot
        val dot = View(ctx)
        val dotBg = GradientDrawable()
        dotBg.shape = GradientDrawable.OVAL
        dotBg.setColor(catColor)
        dot.background = dotBg
        (LinearLayout.LayoutParams(dp(ctx, 10), dp(ctx, 10))).also {
            it.rightMargin = dp(ctx, 10); dot.layoutParams = it
        }
        chip.addView(dot)

        val emojiView = TextView(ctx)
        emojiView.text = emoji
        emojiView.textSize = 22f
        (LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )).also { it.rightMargin = dp(ctx, 8); emojiView.layoutParams = it }
        chip.addView(emojiView)

        val labelView = TextView(ctx)
        labelView.text = label
        labelView.setTextColor(Color.parseColor("#e8e8ec"))
        labelView.textSize = 16f
        labelView.setTypeface(Typeface.DEFAULT_BOLD)
        labelView.maxLines = 2
        chip.addView(labelView)

        // Each cell takes half the row (weight 1) with a small gutter + vertical rhythm.
        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        lp.setMargins(dp(ctx, 4), dp(ctx, 4), dp(ctx, 4), dp(ctx, 4))
        chip.layoutParams = lp

        chip.isClickable = true
        chip.setOnClickListener { onTap() }
        return chip
    }

    /** An empty half-width cell so a lone chip in a row still occupies 50%. */
    private fun spacerCell(ctx: Context): View {
        val v = View(ctx)
        v.layoutParams = LinearLayout.LayoutParams(0, dp(ctx, 1), 1f)
        return v
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

    private fun dp(ctx: Context, value: Int): Int =
        (value * ctx.resources.displayMetrics.density).toInt()
}
