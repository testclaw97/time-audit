# HANDOFF — Time Audit

## Quick State

**Last session:** 2026-08-25.
**Status:** **v0.3.0 SHIPPED — reliability rebuild, awaiting TJ real-device confirmation.** On TJ's real Android 14/15 phone the popup did NOT fire despite green emulator CI (emulator can't reproduce A14/15 FSI + Samsung/Xiaomi kills — TJ's phone is the only real test). Rebuilt `time-ping` to the app-blocker pattern: ONE persistent foreground service `PingService` (specialUse, permanent "Time Audit is on" notice) stays alive; cadence = self-rescheduling exact alarm ONLY (no in-service Handler); `render()` ALWAYS posts a notification-with-category-buttons FLOOR (no special perm, can't silently fail) + overlay (unlocked+SAW) + FSI→PingActivity (locked); no stacking; `isEngineRunning()` health flag. Categories carry Deep/Shallow/Reactive `kind`. **NEXT (Phase B, spec in `docs/PHASE-B-SPEC.md`, after TJ confirms firing):** home = live-stats-on-top + timetable, Stats tab (Hormozi), catch-up for missed pings (one-tap gap fill, no stacking), lock-screen toggle, bottom-nav + back fix, permission-ladder onboarding, WorkManager watchdog, weekly reckoning card. Design bar: fast/easy/quick.

- **Screens (all render on-device):** Onboarding (window picker + "Start tracking"), Today (15-min timeline + NOW block + unlogged gaps), Insights (ranked breakdown by activity), Settings. Amber `#f5a623` accent (NOT Mr. Productive's violet). See `CLAUDE.md` for structure + landmines.
- **Core VERIFIED on-device:** "Start tracking" schedules `RTC_WAKEUP` alarms into AlarmManager **exactly 900,000ms (15 min) apart** (proven via `dumpsys alarm`). AlarmManager-backed → fire when app is killed. Direct-reply category `time_audit_log` (textInput) logs without opening the app; same `store.logEntry` path as the in-app QuickEntry (storage half proven on web).
- **Build/CI:** github.com/testclaw97/time-audit (PUBLIC, account `testclaw97`, `unset GITHUB_TOKEN` for gh). Repo root IS the app (no app/ subdir). Workflows: `android-build.yml` (release APK on master push), `android-fullscreen-e2e.yml` (builds APK + drives the popup on an API-33 emulator — the v0.2 proof), `android-e2e.yml` (older tour, master-only). Branch **master**. **Latest release v0.2.0**: https://github.com/testclaw97/time-audit/releases/tag/v0.2.0 (v0.1.0 was the text-ping build).
- **Landmines (also in CLAUDE.md):** notifications no-op on web (guarded); `countScheduled()`=0 on web; **reboot clears the OS alarm queue** until app reopened (no boot receiver); iOS pending cap 64 (reschedules rolling 24h, caps 60); needs `SCHEDULE_EXACT_ALARM` + `POST_NOTIFICATIONS` (in app.json).
- **Real-device caveats to watch:** some phones' battery optimization delays background pings (whitelist in Settings→Battery); reboot pauses pings till reopen.

**Open / next ideas (TJ's call):** rename to something punchier (Ping/Tally/Reckon/"15"), weekly summary + streaks, export/CSV, Play-store publish ($25 + gov-ID + 12-tester/14-day test). iOS = same Apple gates as Mr. Productive (Mac + $99 + TestFlight).

**Read first:** `CLAUDE.md` (structure + how scheduling/direct-reply work + landmines).
