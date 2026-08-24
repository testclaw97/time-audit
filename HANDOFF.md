# HANDOFF — Time Audit

## Quick State

**Last session:** 2026-08-24 (built from scratch).
**Status:** Android app **v0.1.0 — built, published, verified on a real emulator.** Standalone Expo (RN+TS), local-only (no backend/login). Alex Hormozi's 15-minute rule: every 15 min in the awake window the phone pings "What did you just do?", user logs 1–2 words (direct-reply from the notification), Insights show where time went.

- **Screens (all render on-device):** Onboarding (window picker + "Start tracking"), Today (15-min timeline + NOW block + unlogged gaps), Insights (ranked breakdown by activity), Settings. Amber `#f5a623` accent (NOT Mr. Productive's violet). See `CLAUDE.md` for structure + landmines.
- **Core VERIFIED on-device:** "Start tracking" schedules `RTC_WAKEUP` alarms into AlarmManager **exactly 900,000ms (15 min) apart** (proven via `dumpsys alarm`). AlarmManager-backed → fire when app is killed. Direct-reply category `time_audit_log` (textInput) logs without opening the app; same `store.logEntry` path as the in-app QuickEntry (storage half proven on web).
- **Build/CI:** github.com/testclaw97/time-audit (PUBLIC, account `testclaw97`, `unset GITHUB_TOKEN` for gh). Repo root IS the app (no app/ subdir). `.github/workflows/android-build.yml` (release APK) + `android-e2e.yml` (emulator tour + AlarmManager dump). Branch is **master** (Expo scaffold default). Latest release **v0.1.0**: https://github.com/testclaw97/time-audit/releases/tag/v0.1.0
- **Landmines (also in CLAUDE.md):** notifications no-op on web (guarded); `countScheduled()`=0 on web; **reboot clears the OS alarm queue** until app reopened (no boot receiver); iOS pending cap 64 (reschedules rolling 24h, caps 60); needs `SCHEDULE_EXACT_ALARM` + `POST_NOTIFICATIONS` (in app.json).
- **Real-device caveats to watch:** some phones' battery optimization delays background pings (whitelist in Settings→Battery); reboot pauses pings till reopen.

**Open / next ideas (TJ's call):** rename to something punchier (Ping/Tally/Reckon/"15"), weekly summary + streaks, export/CSV, Play-store publish ($25 + gov-ID + 12-tester/14-day test). iOS = same Apple gates as Mr. Productive (Mac + $99 + TestFlight).

**Read first:** `CLAUDE.md` (structure + how scheduling/direct-reply work + landmines).
