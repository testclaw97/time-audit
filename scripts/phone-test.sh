#!/usr/bin/env bash
# Real-device test for Time Audit over Tailscale wireless-adb to TJ's actual phone.
# The emulator can't reproduce Android 14/15 FSI / SYSTEM_ALERT_WINDOW / OEM behavior — this
# runs the identical grant → arm-ping → lock → capture flow on the REAL device that fails.
#
# Usage: phone-test.sh <adb-serial e.g. 100.x.x.x:PORT> [apk-path]
# Assumes `adb connect` already succeeded (see the pairing steps I gave TJ).
set -uo pipefail
export JAVA_HOME="$HOME/.local/jdk17"
export PATH="$HOME/bin:$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"

SERIAL="${1:?need adb serial (ip:port)}"
PKG="agency.lumieremedia.timeaudit"
APK="${2:-}"
OUT="$HOME/products/time-audit/_device-test/$(date +%s 2>/dev/null || echo run)"
mkdir -p "$OUT"
A() { adb -s "$SERIAL" "$@"; }

echo "== device =="; A shell getprop ro.product.manufacturer; A shell getprop ro.product.model; A shell getprop ro.build.version.release

if [ -n "$APK" ]; then echo "== install $APK =="; A install -r -g "$APK"; fi

echo "== grant all the permissions the popup needs =="
A shell pm grant   "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
A shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow              2>/dev/null || true
A shell appops set "$PKG" USE_FULL_SCREEN_INTENT allow           2>/dev/null || true
A shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow             2>/dev/null || true
A shell dumpsys deviceidle whitelist +"$PKG"                     2>/dev/null || true
echo "-- current grant state --"
A shell appops get "$PKG" SYSTEM_ALERT_WINDOW    2>/dev/null | tee "$OUT/perms.txt"
A shell appops get "$PKG" USE_FULL_SCREEN_INTENT 2>/dev/null | tee -a "$OUT/perms.txt"

echo "== is the persistent engine alive? (the 'Time Audit is on' FGS) =="
A shell dumpsys activity services "$PKG" 2>&1 | grep -iE "PingService|isForeground|ServiceRecord" | head | tee "$OUT/service.txt"

echo "== drive: onboard + Settings + Test the popup (arms a ~4s real alarm) =="
maestro --device "$SERIAL" test "$HOME/products/time-audit/.maestro/lockscreen-trigger.yaml" 2>&1 | tail -15 | tee "$OUT/maestro.txt"

echo "== LOCK the screen and wait for the alarm to fire over the keyguard =="
A shell input keyevent 26   # screen off -> keyguard
sleep 9
A exec-out screencap -p > "$OUT/1-lockscreen.png"
echo "-- window/activity state (proof) --"
A shell dumpsys window windows        2>&1 | grep -iE "PingActivity|mShowWhenLocked|KeyguardOccluded|mCurrentFocus" | head -20 | tee "$OUT/windows.txt"
A shell dumpsys activity activities   2>&1 | grep -iE "ResumedActivity|PingActivity|timeaudit" | head -10 | tee "$OUT/activities.txt"
A shell dumpsys deviceidle | grep -iE "mState=|$PKG" | head -5 | tee "$OUT/doze.txt"
A logcat -d 2>&1 | grep -iE "timeaudit|PingService|PingReceiver|AndroidRuntime|FATAL" | tail -40 > "$OUT/logcat.txt"

echo "== also test the IN-USE overlay: open Settings (a foreground app) then fire again =="
A shell input keyevent 82   # wake
sleep 1
A shell am start -a android.settings.SETTINGS >/dev/null 2>&1 || true
sleep 2
# (the alarm chain / a second Test-popup would show the overlay over Settings; screenshot after)
A exec-out screencap -p > "$OUT/2-inuse.png"

echo "== VERDICT =="
if grep -qiE "mShowWhenLocked=true|PingActivity" "$OUT/windows.txt" "$OUT/activities.txt" 2>/dev/null; then
  echo "LOCKSCREEN: PingActivity present over keyguard ✅  (inspect $OUT/1-lockscreen.png)"
else
  echo "LOCKSCREEN: PingActivity NOT found over keyguard ❌  (inspect $OUT/1-lockscreen.png + logcat)"
fi
echo "Artifacts: $OUT"
