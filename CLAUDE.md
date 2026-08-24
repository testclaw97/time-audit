# CLAUDE.md — Time Audit

Standalone Expo (React Native) + TypeScript Android app. Alex Hormozi's "15-minute rule":
every 15 minutes during the awake window the phone pings "What did you just do?"; the user
logs 1–2 words; over a day/week Insights show where time actually went. **Private,
local-only — no backend, no login, no network.**

- **Identity:** display name "Time Audit", slug `time-audit`, android package
  `agency.lumieremedia.timeaudit`, dark theme, portrait.
- **Accent:** warm amber `#f5a623` (+ teal `#38c8b0` for success/insight bars).
  Deliberately NOT Mr. Productive's violet — separate app.

## Structure
```
App.tsx                     nav + bootstrap + native-first ping arming + notification response wiring
modules/time-ping/          NATIVE Android module (Kotlin): full-screen category chooser + AlarmManager
src/theme.ts                design tokens (colors/space/radius/shadow/type)
src/lib/time.ts             pure slot math — slot size RUNTIME-CONFIGURABLE via configureSlotMinutes()
src/lib/store.ts            AsyncStorage persistence + reactive useStore(); categories + native bridge
src/lib/notifications.ts    expo-notifications fallback (web/iOS ONLY): schedule/cancel, direct-reply, parse
src/lib/insights.ts         aggregate slots -> ranked breakdown + unlogged bucket
src/screens/                Onboarding, Today, Insights, Settings
src/ui/                     Card, Button, PressableScale, FadeIn, QuickEntry, TimeField
```

## How the core works
- **Slot model:** a slot = one interval identified by its START epoch (default 15 min, aligned
  to :00/:15/:30/:45; the interval is user-configurable — 5/10/15/20/30/45/60 min — via
  `configureSlotMinutes()` in `time.ts`, driven off `settings.intervalMinutes`). A ping fires at
  a slot's END and asks about the slot that just ended (at 15 min, fire 10:15 → logs slot 10:00).
  Entries stored as `{ [slotStartEpoch]: {text, ts, category?} }` — `category` is a Category.id.
- **Native ping (Android — the real path):** `modules/time-ping/` (Kotlin, `Name("TimePing")`)
  owns scheduling + the popup. `AlarmManager.setExactAndAllowWhileIdle` → `PingReceiver` →
  high-importance notification with `setFullScreenIntent` → `PingActivity`
  (`setShowWhenLocked`/`setTurnScreenOn` + dismiss keyguard) renders a grid of category chips
  IN KOTLIN over the lock screen. Tapping a chip appends a PendingLog to SharedPreferences and
  finishes; `PingReceiver` chains the next alarm; `BootReceiver` re-arms after reboot. JS owns
  categories + interval, pushes them via `TimePing.setCategories()`, calls `TimePing.schedule()`,
  and DRAINS pending logs (`drainPendingLogs()` → `TimePing.getPendingLogs()`/`clearPendingLogs()`)
  into the entry store on every foreground. The `__other__` chip + "Skip" open the app / record
  nothing. Editable categories seed the SAME ids in Kotlin (`DEFAULT_CATEGORIES`) and JS.
- **Arming (App.tsx `armPings`):** ONE branch picks native vs expo by `isAvailable()` and runs
  exactly one — called on cold start, on `AppState` "active", and on any change to
  `intervalMinutes`/`wakeMinutes`/`sleepMinutes`/`tracking`. Native: sync categories → drain →
  schedule (tracking on) / cancelAll (off). Idempotent (schedule cancels+reschedules).
- **Expo-notifications fallback (web/iOS ONLY):** NO JS timer. A batch of DATE-triggered
  notifications (AlarmManager-backed → fire when app killed), next ~24h of in-window boundaries
  (capped 60, iOS pending limit 64), re-scheduled on foreground + cold start. Direct-reply
  category `time_audit_log` (`textInput`) → `parseResponse` → `logEntry(text, slotStart)`; a
  plain tap opens Today on the slot. This path NEVER runs on an Android build (native owns it).

## Verify
- `npx tsc --noEmit` (clean) · `npx expo export --platform web` (succeeds).
- Web preview: `npx expo export --platform web && npx serve -s dist -l 4173`.

## ⚠️ Landmines
- **On Android the NATIVE module owns pings (full-screen chooser); expo-notifications pings are
  the web/iOS fallback ONLY — never both (double popups).** `App.tsx armPings` branches on
  `isAvailable()` and runs exactly one path. If you ever call `reschedulePings` unguarded on
  Android you get two pings per slot (native chooser + expo banner).
- **Full-screen-intent + exact-alarm + battery-exemption are special-access perms; the chooser
  may not appear over the lock screen until granted.** `USE_FULL_SCREEN_INTENT` (Android 14+) and
  `SCHEDULE_EXACT_ALARM` (Android 12+) are settings bounces, not runtime dialogs; battery
  optimization can delay/kill the alarm. If the popup doesn't show, use Settings → "Test the
  popup" (`TimePing.triggerTestPing()`) and grant via the Permissions rows — don't assume broken.
- **Notifications are a no-op on web by design.** Every entry point in
  `src/lib/notifications.ts` guards on `Platform.OS === "web"`; the web export is only for
  visual/logic verification. The 15-min pings + direct-reply can ONLY be verified on a real
  Android build/emulator — do not claim they work from the web build.
- **`countScheduled()` returns 0 on web**, so Settings shows "0 check-ins queued" in the web
  preview. That is expected — on device it reflects the real AlarmManager queue.
- **Device reboot clears the OS notification queue** until the app is next opened (no
  backend, no boot receiver wired to JS). Opening the app re-arms via the foreground
  reschedule. This is the known trade-off of the local-only design — stated honestly in the
  Settings "How pings work" note.
- **AsyncStorage web backend keys are un-prefixed** (`ta:settings:v1`, `ta:entries:v1` land
  directly in `localStorage`) — handy for seeding demo data, but don't assume a prefix.
- **Direct-reply save path == in-app QuickEntry save path** (both call `store.logEntry`).
  Verifying QuickEntry on web verifies the storage half of direct-reply; the notification
  delivery half still needs a device.
- **iOS pending-notification cap is 64.** `reschedulePings` caps at 60 for headroom; a >16h
  awake window at 15-min cadence approaches this — the rolling 24h reschedule is what keeps
  it correct, not scheduling further ahead.
- **Android needs `SCHEDULE_EXACT_ALARM` + `POST_NOTIFICATIONS`** (declared in app.json).
  A real build must also handle the runtime POST_NOTIFICATIONS prompt (Android 13+) — done
  via `requestPermission()` in onboarding.
