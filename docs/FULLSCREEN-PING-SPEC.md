# Full-Screen Category Ping — build spec (contract)

Goal (TJ's words): "basic categories, pre-put, that I can pick / add / remove / edit.
then every N minutes I get a **popup over everything on the screen**, that I can choose,
**even with screen closed**. and I can edit how often I get popups." Optimize for
**viral + dead-simple**: logging a slot must be a SINGLE tap from the lock screen.

This replaces the text-only expo-notification ping (on Android) with a native full-screen
chooser. iOS/web keep the expo-notifications fallback (no full-screen chooser there yet).

## Architecture

- **Native `modules/time-ping/` (Android)** owns scheduling + the full-screen chooser:
  AlarmManager (`setExactAndAllowWhileIdle`) → `PingReceiver` (BroadcastReceiver) → posts a
  high-importance notification with `setFullScreenIntent(pi, true)` → `PingActivity`
  (`setShowWhenLocked(true)` + `setTurnScreenOn(true)` + dismiss keyguard) rendering a grid
  of category chips built in Kotlin code (no XML/res, like mp-blocker's BlockerService).
  Tapping a chip appends a PendingLog to SharedPreferences and finishes. `PingReceiver` also
  chains the next alarm; `BootReceiver` reschedules after reboot (fixes the reboot landmine).
- **JS** owns categories + interval + draining pending logs into the entry store on
  foreground, and calls `TimePing.schedule(...)`. When the native module is present
  (Android build) it is the ONLY ping source — do NOT also run expo-notification pings, to
  avoid double-firing. When absent (web, iOS for now), fall back to expo-notifications.

## Native TS surface — `modules/time-ping/index.ts` (Name("TimePing"))

```ts
export interface PingCategory { id: string; emoji: string; label: string; color: string }
export interface PendingLog { slotStart: number; category: string; ts: number } // category = PingCategory.id or "__other__"
export interface TimePingModule {
  // schedule the rolling window of pings; returns count scheduled. Cancels+reschedules.
  schedule(opts: { intervalMinutes: number; wakeMinutes: number; sleepMinutes: number }): Promise<number>;
  cancelAll(): Promise<void>;
  setCategories(cats: PingCategory[]): Promise<void>;   // persisted for PingActivity to render
  getPendingLogs(): Promise<PendingLog[]>;              // logs the chooser recorded while app was away
  clearPendingLogs(): Promise<void>;
  triggerTestPing(): Promise<void>;                     // fire the chooser NOW (Settings "Test popup" + e2e)
  hasExactAlarm(): Promise<boolean>;                    // SCHEDULE_EXACT_ALARM (Android 12+)
  requestExactAlarm(): Promise<void>;                   // ACTION_REQUEST_SCHEDULE_EXACT_ALARM
  hasFullScreenIntent(): Promise<boolean>;              // USE_FULL_SCREEN_INTENT (Android 14+ special access)
  requestFullScreenIntent(): Promise<void>;             // ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
  hasBatteryExemption(): Promise<boolean>;              // ignoring battery optimizations?
  requestBatteryExemption(): Promise<void>;             // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
}
export function isAvailable(): boolean;                 // requireOptionalNativeModule("TimePing") != null
declare const TimePing: TimePingModule | null;
export default TimePing;
```

- The `__other__` chip on the chooser opens the app (launch intent) to the slot's quick-entry
  instead of recording a category (custom typing needs the RN UI + keyboard).
- Chooser also shows a "Skip" that just finishes (records nothing).
- Pending logs live in SharedPreferences `time_ping` key `pending_logs` = JSON array of
  `{slotStart, category, ts}`. Categories in `categories` key = JSON array of PingCategory.
- Every alarm carries its target `slotStart` (fireTime - intervalMs) in extras; the chooser
  stamps that into the PendingLog so a late tap still lands on the right slot.

## Store shape — `src/lib/store.ts`

```ts
export interface Category { id: string; emoji: string; label: string; color: string }
export interface Settings {
  onboarded: boolean; tracking: boolean;
  wakeMinutes: number; sleepMinutes: number;
  intervalMinutes: number;      // NEW — default 15; allowed 5/10/15/20/30/45/60
  categories: Category[];       // NEW — seeded with DEFAULT_CATEGORIES
}
export interface Entry { text: string; ts: number; category?: string } // category = Category.id; absent = custom/legacy
```

- `DEFAULT_SETTINGS.intervalMinutes = 15`, `.categories = DEFAULT_CATEGORIES`.
- Export `DEFAULT_CATEGORIES: Category[]` (below) and category CRUD, all persisting +
  emitting: `addCategory(partial): Category` (generates id), `updateCategory(id, patch)`,
  `removeCategory(id)`, `reorderCategories(orderedIds: string[])`, `resetCategories()`.
- Extend logging: `logEntry(text: string, slotStart?, category?: string)` — sets
  `{text, ts, category}`; empty text still clears the slot.
- Add `drainPendingLogs(): Promise<number>` — reads `TimePing.getPendingLogs()`, writes each
  via the same entries path (label resolved from category id → its `.label`, or the raw text
  for `__other__`), then `TimePing.clearPendingLogs()`. No-op when `!isAvailable()`. Returns
  count merged. Must be safe to call repeatedly (idempotent via clear).
- On `hydrate()` and whenever `intervalMinutes` changes, call `configureSlotMinutes(n)`
  (below) so slot math matches the interval, and push categories to native via
  `TimePing.setCategories(settings.categories)` when available.

## Slot math — `src/lib/time.ts`

- Introduce module-level slot size configurable at runtime:
  `export function configureSlotMinutes(min: number): void` sets an internal `SLOT_MS`
  (default 15 min). Keep `export const SLOTS_PER_HOUR` derived. All existing functions keep
  their signatures and just read the current SLOT_MS. (No unit tests exist to break.)
- `upcomingPings` etc. already parameterize wake/sleep; they now step by the configured slot.
- Guards that assume 96 slots/day must use `Math.ceil(1440 / slotMinutes)` bounds.

## DEFAULT_CATEGORIES (identical everywhere — native seed + JS seed must match ids)

```
work   💼 Work        #f5a623
deep   🎯 Deep work   #ffb84d
scroll 📱 Scrolling   #ff5d6c
eat    🍽️ Eating      #38c8b0
move   🏋️ Exercise    #7bd88f
rest   😴 Rest        #6c8cff
people 👥 People       #b98cff
fun    🎬 Leisure     #ff9f43
travel 🚗 Travel      #8a94a6
learn  🧠 Learning    #4dd0e1
```
Plus a virtual `__other__` chip (📝 Other) shown last on the chooser only — NOT stored in
`categories`, not editable. Native reads stored categories; JS appends the Other affordance
only in-app.

## UI

- **Settings:** a "Categories" section (list with emoji+label, tap to edit label/emoji/color,
  delete, "Add category", "Reset to defaults", drag or up/down reorder — up/down buttons are
  fine); a "How often?" interval selector (chips 5/10/15/20/30/45/60 min, 15 = "Hormozi"
  badge); a **"Test the popup"** button (`TimePing.triggerTestPing()`); and a Permissions
  block that shows/asks Exact-alarm, Full-screen-intent, Battery-exemption when
  `isAvailable()` and any is missing (each row: state + "Allow" → request*). Keep the
  existing awake-window + reset controls. Changing interval or window reschedules.
- **Today / QuickEntry:** logging a slot shows the category chips (emoji+label, colored) as
  one-tap options + a small "Custom…" text field. Tapping a chip calls
  `logEntry(cat.label, slot, cat.id)`. Timeline rows show the category color dot + emoji.
- **Insights:** group entries by `category` id when present (use the category's color + emoji
  + label), fall back to normalized text for custom/legacy entries. Durations use the
  configured interval, not a hardcoded 15.
- **Onboarding:** tighten the hook for virality — lead with the sticky stat ("You get ~1,000
  fifteen-minute blocks a week. Where do they go?"), one-tap promise ("just tap what you're
  doing — takes 2 seconds, even from your lock screen"), then window + interval + permission.

## app.json (Android)

Add permissions: `USE_FULL_SCREEN_INTENT`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
(keep existing SCHEDULE_EXACT_ALARM, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED). The module
manifest declares `PingActivity` (showWhenLocked/turnScreenOn, excludeFromRecents,
theme dialog/translucent), `PingReceiver`, `BootReceiver` (BOOT_COMPLETED), and
USE_FULL_SCREEN_INTENT — merged into the host manifest.

## Verify (I, the integrator, run these — not the workers)

1. `npx tsc --noEmit` clean. 2. `npx expo export --platform web` succeeds (web fallback path,
no native import crash — guard on isAvailable). 3. CI `assembleRelease` builds the APK with
the new module. 4. CI emulator e2e: `triggerTestPing` (or `am broadcast`) → screenshot the
full-screen chooser over the lock screen → tap a chip → assert a PendingLog recorded (logcat
/ prefs) → `dumpsys alarm` shows scheduled pings. That is the real proof the popup fires.
</content>
</invoke>
