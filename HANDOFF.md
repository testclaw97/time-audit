# HANDOFF — Time Audit

## Quick State

**Last session:** 2026-08-25.
**Status:** **v0.3.0 shipped + CONFIRMED working on TJ's real Xiaomi** (popup fired over his locked screen — human-verified). Root cause of prior "never popped": **MIUI proprietary permissions** (background-popup/show-on-lockscreen/autostart) were off — standard Android perms are a trap on Xiaomi/Samsung. **IN FLIGHT: v0.3.1 = OEM-permission onboarding** (branch `feature/oem-onboarding`, WIP — native OEM deep-links + lockScreenPopup toggle DONE; Onboarding/SettingsScreen OEM UI + styles NEED FINISHING). **NEW TESTING LOOP:** dedicated always-on **Poco F5 test rig over Tailscale wireless-adb** so Claude tests every build itself (VPS has ~/bin/adb + ~/.local/jdk17 + ~/.maestro + scripts/phone-test.sh; TJ enabling USB-debugging(Security) + Stay-awake on a spare Poco F5). **FULL PLAN + all facts (MIUI ops, adb-over-tailscale, finish list) → `docs/RESUME-AFTER-COMPACT.md` — READ THAT FIRST after compact + `git checkout feature/oem-onboarding`.** Phase B (home live-stats+timetable, Stats tab, catch-up, nav) spec in docs/PHASE-B-SPEC.md.

- **Screens (all render on-device):** Onboarding (window picker + "Start tracking"), Today (15-min timeline + NOW block + unlogged gaps), Insights (ranked breakdown by activity), Settings. Amber `#f5a623` accent (NOT Mr. Productive's violet). See `CLAUDE.md` for structure + landmines.
- **Core VERIFIED on-device:** "Start tracking" schedules `RTC_WAKEUP` alarms into AlarmManager **exactly 900,000ms (15 min) apart** (proven via `dumpsys alarm`). AlarmManager-backed → fire when app is killed. Direct-reply category `time_audit_log` (textInput) logs without opening the app; same `store.logEntry` path as the in-app QuickEntry (storage half proven on web).
- **Build/CI:** github.com/testclaw97/time-audit (PUBLIC, account `testclaw97`, `unset GITHUB_TOKEN` for gh). Repo root IS the app (no app/ subdir). Workflows: `android-build.yml` (release APK on master push), `android-fullscreen-e2e.yml` (builds APK + drives the popup on an API-33 emulator — the v0.2 proof), `android-e2e.yml` (older tour, master-only). Branch **master**. **Latest release v0.2.0**: https://github.com/testclaw97/time-audit/releases/tag/v0.2.0 (v0.1.0 was the text-ping build).
- **Landmines (also in CLAUDE.md):** notifications no-op on web (guarded); `countScheduled()`=0 on web; **reboot clears the OS alarm queue** until app reopened (no boot receiver); iOS pending cap 64 (reschedules rolling 24h, caps 60); needs `SCHEDULE_EXACT_ALARM` + `POST_NOTIFICATIONS` (in app.json).
- **Real-device caveats to watch:** some phones' battery optimization delays background pings (whitelist in Settings→Battery); reboot pauses pings till reopen.

**Open / next ideas (TJ's call):** rename to something punchier (Ping/Tally/Reckon/"15"), weekly summary + streaks, export/CSV, Play-store publish ($25 + gov-ID + 12-tester/14-day test). iOS = same Apple gates as Mr. Productive (Mac + $99 + TestFlight).

**Read first:** `CLAUDE.md` (structure + how scheduling/direct-reply work + landmines).
