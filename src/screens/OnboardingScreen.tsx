// One-time setup. Leads with the viral hook (Hormozi's ~1,000 fifteen-minute blocks a week),
// promises a two-second one-tap answer even from the lock screen, then collects the awake
// window + ping interval and, on the CTA, requests notification permission + schedules pings.
// The onDone wiring (onboarded/tracking via updateSettings, then reschedule) is preserved.
import React, { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import Button from "../ui/Button";
import FadeIn from "../ui/FadeIn";
import TimeField from "../ui/TimeField";
import PressableScale from "../ui/PressableScale";
import { updateSettings, useStore } from "../lib/store";
import TimePing, { isAvailable } from "../../modules/time-ping";
import {
  getNotifPermission,
  requestPermission,
  reschedulePings,
  setupNotificationChannels,
} from "../lib/notifications";
import { formatDuration } from "../lib/time";

// 0.5/1/2 = fast test cadences (30s / 1min / 2min); the rest are the normal minute options.
const INTERVALS = [0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60] as const;
/** Chip / a11y label for an interval in minutes: "30s" for sub-minute, else "15m". */
const intervalLabel = (m: number) => (m < 1 ? `${Math.round(m * 60)}s` : `${m}m`);
// OEM skins (Xiaomi/MIUI, Samsung, …) hide extra pop-up / autostart / battery switches that
// standard Android permissions DON'T cover — the popup is silently blocked until they're on.
const OEM_BRANDS = /xiaomi|redmi|poco|samsung|oppo|realme|oneplus|vivo|huawei|honor/;

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [wake, setWake] = useState(7 * 60);
  const [sleep, setSleep] = useState(23 * 60);
  const [interval, setInterval] = useState(15);
  const [busy, setBusy] = useState(false);
  // Two-step flow: "intro" collects the window/interval; "permission" is a MANDATORY gate. The
  // finish CTA stays locked until the three ESSENTIAL grants (notifications + overlay + exact
  // alarms) are green, and — on an OEM skin (Xiaomi/Samsung/…) — until the user confirms the extra
  // switches. The lock-screen popup itself is an OPTIONAL toggle on this screen.
  const native = isAvailable();
  const [step, setStep] = useState<"intro" | "permission">("intro");
  const [notifGranted, setNotifGranted] = useState(false);
  // Whether the OS will still show a notification-permission dialog. When false (permanently
  // denied), the "Allow" action must deep-link to Settings instead of silently no-opping.
  const [notifCanAskAgain, setNotifCanAskAgain] = useState(true);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [exactGranted, setExactGranted] = useState(false);
  const [fsiGranted, setFsiGranted] = useState(false);
  const [manufacturer, setManufacturer] = useState("");
  // On a native build the OEM gate depends on Build.MANUFACTURER, fetched async. Until it resolves
  // `isOem` is falsely false — so hold the finish button until we actually know, or a fast tap could
  // slip past the OEM step. On web/iOS there's no native module, so nothing to wait for.
  const [manufacturerResolved, setManufacturerResolved] = useState(!native);

  const windowMinutes = (sleep - wake + 24 * 60) % (24 * 60) || 24 * 60;
  const pingsPerDay = Math.floor(windowMinutes / interval);

  // The hard-required grants that make the popup ACTUALLY WORK: notifications (the floor), display-
  // over-other-apps (the full-screen popup while the phone's in use — the whole point of the app),
  // and exact alarms (on-time firing). On an OEM skin the OEM switches are ALSO required (below).
  // No one starts until the app can do its job (TJ, 2026-08-26). Lock-screen (FSI) stays OPTIONAL —
  // TJ's explicit call. On web/iOS overlay/exact don't exist, so refreshPerms marks them satisfied.
  const essentialsGranted = notifGranted && overlayGranted && exactGranted;
  const isOem = OEM_BRANDS.test(manufacturer);
  const brand = manufacturer
    ? manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1)
    : "phone";
  // On an OEM device the user must also confirm they flipped the MIUI/Samsung switches — the app
  // physically can't read those ops, so confirmation is the only signal we get.
  const canFinish =
    essentialsGranted && manufacturerResolved && (!isOem || settings.oemSetupConfirmed);

  // Re-check every gate on entering step 2 + whenever we return to the foreground (the user grants
  // them in system Settings screens, so the values flip while we're backgrounded).
  const refreshPerms = useCallback(async () => {
    try {
      const { granted, canAskAgain } = await getNotifPermission();
      setNotifGranted(granted);
      setNotifCanAskAgain(canAskAgain);
    } catch (e) {
      console.warn("[onboarding] notif status failed", e);
    }
    if (isAvailable() && TimePing) {
      try {
        const [overlay, exact, fsi] = await Promise.all([
          TimePing.hasOverlayPermission(),
          TimePing.hasExactAlarm(),
          TimePing.hasFullScreenIntent(),
        ]);
        setOverlayGranted(overlay);
        setExactGranted(exact);
        setFsiGranted(fsi);
      } catch (e) {
        console.warn("[onboarding] refreshPerms failed", e);
      }
    } else {
      // web / iOS: no overlay / exact-alarm / FSI special access — don't block the gate on them.
      setOverlayGranted(true);
      setExactGranted(true);
      setFsiGranted(true);
    }
  }, []);

  useEffect(() => {
    if (step !== "permission") return;
    refreshPerms();
    void (async () => {
      if (isAvailable() && TimePing) {
        try {
          setManufacturer((await TimePing.getManufacturer()) || "");
        } catch (e) {
          console.warn("[onboarding] getManufacturer failed", e);
        } finally {
          // Resolved (or failed) — either way we now know the brand, so the finish gate can open.
          setManufacturerResolved(true);
        }
      }
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPerms();
    });
    return () => sub.remove();
  }, [step, refreshPerms]);

  // Intro CTA → set up channels, fire the notification prompt up front, then advance to the gate.
  // We do NOT persist onboarded here — that happens only in finish(), once every gate is green.
  const goToPermissions = async () => {
    setBusy(true);
    try {
      await setupNotificationChannels();
      await requestPermission();
    } catch (e) {
      console.warn("[onboarding] channel/permission setup failed", e);
    } finally {
      setBusy(false);
      setStep("permission");
    }
  };

  const allowNotifications = async () => {
    try {
      if (notifCanAskAgain) {
        // The OS will still show the system dialog — ask.
        await requestPermission();
      } else {
        // Permanently denied (Android 13+ "don't ask again"): requesting silently no-ops, so the
        // ONLY recovery is the app's system settings. Without this the user is locked out of
        // onboarding forever. AppState 'active' → refreshPerms picks up the grant on return.
        await Linking.openSettings();
      }
    } catch (e) {
      console.warn("[onboarding] allowNotifications failed", e);
    }
    refreshPerms();
  };

  // Run a guarded native request, then re-check (the grant lands in a system screen; refreshPerms
  // also fires on AppState 'active').
  const runNative = async (fn: () => Promise<void>, label: string) => {
    if (!isAvailable() || !TimePing) return;
    try {
      await fn();
    } catch (e) {
      console.warn(`[onboarding] ${label} failed`, e);
    }
    refreshPerms();
  };

  const allowOverlay = () =>
    runNative(() => TimePing!.requestOverlayPermission(), "requestOverlayPermission");
  const allowExact = () => runNative(() => TimePing!.requestExactAlarm(), "requestExactAlarm");
  const allowFsi = () =>
    runNative(() => TimePing!.requestFullScreenIntent(), "requestFullScreenIntent");
  const allowBattery = () =>
    runNative(() => TimePing!.requestBatteryExemption(), "requestBatteryExemption");
  const openOemPerms = () =>
    runNative(() => TimePing!.openOemAppPermissions(), "openOemAppPermissions");
  const openAutostart = () => runNative(() => TimePing!.openOemAutostart(), "openOemAutostart");

  const setLockScreen = (v: boolean) => {
    void updateSettings({ lockScreenPopup: v });
  };
  const toggleOemConfirmed = () => {
    void updateSettings({ oemSetupConfirmed: !settings.oemSetupConfirmed });
  };

  // Finish: NOW persist onboarded/tracking + the window/interval and (re)arm pings. Setting
  // onboarded flips App back to the tabs; onDone() lands the user on Today.
  const finish = async () => {
    if (!canFinish) return;
    setBusy(true);
    try {
      const next = await updateSettings({
        onboarded: true,
        tracking: true,
        wakeMinutes: wake,
        sleepMinutes: sleep,
        intervalMinutes: interval,
        // Stamp when tracking began so the home's catch-up doesn't count blocks from before the
        // app existed (a fresh install mid-day would otherwise say "you've been away 11h").
        trackingStartedAt: Date.now(),
      });
      await reschedulePings(next);
    } catch (e) {
      console.warn("[onboarding] finish failed", e);
    } finally {
      setBusy(false);
      onDone();
    }
  };

  if (step === "permission") {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.s4, paddingBottom: insets.bottom + space.s4 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn>
          <Text style={styles.kicker}>ALMOST THERE</Text>
          <Text style={[type.display, styles.title]}>
            Make the popup{"\n"}actually fire.
          </Text>
        </FadeIn>

        <FadeIn delay={110}>
          <Card tone="accent" style={styles.promise}>
            <Text style={[type.body, styles.promiseText]}>
              Grant these and the popup works properly — a full-screen check-in that actually lands.
              Without them, Time Audit can't do its job, so they're required to start.
            </Text>
          </Card>
        </FadeIn>

        <FadeIn delay={170}>
          <Text style={[type.label, styles.sectionLabel]}>REQUIRED</Text>
          <Card style={styles.permStatusCard} tone="flat">
            <PermRow
              title="Notifications"
              note={
                notifGranted || notifCanAskAgain
                  ? "Lets the check-in reach you every interval."
                  : "Blocked in Android. Tap Open settings → allow notifications, then come back."
              }
              granted={notifGranted}
              onAllow={allowNotifications}
              actionLabel={notifCanAskAgain ? "Allow" : "Open settings"}
              testID="allow-notifications"
            />
            <View style={styles.permDivider} />
            <PermRow
              title="Display over other apps"
              note="Lets the check-in cover your screen as a full-screen popup — the whole point of the app."
              granted={overlayGranted}
              onAllow={allowOverlay}
              testID="allow-overlay"
            />
            <View style={styles.permDivider} />
            <PermRow
              title="Exact alarms"
              note="Fires the check-in right on time, not whenever Android feels like it."
              granted={exactGranted}
              onAllow={allowExact}
              testID="allow-exact"
            />
          </Card>
        </FadeIn>

        <FadeIn delay={230}>
          <Text style={[type.label, styles.sectionLabel]}>LOCK SCREEN</Text>
          <Card tone="flat" style={styles.lockCard}>
            <View style={styles.lockRow}>
              <View style={styles.lockText}>
                <Text style={[type.bodyStrong, styles.lockTitle]}>Show over the lock screen</Text>
                <Text style={[type.caption, styles.lockNote]}>
                  Off = it only pops up while you're using the phone.
                </Text>
              </View>
              <Switch
                value={settings.lockScreenPopup}
                onValueChange={setLockScreen}
                trackColor={{ true: colors.accent, false: colors.surface3 }}
                thumbColor="#fff"
                accessibilityLabel="Show over the lock screen"
                testID="toggle-lockscreen"
              />
            </View>
            {settings.lockScreenPopup ? (
              <>
                <View style={styles.permDivider} />
                <PermRow
                  title="Show on the lock screen"
                  note="Lets the popup appear even when your phone is locked."
                  granted={fsiGranted}
                  onAllow={allowFsi}
                  testID="allow-fsi"
                />
              </>
            ) : null}
          </Card>
        </FadeIn>

        {isOem ? (
          <FadeIn delay={290}>
            <Card tone="accent" style={styles.oemCard}>
              <Text style={styles.oemBadge}>REQUIRED ON {brand.toUpperCase()}</Text>
              <Text style={[type.heading, styles.oemTitle]}>
                Your {brand} phone needs{"\n"}3 extra switches.
              </Text>
              <Text style={[type.body, styles.oemBody]}>
                Android's normal permissions aren't enough on {brand} — without these, the popup is
                silently blocked. Flip all three, then confirm below.
              </Text>

              <OemAction
                n="1"
                title="Pop-up & lock-screen permissions"
                hint={'Turn ON "Display pop-up windows while running in the background" + "Show on lock screen".'}
                onPress={openOemPerms}
                testID="oem-app-permissions"
              />
              <OemAction
                n="2"
                title="Autostart"
                hint="Enable Time Audit so it can wake itself to ping you."
                onPress={openAutostart}
                testID="oem-autostart"
              />
              <OemAction
                n="3"
                title="Battery: No restrictions"
                hint="Stop the system from killing the ping engine in the background."
                onPress={allowBattery}
                testID="oem-battery"
              />

              <PressableScale
                onPress={toggleOemConfirmed}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: settings.oemSetupConfirmed }}
                accessibilityLabel="I've turned these on"
                style={styles.checkRow}
                testID="oem-confirm"
              >
                <View style={[styles.checkBox, settings.oemSetupConfirmed && styles.checkBoxOn]}>
                  {settings.oemSetupConfirmed ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={[type.bodyStrong, styles.checkLabel]}>I've turned these on</Text>
              </PressableScale>
            </Card>
          </FadeIn>
        ) : null}

        <FadeIn delay={350}>
          <Button
            label={busy ? "Finishing…" : canFinish ? "Start my audit" : "Grant the required permissions"}
            icon={canFinish ? "▸" : undefined}
            onPress={finish}
            disabled={!canFinish || busy}
            style={styles.cta}
            testID="onboarding-done"
          />
          <Text style={styles.privacy}>
            {canFinish
              ? "You can fine-tune all of this anytime in Settings."
              : "Grant the required permissions to continue."}
          </Text>
        </FadeIn>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s4, paddingBottom: insets.bottom + space.s4 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <FadeIn>
        <Text style={styles.kicker}>THE 15-MINUTE AUDIT</Text>
        <Text style={[type.display, styles.title]}>
          You get about{"\n"}1,000 fifteen-minute{"\n"}blocks a week.
        </Text>
        <Text style={[type.heading, styles.sub]}>Where do they actually go?</Text>
      </FadeIn>

      <FadeIn delay={110}>
        <Card tone="accent" style={styles.promise}>
          <Text style={[type.body, styles.promiseText]}>
            Every <Text style={styles.promiseStrong}>{interval} minutes</Text> the app pops up —
            just tap what you're doing. Two seconds, even from your lock screen.
          </Text>
        </Card>
      </FadeIn>

      <FadeIn delay={180}>
        <Card style={styles.stepsCard} tone="flat">
          <Step n="1" emoji="⏰" title="It pops up" body={`A full-screen chooser lands every ${interval} minutes while you're awake.`} />
          <View style={styles.divider} />
          <Step n="2" emoji="👆" title="One tap to log" body="Tap a category — Work, Scrolling, Rest… Or type your own. Done in seconds." />
          <View style={styles.divider} />
          <Step n="3" emoji="📊" title="See the truth" body="Insights add up every block into an honest picture of where your week went." />
        </Card>
      </FadeIn>

      <FadeIn delay={260}>
        <Text style={[type.label, styles.sectionLabel]}>YOUR AWAKE WINDOW</Text>
        <Card>
          <TimeField label="Wake up" icon="☀️" minutes={wake} onChange={setWake} />
          <View style={styles.rowDivider} />
          <TimeField label="Wind down" icon="🌙" minutes={sleep} onChange={setSleep} />
        </Card>
      </FadeIn>

      <FadeIn delay={320}>
        <Text style={[type.label, styles.sectionLabel]}>HOW OFTEN?</Text>
        <View style={styles.chips}>
          {INTERVALS.map((m) => {
            const active = interval === m;
            return (
              <PressableScale
                key={m}
                onPress={() => setInterval(m)}
                accessibilityRole="button"
                accessibilityLabel={m < 1 ? `Every ${Math.round(m * 60)} seconds` : `Every ${m} minutes`}
                accessibilityState={{ selected: active }}
                scaleTo={0.94}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{intervalLabel(m)}</Text>
                {m === 15 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>HORMOZI</Text>
                  </View>
                ) : null}
              </PressableScale>
            );
          })}
        </View>
        <Text style={styles.hint}>
          {formatDuration(windowMinutes)} awake · about {pingsPerDay} check-ins a day
        </Text>
      </FadeIn>

      <FadeIn delay={380}>
        <Button
          label={busy ? "Setting up…" : "Start my audit"}
          icon="▸"
          onPress={goToPermissions}
          disabled={busy}
          style={styles.cta}
          testID="start-tracking"
        />
        <Text style={styles.privacy}>
          100% private. Everything stays on this phone — no account, no cloud.
        </Text>
      </FadeIn>
    </ScrollView>
  );
}

function Step({
  n,
  emoji,
  title,
  body,
}: {
  n: string;
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepEmoji}>{emoji}</Text>
      </View>
      <View style={styles.stepText}>
        <Text style={[type.bodyStrong, styles.stepTitle]}>{title}</Text>
        <Text style={[type.caption, styles.stepBody]}>{body}</Text>
      </View>
    </View>
  );
}

function PermRow({
  title,
  note,
  granted,
  onAllow,
  actionLabel = "Allow",
  testID,
}: {
  title: string;
  note: string;
  granted: boolean;
  onAllow: () => void;
  actionLabel?: string;
  testID?: string;
}) {
  return (
    <View>
      <View style={styles.permStatusRow}>
        <Text style={[type.bodyStrong, styles.permStatusTitle]}>{title}</Text>
        {granted ? (
          <Text style={[type.caption, styles.permStatusState, { color: colors.teal }]}>
            Granted ✓
          </Text>
        ) : (
          <PressableScale
            onPress={onAllow}
            accessibilityLabel={`${actionLabel} ${title}`}
            style={styles.permAllowBtn}
            testID={testID}
          >
            <Text style={styles.permAllowText}>{actionLabel}</Text>
          </PressableScale>
        )}
      </View>
      <Text style={[type.caption, styles.permStatusNote]}>{note}</Text>
    </View>
  );
}

function OemAction({
  n,
  title,
  hint,
  onPress,
  testID,
}: {
  n: string;
  title: string;
  hint: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={title}
      style={styles.oemAction}
      scaleTo={0.98}
      testID={testID}
    >
      <View style={styles.oemActionNum}>
        <Text style={styles.oemActionNumText}>{n}</Text>
      </View>
      <View style={styles.oemActionText}>
        <Text style={[type.bodyStrong, styles.oemActionTitle]}>{title}</Text>
        <Text style={[type.caption, styles.oemActionHint]}>{hint}</Text>
      </View>
      <Text style={styles.oemActionArrow}>›</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s3 },
  kicker: {
    ...type.label,
    color: colors.accent,
    marginBottom: space.s1,
  },
  title: { color: colors.fg, marginBottom: space.s1 },
  sub: { color: colors.accent2 },

  promise: {},
  promiseText: { color: colors.fg },
  promiseStrong: { color: colors.accent, fontWeight: "800" },

  stepsCard: { gap: 0 },
  step: { flexDirection: "row", gap: space.s2, alignItems: "flex-start", paddingVertical: space.s1 },
  stepNum: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
  stepEmoji: { fontSize: 17 },
  stepText: { flex: 1 },
  stepTitle: { color: colors.fg, marginBottom: 2 },
  stepBody: { color: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s1 },

  sectionLabel: { color: colors.muted, marginBottom: space.s1 },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s0 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s0 + 2,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  chipText: { color: colors.fg2, fontWeight: "700", fontSize: 15 },
  chipTextActive: { color: colors.accent },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { color: colors.onAccent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  hint: { ...type.caption, color: colors.muted, marginTop: space.s1, textAlign: "center" },
  cta: { marginTop: space.s1 },
  privacy: { ...type.caption, color: colors.faint, textAlign: "center", marginTop: space.s2 },

  // permission step (step 2)
  permStatusCard: { gap: space.s1 },
  permStatusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  permStatusTitle: { color: colors.fg, flex: 1, paddingRight: space.s2 },
  permStatusState: { fontWeight: "700" },
  permStatusNote: { color: colors.muted, marginTop: 2 },
  permDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s1 },
  permAllowBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s0 + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
  },
  permAllowText: { color: colors.accent, fontWeight: "800", fontSize: 13 },
  skipRow: { alignSelf: "center", paddingVertical: space.s2, marginTop: space.s0 },
  skipText: { ...type.bodyStrong, color: colors.muted },

  // lock-screen optional toggle
  lockCard: { gap: space.s1 },
  lockRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.s2 },
  lockText: { flex: 1 },
  lockTitle: { color: colors.fg },
  lockNote: { color: colors.muted, marginTop: 2 },

  // OEM (Xiaomi/Samsung/…) mandatory setup card
  oemCard: { gap: space.s1 },
  oemBadge: {
    ...type.label,
    color: colors.accent,
    marginBottom: space.s0,
  },
  oemTitle: { color: colors.fg, marginBottom: space.s0 },
  oemBody: { color: colors.fg2, marginBottom: space.s1 },
  oemAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
  },
  oemActionNum: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  oemActionNumText: { color: colors.onAccent, fontSize: 13, fontWeight: "800" },
  oemActionText: { flex: 1 },
  oemActionTitle: { color: colors.fg },
  oemActionHint: { color: colors.muted, marginTop: 2 },
  oemActionArrow: { color: colors.accent, fontSize: 22, fontWeight: "800" },

  // "I've turned these on" confirm
  checkRow: { flexDirection: "row", alignItems: "center", gap: space.s2, paddingVertical: space.s1, marginTop: space.s0 },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.accentLine,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.onAccent, fontSize: 15, fontWeight: "800" },
  checkLabel: { color: colors.fg },
});
