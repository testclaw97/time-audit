# RESUME AFTER COMPACT — Time Audit (2026-08-26)

## UPDATE — 2026-08-26 PM (while TJ walking): v0.3.1 JS finished + reviewed + fixed, CI green
- **v0.3.1 JS was already COMPLETE** (worker had finished SettingsScreen OEM UI + styles, lock-screen
  toggle, engine-health row, and the mandatory onboarding gate). tsc + web export clean. CI
  `assembleRelease` GREEN twice → Kotlin compiles, installable APK built (artifact `time-audit-release-apk`).
- **Two independent adversarial code reviews done** (native engine + JS/contract). Both corroborated a
  pending-log drain data-loss race. **6 surgical fixes applied + committed + pushed + CI-regated:**
  atomic `takePendingLogs()` (native+store, kills the drain race); onboarding notification-denial
  ESCAPE (canAskAgain → "Open settings" via Linking, no more permanent lockout); OEM finish-gate waits
  for Build.MANUFACTURER (closes fast-tap bypass); `cancelAll` also cancels REQ_TEST; `teardown()`
  cancels the check-in notif; `hydrate()` stops aliasing DEFAULT_SETTINGS.
- **RESOLVED this session (TJ's calls):**
  - **"Other" dead-end FIXED**: native `PingStore.setFocusSlot` on the Other tap in BOTH paths
    (PingActivity locked + PingService in-use) + `TimePing.consumeLaunchSlot()` + App.tsx consumes it
    on cold-start & foreground → opens Today quick-entry for that slot. (NEEDS on-device confirm.)
  - **Gate = NOTIFICATIONS-ONLY** (TJ chose this): overlay+exact demoted to a "RECOMMENDED" card
    (non-blocking); notifications stays required; OEM confirm stays required on Xiaomi/Samsung.
- **STILL OPEN — deferred by design (NOT fixed):**
  1. **Chain has no watchdog** (MEDIUM): if `armNextBoundary` returns false the cadence dies until
     app-open/reboot (both ARE partial backstops). Proper fix = WorkManager watchdog / non-rendering
     re-arm alarm — Phase-B reliability item.
  2. **Epoch-vs-local boundary drift** (LOW/cosmetic): coarse intervals (60m) in half-hour zones
     (India UTC+5:30) land at :30 not :00. Fine at 15m in Germany. Align to local midnight if it matters.
- **CI green at HEAD** (`android-build.yml` on feature/oem-onboarding, run 32978165152) — Kotlin
  compiles, installable APK artifact `time-audit-release-apk`. tsc + web export clean. NOT on-device, NOT released.
- Next: bring up the Poco F5 rig (step 1 below) → on-device test v0.3.1 (incl. the new Other path +
  notifications-only gate) → address the 2 deferred items if a device proves them → ship.

---


## Where we are (the big picture)
- **v0.3.0 shipped + CONFIRMED working on TJ's REAL phone** (Poco F5, Xiaomi Android 15 / MIUI V816).
  The full-screen popup fired over his locked screen — TJ saw it. The persistent-FGS engine + the
  popup code are CORRECT.
- **Root cause of "it never popped up" = MIUI proprietary permissions**, not the app. On Xiaomi the
  standard Android grants (overlay, full-screen-intent, notifications) are a TRAP — MIUI also needs
  its own hidden switches, which were OFF and silently blocking the popup:
  - `MIUIOP(10008)` = "Display pop-up windows while running in the background"
  - `MIUIOP(10020)` = "Show on lock screen" (caught it rejecting a live ping)
  - `MIUIOP(10021)` = "Autostart"
  Enabling them via `adb shell appops set <pkg> 10008/10020/10021 allow` + battery whitelist → popup worked.
- **Emulator/cloud CI was near-worthless** for this. The real device is the only truth.

## In flight: v0.3.1 = the durable OEM fix (branch `feature/oem-onboarding`, WIP, NOT built)
Makes the app walk the user through the OEM switches so nobody needs adb.
- **DONE (native, compiles-by-inspection):** `getManufacturer()`, `openOemAppPermissions()` (MIUI
  APP_PERM_EDITOR), `openOemAutostart()` (MIUI/Samsung/Oppo/Vivo/Huawei deep-links + a `<queries>`
  block for Android-11 package visibility), the `lockScreenPopup` toggle flow
  (schedule→PingStore→PingService.render skips FSI when off; BootReceiver persists it).
  Store gained `lockScreenPopup`(default true) + `oemSetupConfirmed`; App.tsx armPings passes it.
- **INCOMPLETE (worker killed mid-edit — FINISH THIS FIRST):**
  - `SettingsScreen.tsx` — OEM buttons ("Pop-up & lock-screen permissions" → openOemAppPermissions,
    "Autostart" → openOemAutostart, "Battery" → requestBatteryExemption), the "Show over lock screen"
    toggle (settings.lockScreenPopup), an engine-health row (`isEngineRunning()`), AND their
    StyleSheet styles (the worker died on "Now add the new Settings styles"). tsc passes but
    SettingsScreen likely references undefined styles → verify/complete.
  - `OnboardingScreen.tsx` — verify the mandatory essentials gate (notifications+overlay+exact-alarm
    required before finish) + the mandatory OEM step (on Xiaomi/Samsung: "3 extra switches" +
    "I've enabled these" → oemSetupConfirmed) + lock-screen optional toggle. (Worker had edited it.)
  - Then: `npx tsc --noEmit` + `npx expo export --platform web` clean → build APK.

## THE NEW TESTING LOOP (the point of this session) — dedicated Poco F5 rig over Tailscale
TJ is dedicating a spare **Poco F5** as an always-on test rig so I test every build MYSELF, no TJ time.
TJ has enabled **USB debugging** on it; setup checklist (confirm all done):
  Mi account signed in · **USB debugging (Security settings)** ON (needs Mi account — enables adb
  install + input injection; the thing that blocked me on his daily phone) · **Stay awake while
  charging** ON (stops the wireless-debug port rotating + Wi-Fi dropping on doze) · **Wireless
  debugging** ON · Tailscale signed in · plugged into power.

**My tooling is installed on the VPS and ready:** `~/bin/adb`, `~/.local/jdk17` (JAVA_HOME),
`~/.maestro` (Maestro 2.8.0), and `~/products/time-audit/scripts/phone-test.sh` (installs APK, grants
all perms + the MIUI ops, drives Maestro, locks, screencaps, verifies). Set PATH:
`export JAVA_HOME=~/.local/jdk17; export PATH="$HOME/bin:$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"`.

**adb-over-Tailscale facts:** TJ's DAILY phone = tailnet `poco-f5-8` @ **100.108.126.90**. Pairing
persists but the CONNECT port ROTATES on every screen-doze (need "Stay awake" to stop that).
Pair: `adb pair 100.108.126.90:<PAIRPORT> <CODE>` (from the "Pair with pairing code" popup), then
`adb connect 100.108.126.90:<CONNECTPORT>` (the MAIN Wireless-debugging screen's "IP address & Port"
— a DIFFERENT port). Read-only adb (screencap/dumpsys/appops/logcat) works WITHOUT USB-security;
input/install need USB-security (Mi account).

## PLAN AFTER COMPACT (in order)
1. **Bring up the dedicated Poco F5 rig.** Ask TJ for the new rig's pairing code + pair-port +
   connect-port (and which tailnet node it is). Pair + connect. Verify FULL control:
   `adb -s <serial> install -r -g <apk>` works AND `adb -s <serial> shell input keyevent 26` does
   NOT throw INJECT_EVENTS (i.e. USB-security is on). If input still throws → USB-security/Mi-account
   isn't fully enabled; guide TJ.
2. **Finish v0.3.1** (SettingsScreen OEM UI + styles, Onboarding gate — see above), gate, build APK.
3. **Test v0.3.1 on the rig, automated:** run scripts/phone-test.sh (adapt serial) — install, onboard
   via Maestro, grant standard perms + MIUI ops (10008/10020/10021) + battery, fire "Test the popup"
   repeatedly, lock + screencap (lock-screen path), switch app + screencap (in-use overlay), verify
   entries logged. Review screenshots. THIS is the real verification — no TJ testing.
4. **Ship v0.3.1** once verified on the rig; TJ installs on his daily phone (onboarding now guides the
   MIUI switches so it survives reboot — the adb-set ops from this session may NOT survive TJ's reboot).
5. **Phase B** (spec: `docs/PHASE-B-SPEC.md`): home = live stats on top + timetable (log→stats updates
   = retention loop); Stats tab (Hormozi blunt "you wasted X%" + 7-day stacked bars + annual
   projection); one-tap CATCH-UP for missed pings (fill the whole gap, no stacking); Material3
   bottom-nav Today/Stats/Settings + fix "back exits app"; weekly shareable reckoning card.
   Data model already carries Deep/Shallow/Reactive `kind` per category.

## Reliability follow-ups still owed (peer review)
WorkManager watchdog (self-heal OEM kills); consider `setAlarmClock()` if pings land late; silence
the floor notification on the overlay branch (avoid a heads-up over the overlay).

## Latest release: v0.3.0 → https://github.com/testclaw97/time-audit/releases/tag/v0.3.0
</content>
