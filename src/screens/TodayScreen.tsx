// Home / Today — a live timeline of today's 15-minute slots, newest at the top. Each slot
// shows what you logged or an explicit "unlogged" gap (facing the truth). Consecutive
// identical entries — and consecutive gaps — merge into one block. A quick-entry at the
// top logs the current slot (or a slot you tap to edit).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import QuickEntry from "../ui/QuickEntry";
import PressableScale from "../ui/PressableScale";
import { logEntry, useStore } from "../lib/store";
import {
  SLOT_MS,
  formatClock,
  formatDuration,
  normalizeLabel,
  slotStartFor,
  todaySlots,
} from "../lib/time";

type Block =
  | { kind: "entry"; label: string; start: number; end: number; count: number; hasNow: boolean }
  | { kind: "gap"; start: number; end: number; count: number; hasNow: boolean };

export default function TodayScreen({ focusSlot }: { focusSlot?: number | null }) {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<number | null>(null);

  // Keep the timeline live — refresh the "now" slot every 30s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // A notification tap can ask us to edit a specific slot.
  useEffect(() => {
    if (typeof focusSlot === "number") setEditing(slotStartFor(focusSlot));
  }, [focusSlot]);

  const currentSlot = slotStartFor(now.getTime());
  const slots = useMemo(
    () => todaySlots(settings.wakeMinutes, settings.sleepMinutes, now),
    [settings.wakeMinutes, settings.sleepMinutes, now],
  );

  const loggedCount = useMemo(
    () => slots.filter((s) => entries[String(s)]?.text?.trim()).length,
    [slots, entries],
  );
  const unloggedCount = slots.length - loggedCount;

  // Build merged blocks in chronological order, then reverse (newest first).
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const s of slots) {
      const e = entries[String(s)];
      const label = e?.text?.trim() ? e.text.trim() : null;
      const isNow = s === currentSlot;
      const last = out[out.length - 1];
      if (label) {
        if (
          last &&
          last.kind === "entry" &&
          normalizeLabel(last.label) === normalizeLabel(label) &&
          last.end === s
        ) {
          last.end = s + SLOT_MS;
          last.count++;
          last.hasNow = last.hasNow || isNow;
        } else {
          out.push({ kind: "entry", label, start: s, end: s + SLOT_MS, count: 1, hasNow: isNow });
        }
      } else {
        if (last && last.kind === "gap" && last.end === s) {
          last.end = s + SLOT_MS;
          last.count++;
          last.hasNow = last.hasNow || isNow;
        } else {
          out.push({ kind: "gap", start: s, end: s + SLOT_MS, count: 1, hasNow: isNow });
        }
      }
    }
    return out.reverse();
  }, [slots, entries, currentSlot]);

  const editingSlot = editing ?? currentSlot;
  const editingIsCurrent = editingSlot === currentSlot;

  const submit = (text: string) => {
    logEntry(text, editingSlot);
    setEditing(null);
  };

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

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
        <Text style={[type.label, styles.kicker]}>TODAY</Text>
        <Text style={[type.title, styles.date]}>{dateLabel}</Text>

        <Card tone="flat" style={styles.summary}>
          <Stat value={String(loggedCount)} label="logged" tone="teal" />
          <View style={styles.statDivider} />
          <Stat value={String(unloggedCount)} label="unlogged" tone="gap" />
          <View style={styles.statDivider} />
          <Stat
            value={formatDuration(loggedCount * 15)}
            label="accounted"
            tone="accent"
          />
        </Card>
      </FadeIn>

      <FadeIn delay={90}>
        <View style={styles.entryHeader}>
          <Text style={[type.caption, styles.entryHeaderText]}>
            {editingIsCurrent
              ? "What are you doing right now?"
              : `Editing ${formatClock(editingSlot)}–${formatClock(editingSlot + SLOT_MS)}`}
          </Text>
          {!editingIsCurrent ? (
            <PressableScale onPress={() => setEditing(null)} accessibilityLabel="Cancel edit">
              <Text style={styles.cancel}>× cancel</Text>
            </PressableScale>
          ) : null}
        </View>
        <QuickEntry
          key={editingSlot}
          placeholder={
            editingIsCurrent ? "e.g. deep work, email, lunch…" : "Log this slot…"
          }
          onSubmit={submit}
        />
      </FadeIn>

      <View style={styles.timeline}>
        {blocks.length === 0 ? (
          <Card tone="flat" style={styles.empty}>
            <Text style={styles.emptyIcon}>🕒</Text>
            <Text style={[type.bodyStrong, styles.emptyTitle]}>Your day starts here</Text>
            <Text style={[type.caption, styles.emptyBody]}>
              The first slot opens at your wake time. Log what you're doing above.
            </Text>
          </Card>
        ) : (
          blocks.map((b) => (
            <SlotBlock
              key={`${b.kind}-${b.start}`}
              block={b}
              onEdit={(slot) => setEditing(slotStartFor(slot))}
              selected={editingSlot >= b.start && editingSlot < b.end && !editingIsCurrent}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "teal" | "gap" | "accent";
}) {
  const color =
    tone === "teal" ? colors.teal : tone === "accent" ? colors.accent : colors.gapText;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SlotBlock({
  block,
  onEdit,
  selected,
}: {
  block: Block;
  onEdit: (slot: number) => void;
  selected: boolean;
}) {
  const range = `${formatClock(block.start)}–${formatClock(block.end)}`;
  const spanLabel = block.count > 1 ? `${block.count} × 15m · ${formatDuration(block.count * 15)}` : range;

  return (
    <PressableScale
      onPress={() => onEdit(block.start)}
      accessibilityLabel={`Edit slot ${range}`}
      style={styles.blockRow}
      scaleTo={0.985}
    >
      <View style={styles.railCol}>
        <View
          style={[
            styles.dot,
            block.hasNow && styles.dotNow,
            block.kind === "entry" && !block.hasNow && styles.dotEntry,
          ]}
        />
        <View style={styles.rail} />
      </View>

      <View
        style={[
          styles.block,
          block.kind === "entry" ? styles.blockEntry : styles.blockGap,
          block.hasNow && styles.blockNow,
          selected && styles.blockSelected,
        ]}
      >
        <View style={styles.blockTop}>
          <Text style={[type.mono, styles.timeText, block.kind === "gap" && styles.timeGap]}>
            {range}
          </Text>
          {block.hasNow ? (
            <View style={styles.nowBadge}>
              <Text style={styles.nowBadgeText}>NOW</Text>
            </View>
          ) : block.count > 1 ? (
            <Text style={styles.spanText}>{block.count} slots</Text>
          ) : null}
        </View>

        {block.kind === "entry" ? (
          <Text style={[type.subheading, styles.entryText]} numberOfLines={2}>
            {block.label}
          </Text>
        ) : (
          <Text style={[type.body, styles.gapText]}>
            {block.hasNow ? "Right now — tap to log" : "Unlogged"}
          </Text>
        )}

        {block.count > 1 ? <Text style={styles.spanSub}>{spanLabel}</Text> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s3 },
  kicker: { color: colors.accent, marginBottom: 2 },
  date: { color: colors.fg, marginBottom: space.s2 },
  summary: { flexDirection: "row", alignItems: "center", paddingVertical: space.s2 },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  statLabel: { ...type.caption, color: colors.muted },
  statDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.line },

  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s1,
  },
  entryHeaderText: { color: colors.fg2 },
  cancel: { color: colors.muted, fontSize: 13, fontWeight: "700" },

  timeline: { gap: space.s0 },
  empty: { alignItems: "center", paddingVertical: space.s4, gap: space.s1 },
  emptyIcon: { fontSize: 30, marginBottom: space.s0 },
  emptyTitle: { color: colors.fg },
  emptyBody: { color: colors.muted, textAlign: "center", maxWidth: 260 },

  blockRow: { flexDirection: "row", gap: space.s2 },
  railCol: { width: 14, alignItems: "center" },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 18,
    backgroundColor: colors.gap,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  dotEntry: { backgroundColor: colors.teal },
  dotNow: { backgroundColor: colors.accent, width: 12, height: 12, borderRadius: 6 },
  rail: { flex: 1, width: 2, backgroundColor: colors.line, marginTop: 2 },

  block: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s2,
    paddingVertical: space.s2,
    marginBottom: space.s1,
  },
  blockEntry: { backgroundColor: colors.surface, borderColor: colors.line },
  blockGap: {
    backgroundColor: "transparent",
    borderColor: colors.gap,
    borderStyle: "dashed",
  },
  blockNow: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  blockSelected: { borderColor: colors.accent },
  blockTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  timeText: { color: colors.fg2, fontVariant: ["tabular-nums"] },
  timeGap: { color: colors.gapText },
  entryText: { color: colors.fg },
  gapText: { color: colors.gapText, fontStyle: "italic" },
  spanText: { ...type.caption, color: colors.muted },
  spanSub: { ...type.caption, color: colors.muted, marginTop: 4 },
  nowBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.s1,
    paddingVertical: 2,
  },
  nowBadgeText: { color: colors.onAccent, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
});
