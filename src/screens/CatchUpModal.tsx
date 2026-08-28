// Catch-up — the "you've been away" filler, rebuilt full-screen and dead-simple (TJ, 2026-08-28).
// Two clear steps: (1) pick what you were doing — ALL categories visible, no horizontal scrolling;
// (2) tap the time rows you did it in — each row shows its exact clock range AND the category you
// gave it, so you always see where a tap lands. "Fill the rest" one-taps everything still empty.
// Everything commits live. In `mandatory` mode it can't be left until every block is logged.
import React, { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import PressableScale from "../ui/PressableScale";
import type { Category } from "../lib/store";
import { logEntry, logManyEntries, useStore } from "../lib/store";
import { formatClock, getSlotMs } from "../lib/time";

const ERASE = "__erase__";

export default function CatchUpModal({
  visible,
  slots,
  onClose,
  mandatory = false,
}: {
  visible: boolean;
  /** Ascending epoch slot-starts to show as fillable rows (elapsed blocks up to now). */
  slots: number[];
  onClose: () => void;
  /** On-open wall: can't be dismissed until every shown block is logged. */
  mandatory?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const cats = settings.categories;

  // The picked category (the "pen"). Default: first category. ERASE clears a row.
  const [pick, setPick] = useState<string>(() => cats[0]?.id ?? ERASE);
  const slotMs = getSlotMs();
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c] as const)), [cats]);
  const active = pick === ERASE ? null : catById.get(pick);

  const loggedCount = useMemo(
    () => slots.filter((s) => entries[String(s)]?.text?.trim()).length,
    [slots, entries],
  );
  const remaining = slots.length - loggedCount;
  const canLeave = !mandatory || remaining === 0;

  const assign = (slot: number) => {
    if (pick === ERASE) {
      void logEntry("", slot);
      return;
    }
    const cat = catById.get(pick);
    if (!cat) return;
    void logEntry(cat.label, slot, cat.id);
  };

  const fillRest = () => {
    if (pick === ERASE) return;
    const cat = catById.get(pick);
    if (!cat) return;
    const empty = slots.filter((s) => !entries[String(s)]?.text?.trim());
    if (empty.length) void logManyEntries(empty, cat.label, cat.id);
  };

  const close = () => {
    if (canLeave) onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, styles.title]}>
              {mandatory ? "You've been away" : "Catch up"}
            </Text>
            <Text style={styles.sub}>
              {remaining > 0
                ? `${loggedCount} of ${slots.length} logged · ${remaining} to go`
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

        {/* Step 1 — pick a category (ALL visible, wraps, no horizontal scroll) */}
        <Text style={styles.stepLabel}>1 · What were you doing?</Text>
        <View style={styles.pickWrap}>
          {cats.map((c) => {
            const on = pick === c.id;
            return (
              <PressableScale
                key={c.id}
                onPress={() => setPick(c.id)}
                accessibilityLabel={c.label}
                accessibilityState={{ selected: on }}
                style={[styles.pickChip, on && { backgroundColor: c.color + "2a", borderColor: c.color }]}
                scaleTo={0.94}
              >
                <Text style={styles.pickEmoji}>{c.emoji}</Text>
                <Text style={[styles.pickLabel, on && { color: colors.fg }]} numberOfLines={1}>
                  {c.label}
                </Text>
              </PressableScale>
            );
          })}
          <PressableScale
            onPress={() => setPick(ERASE)}
            accessibilityLabel="Erase"
            accessibilityState={{ selected: pick === ERASE }}
            style={[styles.pickChip, pick === ERASE && { backgroundColor: colors.surface3, borderColor: colors.lineStrong }]}
            scaleTo={0.94}
          >
            <Text style={styles.pickEmoji}>⌫</Text>
            <Text style={[styles.pickLabel, pick === ERASE && { color: colors.fg }]}>Erase</Text>
          </PressableScale>
        </View>

        {/* Step 2 — tap the time rows */}
        <Text style={styles.stepLabel}>
          2 · Tap the times you were {active ? active.label.toLowerCase() : "doing that"}
        </Text>
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: space.s2 }}
          showsVerticalScrollIndicator={false}
        >
          {slots.map((slot) => {
            const e = entries[String(slot)];
            const label = e?.text?.trim() ? e.text.trim() : null;
            const cat = e?.category ? catById.get(e.category) : undefined;
            return (
              <TimeRow
                key={slot}
                range={`${formatClock(slot)} – ${formatClock(slot + slotMs)}`}
                label={label}
                emoji={cat?.emoji}
                color={cat?.color}
                onPress={() => assign(slot)}
              />
            );
          })}
        </ScrollView>

        {/* Sticky bottom — fill the rest fast */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.s2 }]}>
          {remaining > 0 && active ? (
            <PressableScale
              onPress={fillRest}
              accessibilityLabel={`Fill the remaining ${remaining} with ${active.label}`}
              style={styles.fillBtn}
              scaleTo={0.98}
            >
              <Text style={styles.fillText}>
                {active.emoji}  Fill the other {remaining} with {active.label}
              </Text>
            </PressableScale>
          ) : canLeave ? (
            <PressableScale onPress={close} accessibilityLabel="Done" style={styles.fillBtnDone} scaleTo={0.98}>
              <Text style={styles.fillDoneText}>Done</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// One time block: its clock range on the left, and — big and obvious — the category you gave it
// (or "tap to set"). Tapping assigns the currently-picked category, so you always see where it lands.
function TimeRow({
  range,
  label,
  emoji,
  color,
  onPress,
}: {
  range: string;
  label: string | null;
  emoji?: string;
  color?: string;
  onPress: () => void;
}) {
  const logged = label != null;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={logged ? `${range}, logged as ${label}. Tap to change.` : `${range}, tap to set`}
      style={[styles.row, logged && { borderColor: (color ?? colors.teal) + "88", backgroundColor: (color ?? colors.teal) + "18" }]}
      scaleTo={0.98}
    >
      <Text style={styles.rowTime}>{range}</Text>
      {logged ? (
        <View style={styles.rowValue}>
          {emoji ? <Text style={styles.rowEmoji}>{emoji}</Text> : null}
          <Text style={[styles.rowLabel, { color: color ?? colors.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : (
        <Text style={styles.rowEmpty}>tap to set</Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.s3 },

  header: { flexDirection: "row", alignItems: "center", gap: space.s2, paddingTop: space.s2, paddingBottom: space.s1 },
  title: { color: colors.fg },
  sub: { ...type.caption, color: colors.muted, marginTop: 2 },
  doneBtn: { paddingHorizontal: space.s2, paddingVertical: space.s1, borderRadius: radius.pill, backgroundColor: colors.accent },
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

  stepLabel: { ...type.label, color: colors.accent, marginTop: space.s2, marginBottom: space.s1 },

  // step 1 — category picker (wraps; every category visible)
  pickWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  pickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  pickEmoji: { fontSize: 16 },
  pickLabel: { color: colors.fg2, fontWeight: "700", fontSize: 14 },

  // step 2 — time rows
  list: { flex: 1, marginTop: space.s0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    marginBottom: space.s1,
  },
  rowTime: { ...type.bodyStrong, color: colors.fg, fontVariant: ["tabular-nums"] },
  rowValue: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  rowEmoji: { fontSize: 17 },
  rowLabel: { fontWeight: "800", fontSize: 15, flexShrink: 1 },
  rowEmpty: { ...type.caption, color: colors.gapText, fontWeight: "700" },

  footer: { paddingTop: space.s1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  fillBtn: {
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingVertical: space.s2,
    alignItems: "center",
    justifyContent: "center",
  },
  fillText: { color: colors.onAccent, fontWeight: "800", fontSize: 15 },
  fillBtnDone: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingVertical: space.s2,
    alignItems: "center",
    justifyContent: "center",
  },
  fillDoneText: { color: colors.fg, fontWeight: "800", fontSize: 15 },
});
