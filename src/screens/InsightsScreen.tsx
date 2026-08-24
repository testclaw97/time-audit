// Insights — the payoff. Group every logged slot by activity and rank it: where the time
// actually went. Toggle Today / This week. Unlogged slots get their own honest bucket; we
// never invent data.
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import PressableScale from "../ui/PressableScale";
import { useStore } from "../lib/store";
import { computeBreakdown, todayKeys, weekKeys } from "../lib/insights";
import { formatDuration } from "../lib/time";

type Range = "today" | "week";

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const [range, setRange] = useState<Range>("today");

  const breakdown = useMemo(() => {
    const keys =
      range === "today"
        ? todayKeys(settings.wakeMinutes, settings.sleepMinutes)
        : weekKeys(settings.wakeMinutes, settings.sleepMinutes);
    return computeBreakdown(entries, keys);
  }, [entries, range, settings.wakeMinutes, settings.sleepMinutes]);

  const maxCount = breakdown.groups.reduce((m, g) => Math.max(m, g.count), 0) || 1;
  const loggedPct =
    breakdown.totalSlots > 0
      ? Math.round((breakdown.loggedSlots / breakdown.totalSlots) * 100)
      : 0;

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
        <Text style={[type.label, styles.kicker]}>INSIGHTS</Text>
        <Text style={[type.title, styles.title]}>Where your time went</Text>

        <View style={styles.segment}>
          <SegBtn label="Today" active={range === "today"} onPress={() => setRange("today")} />
          <SegBtn label="This week" active={range === "week"} onPress={() => setRange("week")} />
        </View>
      </FadeIn>

      <FadeIn delay={90}>
        <Card tone="accent" style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.heroCol}>
              <Text style={styles.heroValue}>{formatDuration(breakdown.loggedMinutes)}</Text>
              <Text style={styles.heroLabel}>accounted for</Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={[styles.heroValue, styles.heroValueDim]}>
                {formatDuration(breakdown.unloggedMinutes)}
              </Text>
              <Text style={styles.heroLabel}>unlogged</Text>
            </View>
          </View>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${loggedPct}%` }]} />
          </View>
          <Text style={styles.heroFoot}>
            {breakdown.loggedSlots} of {breakdown.totalSlots} slots logged · {loggedPct}%
          </Text>
        </Card>
      </FadeIn>

      <FadeIn delay={160}>
        {breakdown.groups.length === 0 ? (
          <Card tone="flat" style={styles.empty}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={[type.bodyStrong, styles.emptyTitle]}>Nothing logged yet</Text>
            <Text style={[type.caption, styles.emptyBody]}>
              Answer a few pings and your breakdown appears here — ranked by where the hours
              really go.
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {breakdown.groups.map((g, i) => (
              <View key={g.label} style={styles.barRow}>
                <View style={styles.barHeader}>
                  <Text style={[type.bodyStrong, styles.barLabel]} numberOfLines={1}>
                    {g.display}
                  </Text>
                  <Text style={styles.barValue}>
                    {g.count} {g.count === 1 ? "slot" : "slots"} · {formatDuration(g.minutes)}
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.max(6, (g.count / maxCount) * 100)}%`,
                        backgroundColor: i === 0 ? colors.accent : colors.teal,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}

            {breakdown.unloggedSlots > 0 ? (
              <View style={styles.barRow}>
                <View style={styles.barHeader}>
                  <Text style={[type.bodyStrong, styles.barLabelDim]}>Unlogged</Text>
                  <Text style={styles.barValueDim}>
                    {breakdown.unloggedSlots} slots · {formatDuration(breakdown.unloggedMinutes)}
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFillGap,
                      { width: `${Math.max(6, (breakdown.unloggedSlots / maxCount) * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}
      </FadeIn>
    </ScrollView>
  );
}

function SegBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segBtn, active && styles.segBtnActive]}
      scaleTo={0.97}
    >
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s3 },
  kicker: { color: colors.accent, marginBottom: 2 },
  title: { color: colors.fg, marginBottom: space.s2 },

  segment: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  segBtn: { flex: 1, paddingVertical: space.s1, alignItems: "center", borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.surface3 },
  segText: { color: colors.muted, fontWeight: "700", fontSize: 14 },
  segTextActive: { color: colors.fg },

  hero: { gap: space.s2 },
  heroRow: { flexDirection: "row" },
  heroCol: { flex: 1 },
  heroValue: { color: colors.fg, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  heroValueDim: { color: colors.gapText },
  heroLabel: { ...type.caption, color: colors.fg2, marginTop: 2 },
  meter: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.gap,
    overflow: "hidden",
  },
  meterFill: { height: "100%", backgroundColor: colors.accent, borderRadius: radius.pill },
  heroFoot: { ...type.caption, color: colors.fg2 },

  list: { gap: space.s2 },
  barRow: { gap: space.s1 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: space.s2 },
  barLabel: { color: colors.fg, flex: 1 },
  barLabelDim: { color: colors.gapText, flex: 1 },
  barValue: { ...type.caption, color: colors.muted, fontVariant: ["tabular-nums"] },
  barValueDim: { ...type.caption, color: colors.gapText, fontVariant: ["tabular-nums"] },
  barTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: radius.pill },
  barFillGap: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.gap,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gapText,
  },

  empty: { alignItems: "center", paddingVertical: space.s4, gap: space.s1 },
  emptyIcon: { fontSize: 30, marginBottom: space.s0 },
  emptyTitle: { color: colors.fg },
  emptyBody: { color: colors.muted, textAlign: "center", maxWidth: 280 },
});
