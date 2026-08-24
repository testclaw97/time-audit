// One-time setup. Explains the 15-minute rule, lets the user set their awake window, and
// the big "Start tracking" button requests notification permission + schedules the pings.
import React, { useState } from "react";
import {
  Alert,
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
import { updateSettings } from "../lib/store";
import {
  requestPermission,
  reschedulePings,
  setupNotificationChannels,
} from "../lib/notifications";
import { formatDuration } from "../lib/time";

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [wake, setWake] = useState(7 * 60);
  const [sleep, setSleep] = useState(23 * 60);
  const [busy, setBusy] = useState(false);

  const windowMinutes = (sleep - wake + 24 * 60) % (24 * 60) || 24 * 60;
  const pingsPerDay = Math.floor(windowMinutes / 15);

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
      });
      await reschedulePings(settings);
      if (!granted && Platform.OS !== "web") {
        Alert.alert(
          "Notifications are off",
          "Time Audit needs notification permission to ping you every 15 minutes. You can still log inside the app, and enable pings later in Settings.",
        );
      }
      onDone();
    } catch (e) {
      console.warn("[onboarding] start failed", e);
      onDone();
    } finally {
      setBusy(false);
    }
  };

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
          Where does your{"\n"}time actually go?
        </Text>
        <Text style={[type.body, styles.sub]}>
          Every 15 minutes, your phone asks one question: what did you just do? Jot 1–2
          words. In a week, you'll see the truth — no guessing, no journaling.
        </Text>
      </FadeIn>

      <FadeIn delay={120}>
        <Card style={styles.stepsCard} tone="flat">
          <Step n="1" title="We ping you" body="A quiet notification lands every 15 minutes while you're awake." />
          <View style={styles.divider} />
          <Step n="2" title="You answer in 2 words" body="“email”, “lunch”, “scrolling”. Reply right from the notification." />
          <View style={styles.divider} />
          <Step n="3" title="You face the numbers" body="Insights add up every slot into an honest breakdown of your day." />
        </Card>
      </FadeIn>

      <FadeIn delay={220}>
        <Text style={[type.label, styles.sectionLabel]}>YOUR AWAKE WINDOW</Text>
        <Card>
          <TimeField label="Wake up" icon="☀️" minutes={wake} onChange={setWake} />
          <View style={styles.rowDivider} />
          <TimeField label="Wind down" icon="🌙" minutes={sleep} onChange={setSleep} />
        </Card>
        <Text style={styles.hint}>
          {formatDuration(windowMinutes)} awake · about {pingsPerDay} check-ins a day
        </Text>
      </FadeIn>

      <FadeIn delay={320}>
        <Button
          label={busy ? "Setting up…" : "Start tracking"}
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

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
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
  title: { color: colors.fg, marginBottom: space.s2 },
  sub: { color: colors.fg2 },
  stepsCard: { gap: 0 },
  step: { flexDirection: "row", gap: space.s2, alignItems: "flex-start", paddingVertical: space.s1 },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.accent, fontWeight: "800", fontSize: 14 },
  stepText: { flex: 1 },
  stepTitle: { color: colors.fg, marginBottom: 2 },
  stepBody: { color: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s1 },
  sectionLabel: { color: colors.muted, marginBottom: space.s1 },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s0 },
  hint: { ...type.caption, color: colors.muted, marginTop: space.s1, textAlign: "center" },
  cta: { marginTop: space.s1 },
  privacy: { ...type.caption, color: colors.faint, textAlign: "center", marginTop: space.s2 },
});
