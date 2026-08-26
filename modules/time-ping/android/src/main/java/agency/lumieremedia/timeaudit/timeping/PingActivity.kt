package agency.lumieremedia.timeaudit.timeping

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat

/**
 * The LOCKED / screen-off ping surface — one tap logs a slot straight from the lock screen. It is
 * launched by the check-in notification's full-screen intent (set by [PingService] on the locked
 * branch). The chooser view tree itself lives in [ChooserUi] (shared byte-for-byte with the
 * unlocked overlay path drawn by [PingService]); this Activity only owns the lock-screen surfacing
 * and the "picked / other / skip" lifecycle.
 *
 * WHY an Activity here and an overlay window there: an overlay (TYPE_APPLICATION_OVERLAY) cannot
 * draw over a secure keyguard, but an Activity with setShowWhenLocked can — so the locked case
 * MUST be an Activity, and it is reached via a full-screen-intent notification (which only launches
 * its Activity while the phone is LOCKED). [PingService.render] draws the overlay directly for the
 * unlocked/in-use case instead (a background Activity start is degraded to a heads-up on 14/15).
 *
 * Robustness is paramount: this activity can be shown OVER the lock screen, so a crash here could
 * wedge the user out of their phone. Every path that could throw is guarded and simply [finish]es
 * on failure — the activity can never get stuck.
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

            setContentView(buildChooser())
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
            setContentView(buildChooser())
        } catch (_: Throwable) {
            finishSafely()
        }
    }

    // --- the chooser (shared view tree) ------------------------------------------------

    /** Build the shared chooser, wiring its callbacks into this Activity's lifecycle. */
    private fun buildChooser() =
        ChooserUi.build(
            ctx = this,
            slotStart = slotStart,
            onPick = { categoryId -> recordAndFinish(categoryId) },
            onOther = { openAppForOther() },
            onSkip = { finishSafely() }
        )

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
            // Stash the slot so JS can open quick-entry for it on foreground (the launch-intent
            // extra below isn't readable from RN; this focus-slot is what actually delivers the slot).
            PingStore.setFocusSlot(this, slotStart)
            PingStore.addPendingLog(this, slotStart, ChooserUi.OTHER_SENTINEL, System.currentTimeMillis())
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
            NotificationManagerCompat.from(this).cancel(PingStore.CHECKIN_NOTIF_ID)
        } catch (_: Throwable) {
        }
    }

    private fun finishSafely() {
        try {
            finish()
        } catch (_: Throwable) {
        }
    }
}
