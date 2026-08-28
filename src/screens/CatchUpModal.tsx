// Fast catch-up — the fix for "tapping each missed block takes too long". Instead of opening a
// modal and picking a category once per 15-min slot, you pick a category ONCE (a persistent
// "brush") and then tap the blocks to fill them; every tap logs instantly, no round-trip. For a
// run of the same activity ("meeting 2:00–4:00"), flip on Range and tap the first + last block to
// fill the whole span in two taps. Erase clears a mistake. Everything commits live to the store,
// so there is no "unsaved" state to lose.
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import PressableScale from "../ui/PressableScale";
import type { Category } from "../lib/store";
import { logEntry, logManyEntries, useStore } from "../lib/store";
import { formatClock, getSlotMs } from "../lib/time";

const ERASE = "__erase__";
type Brush = string; // a Category.id, or ERASE

export default function CatchUpModal({
  visible,
  slots,
  onClose,
  mandatory = false,
}: {
  visible: boolean;
  /** Ascending epoch slot-starts to show as fillable cells (elapsed blocks up to now). */
  slots: number[];
  onClose: () => void;
  /** On-open wall: can't be dismissed until every shown block is logged (no backdrop, no back). */
  mandatory?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings, entries } = useStore();
  const cats = settings.categories;

  // Fixed cell width (3 columns). MUST be an absolute number, not a "%" — PressableScale forwards
  // width to its outer wrapper AND applies the style to the inner view, so a percentage would be
  // taken twice (31% of 31%) and crush the label. An identical absolute px on both layers lines up.
  const GRID_PAD = space.s3 * 2 + space.s1 * 2; // sheet h-padding + 2 inter-column gaps
  const cellW = Math.floor((width - GRID_PAD) / 3);

  // The active brush — a category id (default: first category) or ERASE. Persists across taps,
  // so filling N blocks with the same thing is N taps, not N×(open modal + pick + close).
  const [brush, setBrush] = useState<Brush>(() => cats[0]?.id ?? ERASE);
  const [rangeMode, setRangeMode] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null); // first tapped block in a range

  const slotMs = getSlotMs();
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c] as const)), [cats]);
  const activeCat = brush === ERASE ? null : catById.get(brush);

  const loggedCount = useMemo(
    () => slots.filter((s) => entries[String(s)]?.text?.trim()).length,
    [slots, entries],
  );
  const remaining = slots.length - loggedCount;

  // Paint one block with the active brush (or clear it if the brush is Erase). Live-committed.
  const paintOne = (slot: number) => {
    if (brush === ERASE) {
      void logEntry("", slot);
      return;
    }
    const cat = catById.get(brush);
    if (!cat) return;
    void logEntry(cat.label, slot, cat.id);
  };

  // Fill an inclusive range [a..b] (by time value) with the active brush in a single write.
  const fillRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const inRange = slots.filter((s) => s >= lo && s <= hi);
    if (inRange.length === 0) return;
    if (brush === ERASE) {
      void logManyEntries(inRange, "");
      return;
    }
    const cat = catById.get(brush);
    if (!cat) return;
    void logManyEntries(inRange, cat.label, cat.id);
  };

  const onCellPress = (slot: number) => {
    if (rangeMode) {
      if (anchor == null) {
        setAnchor(slot);
      } else {
        fillRange(anchor, slot);
        setAnchor(null);
      }
    } else {
      paintOne(slot);
    }
  };

  // Fill every block that is still unlogged with the active brush (the "and the rest was all X"
  // shortcut). Never overwrites what you already logged.
  const fillRemaining = () => {
    const empty = slots.filter((s) => !entries[String(s)]?.text?.trim());
    if (empty.length === 0) return;
    if (brush === ERASE) return; // erasing "remaining" is a no-op — nothing to clear
    const cat = catById.get(brush);
    if (!cat) return;
    void logManyEntries(empty, cat.label, cat.id);
  };

  // In mandatory (on-open wall) mode you can't leave until every shown block is logged.
  const canLeave = !mandatory || remaining === 0;
  const close = () => {
    if (!canLeave) return;
    setAnchor(null);
    onClose();
  };

  // Anchor bounds (for highlighting the pending range as you look for the second tap).
  const anchorVal = anchor;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable
          style={styles.backdrop}
          onPress={canLeave ? close : undefined}
          accessibilityLabel={canLeave ? "Close catch-up" : "Fill your blocks to continue"}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s2 }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[type.heading, styles.title]}>
                {mandatory ? "You've been away" : "Catch up"}
              </Text>
              <Text style={styles.sub}>
                {remaining > 0
                  ? mandatory
                    ? `Log these ${remaining} block${remaining === 1 ? "" : "s"} to continue`
                    : `${remaining} block${remaining === 1 ? "" : "s"} still unlogged`
                  : "All caught up 🎉"}
              </Text>
            </View>
            {canLeave ? (
              <PressableScale onPress={close} accessibilityLabel="Done" style={styles.doneBtn} scaleTo={0.94}>
                <Text style={styles.doneText}>Done</Text>
              </PressableScale>
            ) : (
              <View style={styles.lockedPill}>
                <Text style={styles.lockedPillText}>🔒 {remaining} left</Text>
              </View>
            )}
          </View>

          {/* How-to line adapts to the current mode */}
          <Text style={styles.howto}>
            {rangeMode
              ? anchorVal == null
                ? `Tap the START block, then the END — fills the span with ${
                    activeCat ? activeCat.label : "erase"
                  }.`
                : "Now tap the END block."
              : `Pick a category, then tap blocks to fill them with ${
                  activeCat ? activeCat.label : "erase"
                }.`}
          </Text>

          {/* The grid of blocks */}
          <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid}>
            {slots.map((slot) => {
              const e = entries[String(slot)];
              const label = e?.text?.trim() ? e.text.trim() : null;
              const cat = e?.category ? catById.get(e.category) : undefined;
              const isAnchor = anchorVal === slot;
              const inPendingRange = false; // (kept simple: only the anchor is highlighted)
              return (
                <Cell
                  key={slot}
                  w={cellW}
                  time={formatClock(slot)}
                  endTime={formatClock(slot + slotMs)}
                  label={label}
                  emoji={cat?.emoji}
                  color={cat?.color}
                  isAnchor={isAnchor}
                  inPendingRange={inPendingRange}
                  onPress={() => onCellPress(slot)}
                />
              );
            })}
          </ScrollView>

          {/* Fill-remaining shortcut */}
          {remaining > 0 && brush !== ERASE && activeCat ? (
            <PressableScale
              onPress={fillRemaining}
              accessibilityLabel={`Fill all ${remaining} remaining blocks with ${activeCat.label}`}
              style={styles.fillAll}
              scaleTo={0.98}
            >
              <Text style={styles.fillAllText}>
                {activeCat.emoji} Fill remaining {remaining} with {activeCat.label}
              </Text>
            </PressableScale>
          ) : null}

          {/* Brush bar: categories + erase + range toggle */}
          <View style={styles.brushBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.brushScroll}
            >
              {cats.map((c) => (
                <BrushChip
                  key={c.id}
                  emoji={c.emoji}
                  label={c.label}
                  color={c.color}
                  active={brush === c.id}
                  onPress={() => setBrush(c.id)}
                />
              ))}
              <BrushChip
                emoji="⌫"
                label="Erase"
                color={colors.gapText}
                active={brush === ERASE}
                onPress={() => setBrush(ERASE)}
              />
            </ScrollView>
            <PressableScale
              onPress={() => {
                setRangeMode((v) => !v);
                setAnchor(null);
              }}
              accessibilityLabel={rangeMode ? "Range fill on" : "Range fill off"}
              accessibilityState={{ selected: rangeMode }}
              style={[styles.rangeBtn, rangeMode && styles.rangeBtnOn]}
              scaleTo={0.94}
            >
              <Text style={[styles.rangeText, rangeMode && styles.rangeTextOn]}>⇕ Range</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Cell({
  w,
  time,
  endTime,
  label,
  emoji,
  color,
  isAnchor,
  inPendingRange,
  onPress,
}: {
  w: number;
  time: string;
  endTime: string;
  label: string | null;
  emoji?: string;
  color?: string;
  isAnchor: boolean;
  inPendingRange: boolean;
  onPress: () => void;
}) {
  const logged = label != null;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={logged ? `${time}, logged as ${label}. Tap to change.` : `${time}, tap to log`}
      style={[
        styles.cell,
        { width: w },
        logged && { backgroundColor: (color ?? colors.teal) + "22", borderColor: (color ?? colors.teal) + "88" },
        isAnchor && styles.cellAnchor,
        inPendingRange && styles.cellInRange,
      ]}
      scaleTo={0.93}
    >
      <Text style={styles.cellTime} numberOfLines={1}>
        {time}
      </Text>
      {logged ? (
        <View style={styles.cellLogged}>
          {emoji ? <Text style={styles.cellEmoji}>{emoji}</Text> : null}
          <Text style={styles.cellLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : (
        <Text style={styles.cellEmpty}>·</Text>
      )}
    </PressableScale>
  );
}

function BrushChip({
  emoji,
  label,
  color,
  active,
  onPress,
}: {
  emoji: string;
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={`Brush: ${label}`}
      accessibilityState={{ selected: active }}
      style={[
        styles.brushChip,
        active && { backgroundColor: color + "26", borderColor: color },
      ]}
      scaleTo={0.92}
    >
      <Text style={styles.brushEmoji}>{emoji}</Text>
      <Text style={[styles.brushLabel, active && { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: space.s2,
  },

  header: { flexDirection: "row", alignItems: "center", gap: space.s2 },
  title: { color: colors.fg },
  sub: { ...type.caption, color: colors.muted, marginTop: 2 },
  doneBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  doneText: { color: colors.onAccent, fontWeight: "800", fontSize: 14 },
  lockedPill: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  lockedPillText: { color: colors.muted, fontWeight: "800", fontSize: 13 },

  howto: { ...type.caption, color: colors.fg2, marginTop: space.s1, marginBottom: space.s1, minHeight: 34 },

  gridScroll: { flexGrow: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.s1, paddingBottom: space.s1 },
  cell: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.s1,
    paddingVertical: space.s1,
    justifyContent: "space-between",
  },
  cellAnchor: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  cellInRange: { backgroundColor: colors.accentSoft },
  cellTime: { ...type.caption, color: colors.fg2, fontVariant: ["tabular-nums"], fontWeight: "700" },
  cellLogged: { flexDirection: "row", alignItems: "center", gap: 4 },
  cellEmoji: { fontSize: 14 },
  cellLabel: { color: colors.fg, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  cellEmpty: { color: colors.gapText, fontSize: 16, fontWeight: "800" },

  fillAll: {
    marginTop: space.s1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    backgroundColor: colors.accentSoft,
    paddingVertical: space.s1 + 2,
    alignItems: "center",
  },
  fillAllText: { ...type.caption, color: colors.accent2, fontWeight: "800" },

  brushBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    marginTop: space.s2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: space.s2,
  },
  brushScroll: { gap: space.s1, alignItems: "center", paddingRight: space.s1 },
  brushChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space.s1 + 2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  brushEmoji: { fontSize: 15 },
  brushLabel: { color: colors.fg2, fontWeight: "700", fontSize: 13, maxWidth: 110 },
  rangeBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  rangeBtnOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  rangeText: { color: colors.fg2, fontWeight: "800", fontSize: 13 },
  rangeTextOn: { color: colors.accent2 },
});
