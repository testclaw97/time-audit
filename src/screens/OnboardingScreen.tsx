// One-time setup. Leads with the viral hook (Hormozi's ~1,000 fifteen-minute blocks a week),
// promises a two-second one-tap answer even from the lock screen, then collects the awake
// window + ping interval and, on the CTA, requests notification permission + schedules pings.
// The onDone wiring (onboarded/tracking via updateSettings, then reschedule) is preserved.
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
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
import { updateSettings } from "../lib/store";
import TimePing, { isAvailable } from "../../modules/time-ping";
import {
  requestPermission,
  reschedulePings,
  setupNotificationChannels,
} from "../lib/notifications";
import { formatDuration } from "../lib/time";

const INTERVALS = [5, 10, 15, 20, 30, 45, 60] as const;

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [wake, setWake] = useState(7 * 60);
  const [sleep, setSleep] = useState(23 * 60);
  const [interval, setInterval] = useState(15);
  const [busy, setBusy] = useState(false);
  // Two-step flow: "intro" collects the window/interval and arms pings; "permission" asks for
  // the overlay grant (the KEY special-access perm that lets the popup cover the screen). Step 2
  // only ever appears on a native Android build where the grant is actually missing.
  const [step, setStep] = useState<"intro" | "permission">("intro");
  const [overlayGranted, setOverlayGranted] = useState(false);

  const windowMinutes = (sleep - wake + 24 * 60) % (24 * 60) || 24 * 60;
  const pingsPerDay = Math.floor(windowMinutes / interval);

  // Re-check the overlay grant on entering step 2 + whenever we return to the foreground (the
  // user grants it in a system Settings screen, so the value flips off-screen).
  const refreshOverlay = useCallback(async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      setOverlayGranted(await TimePing.hasOverlayPermission());
    } catch (e) {
      console.warn("[onboarding] hasOverlayPermission failed", e);
    }
  }, []);

  useEffect(() => {
    if (step !== "permission") return;
    refreshOverlay();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshOverlay();
    });
    return () => sub.remove();
  }, [step, refreshOverlay]);

  const start = async () => {
    setBusy(true);
    try {
      await setupNotificationChannels();
      const granted = await requestPermission();
      const settings = await updateSettings({
        onboarded: true,
        tracking: true,
        wakeMinutes: wake,
        sleepMinutes: sleep,
        intervalMinutes: interval,
      });
      await reschedulePings(settings);
      if (!granted && Platform.OS !== "web") {
        Alert.alert(
          "Notifications are off",
          `Time Audit needs notification permission to pop up every ${interval} minutes. You can still log inside the app, and enable pings later in Settings.`,
        );
      }
      // On a native Android build, if the popup can't cover the screen yet, don't silently
      // finish — advance to the overlay-permission step. Never block: any failure just finishes.
      let needOverlay = false;
      if (isAvailable() && TimePing) {
        try {
          needOverlay = !(await TimePing.hasOverlayPermission());
        } catch (e) {
          console.warn("[onboarding] hasOverlayPermission check failed", e);
        }
      }
      if (needOverlay) {
        setStep("permission");
      } else {
        onDone();
      }
    } catch (e) {
      console.warn("[onboarding] start failed", e);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const requestOverlay = async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      await TimePing.requestOverlayPermission();
    } catch (e) {
      console.warn("[onboarding] requestOverlayPermission failed", e);
    }
    // The grant lands in a system screen; refreshOverlay also fires on AppState 'active'.
    refreshOverlay();
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
          <Text style={styles.kicker}>ONE LAST THING</Text>
          <Text style={[type.display, styles.title]}>
            Let the popup{"\n"}cover your screen.
          </Text>
        </FadeIn>

        <FadeIn delay={110}>
          <Card tone="accent" style={styles.promise}>
            <Text style={[type.body, styles.promiseText]}>
              Android needs one permission so the check-in can pop up over whatever you're
              doing — even from your lock screen.
            </Text>
          </Card>
        </FadeIn>

        <FadeIn delay={180}>
          <Card style={styles.permStatusCard} tone="flat">
            <View style={styles.permStatusRow}>
              <Text style={[type.bodyStrong, styles.permStatusTitle]}>
                Display over other apps
              </Text>
              <Text
                style={[
                  type.caption,
                  styles.permStatusState,
                  { color: overlayGranted ? colors.teal : colors.accent },
                ]}
              >
                {overlayGranted ? "Granted ✓" : "Needed"}
              </Text>
            </View>
            <Text style={[type.caption, styles.permStatusNote]}>
              Required for the full-screen popup to appear while your phone is in use.
            </Text>
          </Card>
        </FadeIn>

        <FadeIn delay={260}>
          {overlayGranted ? (
            <Button
              label="You're all set"
              icon="✓"
              onPress={onDone}
              style={styles.cta}
              testID="onboarding-done"
            />
          ) : (
            <Button
              label="Allow full-screen popup"
              icon="▸"
              onPress={requestOverlay}
              style={styles.cta}
              testID="allow-overlay"
            />
          )}
          {!overlayGranted ? (
            <PressableScale
              onPress={onDone}
              accessibilityLabel="Skip for now"
              style={styles.skipRow}
              testID="onboarding-skip"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </PressableScale>
          ) : null}
          <Text style={styles.privacy}>
            You can fine-tune alarms & lock-screen access anytime in Settings.
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
                accessibilityLabel={`Every ${m} minutes`}
                accessibilityState={{ selected: active }}
                scaleTo={0.94}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}m</Text>
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
          onPress={start}
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
  permStatusTitle: { color: colors.fg },
  permStatusState: { fontWeight: "700" },
  permStatusNote: { color: colors.muted },
  skipRow: { alignSelf: "center", paddingVertical: space.s2, marginTop: space.s0 },
  skipText: { ...type.bodyStrong, color: colors.muted },
});
