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
App.tsx                     nav + bootstrap + notification response wiring
src/theme.ts                design tokens (colors/space/radius/shadow/type)
src/lib/time.ts             pure 15-min slot math (no deps, testable)
src/lib/store.ts            AsyncStorage persistence + reactive useStore() (useSyncExternalStore)
src/lib/notifications.ts    schedule/cancel pings, direct-reply category, response parsing
src/lib/insights.ts         aggregate slots -> ranked breakdown + unlogged bucket
src/screens/                Onboarding, Today, Insights, Settings
src/ui/                     Card, Button, PressableScale, FadeIn, QuickEntry, TimeField
```

## How the core works
- **Slot model:** a slot = 15 min identified by its START epoch (aligned to :00/:15/:30/:45).
  A ping fires at a slot's END and asks about the slot that just ended (fire 10:15 → logs
  slot 10:00). Entries stored as `{ [slotStartEpoch]: {text, ts} }`.
- **Scheduling (reliability):** NO JS timer. We hand the OS a batch of DATE-triggered
  notifications (AlarmManager-backed on Android → fire when app is killed). We schedule the
  next ~24h of in-window boundaries (capped 60, iOS pending limit is 64) and RE-SCHEDULE on
  every app foreground (`AppState` active) and on cold start.
- **Direct reply:** notification category `time_audit_log` has a `textInput` action, so the
  user types 1–2 words on the notification and submits WITHOUT opening the app.
  `addNotificationResponseReceivedListener` → `parseResponse` → `logEntry(text, slotStart)`.
  A plain tap opens Today focused on that slot.

## Verify
- `npx tsc --noEmit` (clean) · `npx expo export --platform web` (succeeds).
- Web preview: `npx expo export --platform web && npx serve -s dist -l 4173`.

## ⚠️ Landmines
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
