// Settings — edit the awake window, pause/resume the pings, and clear all data. Changing
// the window or tracking state reschedules (or cancels) the notification queue. "Clear all
// data" uses a two-tap arm-then-confirm (robust on web, where Alert buttons are limited).
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import TimeField from "../ui/TimeField";
import PressableScale from "../ui/PressableScale";
import Button from "../ui/Button";
import { clearAllData, updateSettings, useStore } from "../lib/store";
import {
  cancelAllPings,
  countScheduled,
  requestPermission,
  reschedulePings,
  setupNotificationChannels,
} from "../lib/notifications";
import { formatDuration } from "../lib/time";

export default function SettingsScreen({ onReset }: { onReset: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings } = useStore();
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);

  const refreshScheduled = async () => setScheduled(await countScheduled());
  useEffect(() => {
    refreshScheduled();
  }, [settings.tracking, settings.wakeMinutes, settings.sleepMinutes]);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const windowMinutes =
    (settings.sleepMinutes - settings.wakeMinutes + 24 * 60) % (24 * 60) || 24 * 60;

  const changeWindow = async (patch: { wakeMinutes?: number; sleepMinutes?: number }) => {
    const next = await updateSettings(patch);
    if (next.tracking) await reschedulePings(next);
    refreshScheduled();
  };

  const toggleTracking = async () => {
    const next = await updateSettings({ tracking: !settings.tracking });
    if (next.tracking) {
      await setupNotificationChannels();
      await requestPermission();
      await reschedulePings(next);
    } else {
      await cancelAllPings();
    }
    refreshScheduled();
  };

  const clearData = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    await cancelAllPings();
    await clearAllData();
    onReset();
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s3, paddingBottom: insets.bottom + space.s6 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <FadeIn>
        <Text style={[type.label, styles.kicker]}>SETTINGS</Text>
        <Text style={[type.title, styles.title]}>Tune your audit</Text>
      </FadeIn>

      <FadeIn delay={80}>
        <Text style={[type.label, styles.sectionLabel]}>TRACKING</Text>
        <Card>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={[type.bodyStrong, styles.rowTitle]}>
                {settings.tracking ? "Pings are on" : "Pings are paused"}
              </Text>
              <Text style={[type.caption, styles.rowSub]}>
                {settings.tracking
                  ? `${scheduled ?? "…"} check-ins queued`
                  : "You won't be pinged until you resume"}
              </Text>
            </View>
            <Toggle value={settings.tracking} onToggle={toggleTracking} />
          </View>
        </Card>
      </FadeIn>

      <FadeIn delay={140}>
        <Text style={[type.label, styles.sectionLabel]}>AWAKE WINDOW</Text>
        <Card>
          <TimeField
            label="Wake up"
            icon="☀️"
            minutes={settings.wakeMinutes}
            onChange={(m) => changeWindow({ wakeMinutes: m })}
          />
          <View style={styles.divider} />
          <TimeField
            label="Wind down"
            icon="🌙"
            minutes={settings.sleepMinutes}
            onChange={(m) => changeWindow({ sleepMinutes: m })}
          />
        </Card>
        <Text style={styles.hint}>
          {formatDuration(windowMinutes)} awake · about {Math.floor(windowMinutes / 15)}{" "}
          check-ins a day
        </Text>
      </FadeIn>

      <FadeIn delay={200}>
        <Text style={[type.label, styles.sectionLabel]}>HOW PINGS WORK</Text>
        <Card tone="flat">
          <Text style={[type.caption, styles.note]}>
            Pings are scheduled with your phone's alarm system, so they fire even when the
            app is closed. Time Audit keeps the next 24 hours queued and tops them up every
            time you open the app. After a phone restart, open the app once to re-arm them.
          </Text>
        </Card>
      </FadeIn>

      <FadeIn delay={260}>
        <Text style={[type.label, styles.sectionLabel]}>DANGER ZONE</Text>
        <Button
          label={armed ? "Tap again to erase everything" : "Clear all data"}
          variant="danger"
          onPress={clearData}
          testID="clear-data"
        />
        <Text style={styles.hint}>
          Deletes every logged slot and resets the app. This can't be undone.
        </Text>
      </FadeIn>

      <Text style={styles.version}>Time Audit · v1.0 · on-device only</Text>
    </ScrollView>
  );
}

function Toggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <PressableScale
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      scaleTo={0.94}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s2 },
  kicker: { color: colors.accent, marginBottom: 2 },
  title: { color: colors.fg, marginBottom: space.s1 },
  sectionLabel: { color: colors.muted, marginTop: space.s2, marginBottom: space.s1 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowText: { flex: 1, paddingRight: space.s2 },
  rowTitle: { color: colors.fg },
  rowSub: { color: colors.muted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s0 },
  hint: { ...type.caption, color: colors.muted, marginTop: space.s1 },
  note: { color: colors.fg2, lineHeight: 20 },
  version: { ...type.caption, color: colors.faint, textAlign: "center", marginTop: space.s4 },

  toggle: {
    width: 52,
    height: 32,
    borderRadius: radius.pill,
    padding: 3,
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleOff: { backgroundColor: colors.surface3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  knobOff: { alignSelf: "flex-start", backgroundColor: colors.muted },
});
