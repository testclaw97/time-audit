// Insights — the deeper truth + the viral engine. Today/Week toggle, the Deep/Shallow/Reactive
// split (Hormozi's frame), a 7-day trend, top categories ranked, an annual projection of the
// waste, and a shareable "Reckoning Card" (the growth loop: friends see your brutal number).
import React, { useMemo, useState } from "react";
import { Modal, Share, StyleSheet, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import Button from "../ui/Button";
import PressableScale from "../ui/PressableScale";
import { useStore } from "../lib/store";
import {
  KIND_META,
  computeKindSplit,
  projectAnnual,
  todayKeys,
  weekDayBars,
  weekKeys,
} from "../lib/insights";
import {
  displayLabel,
  formatDuration,
  getSlotMinutes,
  normalizeLabel,
} from "../lib/time";

type Range = "today" | "week";

interface CatGroup {
  key: string;
  label: string;
  emoji?: string;
  color: string;
  count: number;
  minutes: number;
}

export default function InsightsScreen({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const [range, setRange] = useState<Range>("week");
  const [showCard, setShowCard] = useState(false);
  const now = new Date();

  const keys = useMemo(
    () =>
      range === "today"
        ? todayKeys(settings.wakeMinutes, settings.sleepMinutes, now)
        : weekKeys(settings.wakeMinutes, settings.sleepMinutes, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, settings.wakeMinutes, settings.sleepMinutes, entries],
  );

  const split = useMemo(
    () => computeKindSplit(entries, keys, settings.categories),
    [entries, keys, settings.categories],
  );

  // Top categories (by count) for the ranked bars.
  const groups = useMemo(() => {
    const slotMin = getSlotMinutes();
    const catById = new Map(settings.categories.map((c) => [c.id, c] as const));
    const map = new Map<string, CatGroup>();
    for (const slot of keys) {
      const e = entries[String(slot)];
      if (!e || e.text.trim().length === 0) continue;
      const cat = e.category ? catById.get(e.category) : undefined;
      let g: CatGroup;
      if (cat) {
        const key = `cat:${cat.id}`;
        g = map.get(key) ?? { key, label: cat.label, emoji: cat.emoji, color: cat.color, count: 0, minutes: 0 };
      } else {
        const norm = normalizeLabel(e.text);
        const key = `txt:${norm}`;
        g = map.get(key) ?? { key, label: displayLabel(norm), color: colors.muted, count: 0, minutes: 0 };
      }
      g.count++;
      g.minutes = g.count * slotMin;
      map.set(g.key, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [entries, keys, settings.categories]);

  const bars = useMemo(
    () => weekDayBars(entries, settings.categories, settings.wakeMinutes, settings.sleepMinutes, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, settings.categories, settings.wakeMinutes, settings.sleepMinutes],
  );

  const maxCount = groups.reduce((m, g) => Math.max(m, g.count), 0) || 1;

  // Annual projection of the wasted (reactive) time, from what's elapsed in the range.
  const dow = (now.getDay() + 6) % 7; // 0 = Mon
  const elapsedDays = range === "today" ? 1 : dow + 1;
  const annual = projectAnnual(split.reactiveMin, elapsedDays);

  const rangeLabel = range === "today" ? "today" : "this week";
  const shareText = buildShareText(split, rangeLabel, annual.daysPerYear);

  const onShare = async () => {
    try {
      await Share.share({ message: shareText });
    } catch (e) {
      console.warn("[insights] share failed", e);
    }
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
        <View style={styles.headerRow}>
          <Text style={[type.label, styles.kicker]}>INSIGHTS</Text>
          <PressableScale
            onPress={onOpenSettings}
            disabled={!onOpenSettings}
            accessibilityLabel="Settings"
            accessibilityRole="button"
            style={styles.gearBtn}
            scaleTo={0.9}
          >
            <Text style={styles.gearGlyph}>⚙︎</Text>
          </PressableScale>
        </View>
        <Text style={[type.title, styles.title]}>Where your time went</Text>
        <View style={styles.segment}>
          <SegBtn label="Today" active={range === "today"} onPress={() => setRange("today")} />
          <SegBtn label="This week" active={range === "week"} onPress={() => setRange("week")} />
        </View>
      </FadeIn>

      {/* Kind split hero */}
      <FadeIn delay={80}>
        <Card style={styles.hero}>
          {split.loggedMin > 0 ? (
            <>
              <View style={styles.heroTop}>
                <View>
                  <Text style={styles.heroValue}>{formatDuration(split.loggedMin)}</Text>
                  <Text style={styles.heroCaption}>tracked {rangeLabel}</Text>
                </View>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgePct}>{split.reactivePct + split.shallowPct}%</Text>
                  <Text style={styles.heroBadgeLabel}>low-value</Text>
                </View>
              </View>

              <View style={styles.splitBar}>
                {split.deepMin > 0 ? (
                  <View style={{ width: `${(split.deepMin / (split.totalMin || 1)) * 100}%`, backgroundColor: KIND_META.deep.color }} />
                ) : null}
                {split.shallowMin > 0 ? (
                  <View style={{ width: `${(split.shallowMin / (split.totalMin || 1)) * 100}%`, backgroundColor: KIND_META.shallow.color }} />
                ) : null}
                {split.reactiveMin > 0 ? (
                  <View style={{ width: `${(split.reactiveMin / (split.totalMin || 1)) * 100}%`, backgroundColor: KIND_META.reactive.color }} />
                ) : null}
                {split.unloggedMin > 0 ? (
                  <View style={{ width: `${(split.unloggedMin / (split.totalMin || 1)) * 100}%`, backgroundColor: colors.gap }} />
                ) : null}
              </View>

              <View style={styles.legend}>
                <Legend kind="deep" min={split.deepMin} pct={split.deepPct} />
                <Legend kind="shallow" min={split.shallowMin} pct={split.shallowPct} />
                <Legend kind="reactive" min={split.reactiveMin} pct={split.reactivePct} />
              </View>
            </>
          ) : (
            <View style={styles.emptyHero}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={[type.bodyStrong, styles.emptyTitle]}>Nothing logged {rangeLabel}</Text>
              <Text style={[type.caption, styles.emptyBody]}>
                Answer a few check-ins and your breakdown appears here — ranked by where the hours really go.
              </Text>
            </View>
          )}
        </Card>
      </FadeIn>

      {/* Annual projection — the gut punch */}
      {split.reactiveMin > 0 ? (
        <FadeIn delay={130}>
          <Card tone="flat" style={styles.projection}>
            <Text style={styles.projectionText}>
              At this rate, that's{" "}
              <Text style={styles.projectionNum}>{annual.daysPerYear} full days</Text> a year spent reacting.
            </Text>
          </Card>
        </FadeIn>
      ) : null}

      {/* 7-day trend */}
      {range === "week" && bars.some((b) => b.loggedMin > 0) ? (
        <FadeIn delay={160}>
          <Text style={[type.label, styles.sectionLabel]}>LAST 7 DAYS</Text>
          <Card tone="flat" style={styles.chartCard}>
            <WeekChart bars={bars} />
          </Card>
        </FadeIn>
      ) : null}

      {/* Top categories */}
      {groups.length > 0 ? (
        <FadeIn delay={200}>
          <Text style={[type.label, styles.sectionLabel]}>WHERE IT WENT</Text>
          <View style={styles.list}>
            {groups.map((g) => (
              <View key={g.key} style={styles.barRow}>
                <View style={styles.barHeader}>
                  <Text style={[type.bodyStrong, styles.barLabel]} numberOfLines={1}>
                    {g.emoji ? `${g.emoji}  ` : ""}
                    {g.label}
                  </Text>
                  <Text style={styles.barValue}>{formatDuration(g.minutes)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.max(6, (g.count / maxCount) * 100)}%`, backgroundColor: g.color },
                    ]}
                  />
                </View>
              </View>
            ))}
            {split.unloggedMin > 0 ? (
              <View style={styles.barRow}>
                <View style={styles.barHeader}>
                  <Text style={[type.bodyStrong, styles.barLabelDim]}>Unlogged</Text>
                  <Text style={styles.barValueDim}>{formatDuration(split.unloggedMin)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFillGap, { width: `${Math.max(6, (split.unloggedMin / (split.loggedMin + split.unloggedMin || 1)) * 100)}%` }]} />
                </View>
              </View>
            ) : null}
          </View>
        </FadeIn>
      ) : null}

      {/* Share the reckoning — the viral loop */}
      {split.loggedMin > 0 ? (
        <FadeIn delay={240}>
          <Button label="Share your reckoning" icon="↗" onPress={() => setShowCard(true)} style={styles.shareBtn} />
        </FadeIn>
      ) : null}

      {/* Reckoning card modal */}
      <Modal visible={showCard} transparent animationType="fade" onRequestClose={() => setShowCard(false)}>
        <View style={styles.cardScrim}>
          <ReckoningCard split={split} rangeLabel={rangeLabel} daysPerYear={annual.daysPerYear} />
          <View style={styles.cardActions}>
            <View style={styles.cardActionCol}>
              <Button label="Share" icon="↗" onPress={onShare} />
            </View>
            <View style={styles.cardActionCol}>
              <Button label="Close" variant="ghost" onPress={() => setShowCard(false)} />
            </View>
          </View>
          <Text style={styles.cardHint}>Tip: screenshot the card to post the picture.</Text>
        </View>
      </Modal>
    </ScrollView>
  );
}

/** The shareable card — a bold, self-contained "here's my week" the user posts. */
function ReckoningCard({
  split,
  rangeLabel,
  daysPerYear,
}: {
  split: ReturnType<typeof computeKindSplit>;
  rangeLabel: string;
  daysPerYear: number;
}) {
  const lowValue = split.reactivePct + split.shallowPct;
  return (
    <View style={styles.card}>
      <Text style={styles.cardKicker}>MY TIME AUDIT · {rangeLabel.toUpperCase()}</Text>
      <Text style={styles.cardBig}>{lowValue}%</Text>
      <Text style={styles.cardBigSub}>of my tracked time was low-value.</Text>

      <View style={styles.cardSplitBar}>
        {split.deepMin > 0 ? <View style={{ flex: split.deepMin, backgroundColor: KIND_META.deep.color }} /> : null}
        {split.shallowMin > 0 ? <View style={{ flex: split.shallowMin, backgroundColor: KIND_META.shallow.color }} /> : null}
        {split.reactiveMin > 0 ? <View style={{ flex: split.reactiveMin, backgroundColor: KIND_META.reactive.color }} /> : null}
      </View>
      <View style={styles.cardLegend}>
        <Legend kind="deep" min={split.deepMin} pct={split.deepPct} />
        <Legend kind="shallow" min={split.shallowMin} pct={split.shallowPct} />
        <Legend kind="reactive" min={split.reactiveMin} pct={split.reactivePct} />
      </View>

      {split.reactiveMin > 0 ? (
        <Text style={styles.cardLine}>
          At this rate: <Text style={styles.cardLineStrong}>{daysPerYear} days a year</Text> gone to reacting.
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.cardFooterTitle}>Time Audit</Text>
        <Text style={styles.cardFooterSub}>1,000 fifteen-minute blocks a week. Where do yours go?</Text>
      </View>
    </View>
  );
}

function WeekChart({ bars }: { bars: ReturnType<typeof weekDayBars> }) {
  const maxMin = bars.reduce((m, b) => Math.max(m, b.loggedMin), 0) || 1;
  return (
    <View style={styles.chart}>
      {bars.map((b, i) => {
        const h = (b.loggedMin / maxMin) * 100;
        return (
          <View key={i} style={styles.chartCol}>
            <View style={styles.chartBarTrack}>
              <View style={[styles.chartBar, { height: `${Math.max(3, h)}%` }]}>
                {b.reactiveMin > 0 ? <View style={{ flex: b.reactiveMin, backgroundColor: KIND_META.reactive.color }} /> : null}
                {b.shallowMin > 0 ? <View style={{ flex: b.shallowMin, backgroundColor: KIND_META.shallow.color }} /> : null}
                {b.deepMin > 0 ? <View style={{ flex: b.deepMin, backgroundColor: KIND_META.deep.color }} /> : null}
              </View>
            </View>
            <Text style={[styles.chartLabel, b.isToday && styles.chartLabelToday]}>{b.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Legend({ kind, min, pct }: { kind: keyof typeof KIND_META; min: number; pct: number }) {
  const meta = KIND_META[kind];
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
      <Text style={styles.legendText}>
        {meta.label} <Text style={styles.legendPct}>{pct}%</Text>
      </Text>
    </View>
  );
}

function SegBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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

function buildShareText(
  split: ReturnType<typeof computeKindSplit>,
  rangeLabel: string,
  daysPerYear: number,
): string {
  const lowValue = split.reactivePct + split.shallowPct;
  const lines = [
    `My time audit ${rangeLabel}: ${lowValue}% of my tracked time was low-value.`,
    `Deep ${split.deepPct}% · Shallow ${split.shallowPct}% · Reactive ${split.reactivePct}%.`,
  ];
  if (split.reactiveMin > 0) lines.push(`At this rate that's ${daysPerYear} days a year just reacting.`);
  lines.push(`You get ~1,000 fifteen-minute blocks a week. Where do yours go? — Time Audit`);
  return lines.join("\n");
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s3 },
  kicker: { color: colors.accent, marginBottom: 2 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  gearBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  gearGlyph: { fontSize: 18, color: colors.fg2 },
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

  hero: { paddingVertical: space.s3, gap: space.s2 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroValue: { fontSize: 40, lineHeight: 44, fontWeight: "800", color: colors.fg, letterSpacing: -0.8 },
  heroCaption: { ...type.caption, color: colors.muted, marginTop: 2 },
  heroBadge: { alignItems: "flex-end" },
  heroBadgePct: { fontSize: 24, fontWeight: "800", color: colors.danger, letterSpacing: -0.5 },
  heroBadgeLabel: { ...type.caption, color: colors.muted },
  splitBar: { flexDirection: "row", height: 14, borderRadius: radius.pill, backgroundColor: colors.gap, overflow: "hidden" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.s2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...type.caption, color: colors.fg2, fontWeight: "600" },
  legendPct: { color: colors.fg, fontWeight: "800" },

  projection: { paddingVertical: space.s2 },
  projectionText: { ...type.body, color: colors.fg2 },
  projectionNum: { color: colors.danger, fontWeight: "800" },

  sectionLabel: { color: colors.muted },
  chartCard: { paddingVertical: space.s3 },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 130, gap: space.s1 },
  chartCol: { flex: 1, alignItems: "center", gap: space.s1 },
  chartBarTrack: { width: "100%", height: 100, justifyContent: "flex-end", alignItems: "center" },
  chartBar: { width: "70%", minHeight: 3, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.gap },
  chartLabel: { ...type.caption, color: colors.muted, fontWeight: "700" },
  chartLabelToday: { color: colors.accent },

  list: { gap: space.s2 },
  barRow: { gap: space.s1 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: space.s2 },
  barLabel: { color: colors.fg, flex: 1 },
  barLabelDim: { color: colors.gapText, flex: 1 },
  barValue: { ...type.caption, color: colors.muted, fontVariant: ["tabular-nums"] },
  barValueDim: { ...type.caption, color: colors.gapText, fontVariant: ["tabular-nums"] },
  barTrack: { height: 12, borderRadius: radius.pill, backgroundColor: colors.surface2, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: radius.pill },
  barFillGap: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.gap, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gapText },

  shareBtn: { marginTop: space.s1 },

  emptyHero: { alignItems: "center", paddingVertical: space.s3, gap: space.s1 },
  emptyIcon: { fontSize: 30 },
  emptyTitle: { color: colors.fg },
  emptyBody: { color: colors.muted, textAlign: "center", maxWidth: 280 },

  // reckoning card
  cardScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: space.s3, gap: space.s2 },
  card: {
    backgroundColor: colors.bgSoft,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    padding: space.s4,
    gap: space.s2,
  },
  cardKicker: { ...type.label, color: colors.accent },
  cardBig: { fontSize: 72, lineHeight: 76, fontWeight: "800", color: colors.fg, letterSpacing: -2 },
  cardBigSub: { ...type.heading, color: colors.fg2, marginTop: -space.s2 },
  cardSplitBar: { flexDirection: "row", height: 16, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.gap, marginTop: space.s1 },
  cardLegend: { flexDirection: "row", flexWrap: "wrap", gap: space.s2 },
  cardLine: { ...type.body, color: colors.fg2, marginTop: space.s1 },
  cardLineStrong: { color: colors.danger, fontWeight: "800" },
  cardFooter: { marginTop: space.s2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.s2 },
  cardFooterTitle: { ...type.subheading, color: colors.accent },
  cardFooterSub: { ...type.caption, color: colors.muted, marginTop: 2 },
  cardActions: { flexDirection: "row", gap: space.s2 },
  cardActionCol: { flex: 1 },
  cardHint: { ...type.caption, color: colors.faint, textAlign: "center" },
});
