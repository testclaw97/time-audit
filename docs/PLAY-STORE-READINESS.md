# Time Audit — Google Play Production Readiness Plan

**Status at v0.4.0:** built, released as a sideloadable APK, verified end-to-end on ONE real
device (Poco F5 / Android 15 / MIUI). NOT production-grade for Play yet. This plan gets it there.

**Realistic timeline: ~3–5 weeks** — dominated by (a) the permission-policy risk in Phase 0 and
(b) Play's mandatory 14-day closed-test gate for new personal developer accounts (Phase 5).

---

## ⚠️ PHASE 0 — De-risk the permission model against Play policy (DO THIS FIRST)

The app's on-device reliability rests on a stack Google Play reviews **aggressively**, and any one
of these can get the app rejected. Resolve this BEFORE polishing anything, because it can change
the architecture.

- **FOREGROUND_SERVICE_SPECIAL_USE** — we run a *persistent* foreground service as the process
  anchor. Play requires a written justification and may reject a persistent FGS used only for
  periodic reminders ("use WorkManager/AlarmManager instead"). **Highest risk.**
- **USE_FULL_SCREEN_INTENT** (A14+) — Play restricts this to calling/alarm/clock apps. A reminder
  popup may not qualify → rejection risk.
- **SCHEDULE_EXACT_ALARM** (A13+) — needs the alarm/reminder-app exemption, or switch to
  `USE_EXACT_ALARM` (only for genuine alarm-clock apps).
- **SYSTEM_ALERT_WINDOW** — allowed but scrutinized; overlay-first apps get extra review.

**The core tension:** OEM reliability (MIUI/Samsung kills) is exactly why we added the persistent
FGS — but that's the permission Play likes least. Phase 0 decides one of:
1. **Keep the persistent FGS** with a bulletproof justification + Play declaration, OR
2. **Drop the persistent FGS**, move to exact-alarm + FSI-notification only (lighter, more
   Play-friendly, but less reliable on aggressive OEMs — must re-verify), OR
3. **Hybrid** — no persistent FGS by default; offer it as an opt-in "reliability mode".

**Tasks:**
- [ ] Read current Play policies: Foreground Services, Full-screen intent, Exact alarm, Overlay.
- [ ] Draft the permission-justification text for each (needed for the Console anyway).
- [ ] Decide the architecture (1/2/3 above). If it changes, re-run the on-device reliability test.
- [ ] (Optional but wise) Ask a peer / do a Play pre-review via an internal-testing upload to see
      what the review flags before investing in the listing.

---

## PHASE 1 — Product polish (launch-blocking)
- [ ] Remove/hide the **30s / 1m / 2m** test intervals (gate behind a hidden dev flag, not shipped).
- [ ] Soften the "popup can't fully work" banner (only nag when a *needed* grant is missing).
- [ ] Production **app icon** (adaptive, 512×512 for Play) + splash — replace the placeholder.
- [ ] Polish empty/error/first-run states.
- [ ] Timezone/DST correctness + the epoch-vs-local boundary drift at coarse intervals (India 60m).
- [ ] Verify the **"Other" custom-label** flow on device (native focus-slot → quick entry).
- [ ] Accessibility pass (labels, contrast, touch targets).

## PHASE 2 — Reliability (the historically hard part)
- [ ] **WorkManager watchdog** — self-heal after OEM kills (peer-recommended, still owed).
- [ ] Consider `setAlarmClock()` fallback for pings that land late under Doze.
- [ ] **Overnight + multi-day + reboot** survival test on the real phone (not just a single fire).
- [ ] **Battery draw** measurement at 15-min cadence; optimize if heavy.
- [ ] **Multi-device** test: Samsung + Pixel + another MIUI — via Firebase Test Lab / AWS Device
      Farm (free tiers) + the dedicated rig. The OEM deep-links are coded but device-unverified.

## PHASE 3 — Play Console setup + release engineering
- [ ] Confirm/create the **Google Play developer account** ($25 one-time). Decide publisher
      (personal vs a Lumiere Media org account).
- [ ] **Release signing**: generate an upload keystore, configure Gradle `signingConfig`, enroll in
      **Play App Signing**. (Current build is debug-signed — not acceptable for Play.)
- [ ] Switch CI to build an **`.aab`** (`bundleRelease`), not an APK — Play requires App Bundles.
- [ ] Version scheme: `versionCode` (monotonic int) + `versionName`.
- [ ] Target the **latest required `targetSdk`** (Play enforces a recent API level).
- [ ] Harden the **feedback endpoint** for public scale: rotate `FEEDBACK_TOKEN` OFF the public
      repo (it's currently visible), stronger abuse limits, monitor.

## PHASE 4 — Store listing + compliance
- [ ] **Privacy policy** — write + host at a URL (e.g. `lumieremedia.agency/timeaudit/privacy`).
      Cover: local-only data; feedback text you submit is sent to the developer (Telegram).
- [ ] **Data safety form** — mostly "no data collected/shared", but DISCLOSE the feedback send.
- [ ] **Content rating** (IARC questionnaire) — likely Everyone.
- [ ] **Permission declarations** in the Console for FGS-specialUse / FSI / exact-alarm (from Ph.0).
- [ ] **Store listing assets**: title, short (80 char) + full (4000 char) description, phone
      screenshots (2–8), feature graphic 1024×500, icon 512×512, category = Productivity, contact.
- [ ] **Name / trademark check** for "Time Audit" (other apps may share the name).

## PHASE 5 — Testing tracks → production (has a hard 2-week calendar gate)
- [ ] **Internal testing** track: upload the `.aab`, read the **Play pre-launch report** (auto-tests
      on real devices — catches crashes + policy issues) and fix.
- [ ] **Closed testing**: new personal dev accounts must run a **14-day closed test with ≥12
      testers** before production eligibility (2023 Play policy). Recruit testers EARLY — this is a
      calendar gate, not effort.
- [ ] Promote to **production** with a **staged rollout** (start at 10–20%).

---

## Open questions for TJ (answer before/at Phase 0–3)
1. **Google Play account** — do you have one? Publish as personal or Lumiere Media org?
2. **Monetization** — free / donations / paid? (affects listing + policy + the data-safety form)
3. **Name** — is "Time Audit" final? (availability + trademark)
4. **Timeline** — when do you want it live? (min ~3–4 weeks given the 14-day closed-test gate + review)

## Sequencing
Phase 0 → then 1 + 2 in parallel → then 3 + 4 in parallel → then 5 (start recruiting testers as
early as Phase 3 to run the 14-day clock concurrently). When we execute a code-heavy sub-phase
(watchdog, signing, permission-model change), write a detailed task plan for that piece then.
