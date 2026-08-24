# RESUME — Full-Screen Category Ping build (paused 2026-08-24)

Session was stopped mid-build so TJ could resume in another browser. **Nothing committed** —
all state below is uncommitted in the working tree on branch `master`. Read
`docs/FULLSCREEN-PING-SPEC.md` first — it is the full contract every task codes against.

## What TJ asked for
Time Audit: (1) pre-loaded editable categories (pick/add/remove/edit/reorder),
(2) a popup that appears **over everything, even with the screen off**, every N minutes,
where you tap a category (one tap), (3) editable ping frequency, (4) viral + dead-simple,
(5) test it end-to-end on an emulator like a human.

## Exact state on disk (git status master, all UNCOMMITTED)
| File(s) | Worker | State |
|---|---|---|
| `docs/FULLSCREEN-PING-SPEC.md` | — | ✅ the contract spec (source of truth) |
| `src/lib/store.ts`, `src/lib/time.ts` | B (TS core) | ✅ WRITTEN — **unverified** (`tsc` not yet run). Categories CRUD, `intervalMinutes`, `configureSlotMinutes`, `drainPendingLogs`, `syncCategoriesToNative` should be here — CONFIRM by reading. |
| `modules/time-ping/{index.ts, expo-module.config.json, android/build.gradle, android/src/main/AndroidManifest.xml}` | A (native) | ⚠️ PARTIAL — scaffold only. |
| `modules/time-ping/android/src/main/java/.../*.kt` | A (native) | ❌ MISSING — **zero Kotlin files written**. Need: `TimePingModule.kt`, `PingScheduler.kt`, `PingStore.kt`, `PingReceiver.kt`, `BootReceiver.kt`, `PingActivity.kt` (package `agency.lumieremedia.timeaudit.timeping`). |
| `src/screens/*`, `src/ui/QuickEntry.tsx` | C (UI) | ❌ NOT DONE — untouched. |
| `App.tsx`, `app.json`, `CLAUDE.md`, `HANDOFF.md` | D (wiring) | ❌ NOT DONE — untouched. |

## Remaining work to resume (in order)
1. **Finish Worker A's Kotlin** — the 6 files above, per the `modules/time-ping/` section of the
   spec. Mirror the working sibling module for structure/quality:
   `~/products/mr-productive/app/modules/mp-blocker/android/src/main/java/.../` (esp.
   `BlockerService.kt` = how to build Android views in pure Kotlin, and `MpBlockerModule.kt`).
   Read the already-written `modules/time-ping/index.ts` + `AndroidManifest.xml` first so the
   Kotlin matches the declared `Name("TimePing")`, activity/receiver names, and permissions.
2. **Run Worker C (UI screens)** and **Worker D (wiring App.tsx + app.json + docs)** — prompts
   are in this session's history; re-derive from the spec's "UI" and "app.json"/"Architecture"
   sections. Contract signatures are pinned in the spec so they can be run in parallel with (1).
3. **Gate + integrate:** `npx tsc --noEmit` clean; `npx expo export --platform web` succeeds
   (native calls must be guarded by `isAvailable()` so web never imports the native side).
4. **Verify on device (the real proof):** push to GitHub (`testclaw97/time-audit`, branch
   `master`, `unset GITHUB_TOKEN` for gh) → CI `android-build.yml` builds the release APK →
   update `android-e2e.yml` + `.maestro/tour.yaml` to: onboard → Settings → "Test the popup" →
   screenshot the full-screen chooser with category chips → tap a chip → reopen → assert the
   slot is logged (drainPendingLogs) → `dumpsys alarm | grep timeaudit` proves pings are queued
   for screen-off firing. Adapt Maestro selectors to the ACTUAL button/label text worker C used.

## Notes / risks to watch
- Local Expo modules under `modules/` autolink on `expo prebuild` (no config plugin needed) —
  proven by mp-blocker in the sibling repo.
- Full-screen-intent (Android 14+), exact-alarm (12+), battery-exemption are special-access
  perms — the chooser may not appear over the lock screen until granted; the Settings
  "Permissions" block + "Test the popup" button exist to grant + verify.
- On Android the NATIVE module must own pings; gate the old expo-notifications pings behind
  `!isAvailable()` (worker D) or you get DOUBLE popups.
- store.ts/time.ts are written but NOT yet type-checked — first `tsc` after finishing may
  surface contract drift (esp. the `SLOT_MS` vs `getSlotMs()` handling in time.ts).
</content>
