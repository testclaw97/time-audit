// Home / Today — a simple home: two summary boxes (working time + categories), a "pause
// popups" snooze control, then the 15-minute timetable (newest at the top). Each slot shows
// what you logged or an explicit "unlogged" gap (facing the truth). Consecutive identical
// entries — and consecutive gaps — merge into one block. A quick-entry logs the current slot
// (or a slot you tap to edit). Tap any timetable row to pick a category manually.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import QuickEntry from "../ui/QuickEntry";
import PressableScale from "../ui/PressableScale";
import TimeField from "../ui/TimeField";
import Button from "../ui/Button";
import type { Category } from "../lib/store";
import { logEntry, pausePopups, resumePopups, updateSettings, useStore } from "../lib/store";
import TimePing, { isAvailable } from "../../modules/time-ping";
import {
  formatClock,
  formatClockMinutes,
  formatDuration,
  getSlotMinutes,
  getSlotMs,
  normalizeLabel,
  slotStartFor,
  todaySlots,
} from "../lib/time";

type Block =
  | {
      kind: "entry";
      label: string;
      start: number;
      end: number;
      count: number;
      hasNow: boolean;
      category?: string;
      emoji?: string;
      color?: string;
    }
  | { kind: "gap"; start: number; end: number; count: number; hasNow: boolean };

// Snooze presets. "Until tomorrow" is computed at tap time from the wake boundary.
const SNOOZE_PRESETS = [
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
] as const;

/** Milliseconds from now until the next local wake boundary (today if still ahead, else
 *  tomorrow) — the "silence popups until tomorrow morning" option. */
function msUntilNextWake(wakeMinutes: number): number {
  const now = new Date();
  const wake = new Date(now);
  wake.setHours(Math.floor(wakeMinutes / 60), wakeMinutes % 60, 0, 0);
  if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
  return wake.getTime() - now.getTime();
}

export default function TodayScreen({
  focusSlot,
  onManageCategories,
}: {
  focusSlot?: number | null;
  /** Switch to the Settings tab so the user can add/edit categories. App.tsx wires this;
   *  no-op (the box just isn't tappable) when undefined. */
  onManageCategories?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<number | null>(null);
  const [editHours, setEditHours] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  // A 1s heartbeat while paused so the remaining time stays fresh and the control flips back
  // to "Pause popups" the moment the snooze expires. `nowMs` is only read by the snooze block.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // On a native Android build, whether the overlay grant is still missing (so the full-screen
  // popup can't cover the screen). Drives the nudge banner. Always false on web/iOS.
  const [overlayNeeded, setOverlayNeeded] = useState(false);

  const paused = settings.pausedUntil > nowMs;

  // Keep the timeline live — refresh the "now" slot every 30s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // While a snooze is active, tick every second so the "paused until …" line and the
  // paused/not-paused flip stay accurate. No timer runs when popups aren't paused.
  useEffect(() => {
    if (settings.pausedUntil <= Date.now()) {
      setNowMs(Date.now());
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settings.pausedUntil]);

  // Track the overlay grant on mount + on every return to the foreground (it's granted in a
  // system screen, so it flips off-screen). Guarded — no-op on web/iOS where the banner stays hidden.
  const refreshOverlay = useCallback(async () => {
    if (!isAvailable() || !TimePing) {
      setOverlayNeeded(false);
      return;
    }
    try {
      setOverlayNeeded(!(await TimePing.hasOverlayPermission()));
    } catch (e) {
      console.warn("[today] hasOverlayPermission failed", e);
    }
  }, []);

  useEffect(() => {
    refreshOverlay();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshOverlay();
    });
    return () => sub.remove();
  }, [refreshOverlay]);

  const requestOverlay = async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      await TimePing.requestOverlayPermission();
    } catch (e) {
      console.warn("[today] requestOverlayPermission failed", e);
    }
    refreshOverlay();
  };

  // A notification tap can ask us to edit a specific slot.
  useEffect(() => {
    if (typeof focusSlot === "number") setEditing(slotStartFor(focusSlot));
  }, [focusSlot]);

  // Per-slot geometry follows the user's chosen interval (5/10/15/…/60 min), not a fixed 15.
  const slotMs = getSlotMs();
  const slotMin = getSlotMinutes();

  const currentSlot = slotStartFor(now.getTime());
  const slots = useMemo(
    () => todaySlots(settings.wakeMinutes, settings.sleepMinutes, now),
    [settings.wakeMinutes, settings.sleepMinutes, now],
  );

  // Resolve a Category.id -> its full record (color/emoji/label) for dots + chip tinting.
  const catById = useMemo(
    () => new Map(settings.categories.map((c) => [c.id, c] as const)),
    [settings.categories],
  );

  const loggedCount = useMemo(
    () => slots.filter((s) => entries[String(s)]?.text?.trim()).length,
    [slots, entries],
  );

  // Build merged blocks in chronological order, then reverse (newest first). Consecutive
  // entries merge only when BOTH the label and the category id match.
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const s of slots) {
      const e = entries[String(s)];
      const label = e?.text?.trim() ? e.text.trim() : null;
      const catId = e?.category;
      const cat = catId ? catById.get(catId) : undefined;
      const isNow = s === currentSlot;
      const last = out[out.length - 1];
      if (label) {
        if (
          last &&
          last.kind === "entry" &&
          normalizeLabel(last.label) === normalizeLabel(label) &&
          last.category === catId &&
          last.end === s
        ) {
          last.end = s + slotMs;
          last.count++;
          last.hasNow = last.hasNow || isNow;
        } else {
          out.push({
            kind: "entry",
            label,
            start: s,
            end: s + slotMs,
            count: 1,
            hasNow: isNow,
            category: catId,
            emoji: cat?.emoji,
            color: cat?.color,
          });
        }
      } else {
        if (last && last.kind === "gap" && last.end === s) {
          last.end = s + slotMs;
          last.count++;
          last.hasNow = last.hasNow || isNow;
        } else {
          out.push({ kind: "gap", start: s, end: s + slotMs, count: 1, hasNow: isNow });
        }
      }
    }
    return out.reverse();
  }, [slots, entries, currentSlot, catById, slotMs]);

  const editingSlot = editing ?? currentSlot;
  const editingIsCurrent = editingSlot === currentSlot;

  const rawEditing = entries[String(editingSlot)];
  const currentEntry =
    rawEditing?.text?.trim()
      ? {
          label: rawEditing.text.trim(),
          category: rawEditing.category ? catById.get(rawEditing.category) : undefined,
        }
      : null;

  const submit = (text: string) => {
    logEntry(text, editingSlot);
    setEditing(null);
  };

  const pickCategory = (cat: Category) => {
    logEntry(cat.label, editingSlot, cat.id);
    setEditing(null);
  };

  const clearSlot = () => {
    logEntry("", editingSlot);
  };

  // ---- snooze actions ----
  const snooze = (ms: number) => {
    void pausePopups(ms);
    setShowSnooze(false);
  };
  const snoozeUntilTomorrow = () => snooze(msUntilNextWake(settings.wakeMinutes));
  const resume = () => {
    void resumePopups();
    setShowSnooze(false);
  };

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
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
      {overlayNeeded ? (
        <FadeIn>
          <PressableScale
            onPress={requestOverlay}
            accessibilityLabel="The full-screen popup can't show yet. Tap to enable."
            style={styles.overlayBanner}
            scaleTo={0.99}
          >
            <Text style={styles.overlayBannerText}>
              ⚠️ The full-screen popup can't show yet — tap to enable.
            </Text>
          </PressableScale>
        </FadeIn>
      ) : null}

      {/* Slim header */}
      <FadeIn>
        <View style={styles.header}>
          <Text style={[type.label, styles.kicker]}>TODAY</Text>
          <Text style={[type.caption, styles.headerDate]}>{dateLabel}</Text>
        </View>
      </FadeIn>

      {/* Two summary boxes: working time + categories */}
      <FadeIn delay={60}>
        <View style={styles.boxRow}>
          <PressableScale
            onPress={() => setEditHours(true)}
            accessibilityLabel="Edit your working hours"
            style={styles.boxWrap}
            scaleTo={0.98}
          >
            <Card tone="flat" style={styles.box}>
              <Text style={[type.label, styles.boxKicker]}>WORKING TIME</Text>
              <Text style={[type.heading, styles.boxValue]} numberOfLines={1}>
                {formatClockMinutes(settings.wakeMinutes)}–
                {formatClockMinutes(settings.sleepMinutes)}
              </Text>
              <Text style={[type.caption, styles.boxSub]} numberOfLines={1}>
                {loggedCount}/{slots.length} slots ·{" "}
                {formatDuration(loggedCount * slotMin)}
              </Text>
              <Text style={styles.boxEdit}>Tap to edit</Text>
            </Card>
          </PressableScale>

          <PressableScale
            onPress={onManageCategories}
            disabled={!onManageCategories}
            accessibilityLabel="Manage categories"
            style={styles.boxWrap}
            scaleTo={0.98}
          >
            <Card tone="flat" style={styles.box}>
              <Text style={[type.label, styles.boxKicker]}>CATEGORIES</Text>
              <Text style={[type.heading, styles.boxValue]}>
                {settings.categories.length}
              </Text>
              <View style={styles.catDots}>
                {settings.categories.slice(0, 6).map((c) => (
                  <View
                    key={c.id}
                    style={[styles.catDot, { backgroundColor: c.color }]}
                  />
                ))}
                {settings.categories.length > 6 ? (
                  <Text style={styles.catMore}>
                    +{settings.categories.length - 6}
                  </Text>
                ) : null}
              </View>
              {onManageCategories ? (
                <Text style={styles.boxEdit}>Tap to manage</Text>
              ) : null}
            </Card>
          </PressableScale>
        </View>
      </FadeIn>

      {/* Pause popups (snooze) */}
      <FadeIn delay={110}>
        {paused ? (
          <Card tone="accent" style={styles.snoozePaused}>
            <View style={styles.snoozePausedText}>
              <Text style={[type.bodyStrong, styles.snoozePausedTitle]} numberOfLines={1}>
                🔕 Popups paused until {formatClock(settings.pausedUntil)}
              </Text>
              <Text style={[type.caption, styles.snoozePausedSub]}>
                No check-ins will pop up until then.
              </Text>
            </View>
            <PressableScale
              onPress={resume}
              accessibilityLabel="Resume popups now"
              style={styles.resumeBtn}
            >
              <Text style={styles.resumeText}>Resume</Text>
            </PressableScale>
          </Card>
        ) : (
          <View>
            <PressableScale
              onPress={() => setShowSnooze((v) => !v)}
              accessibilityLabel="Pause popups"
              style={styles.snoozeRow}
              scaleTo={0.99}
            >
              <Text style={[type.bodyStrong, styles.snoozeRowText]}>🔕 Pause popups</Text>
              <Text style={styles.snoozeChevron}>{showSnooze ? "▴" : "▾"}</Text>
            </PressableScale>
            {showSnooze ? (
              <View style={styles.snoozeOptions}>
                {SNOOZE_PRESETS.map((p) => (
                  <PressableScale
                    key={p.label}
                    onPress={() => snooze(p.ms)}
                    accessibilityLabel={`Pause popups for ${p.label}`}
                    style={styles.snoozeChip}
                    scaleTo={0.94}
                  >
                    <Text style={styles.snoozeChipText}>{p.label}</Text>
                  </PressableScale>
                ))}
                <PressableScale
                  onPress={snoozeUntilTomorrow}
                  accessibilityLabel="Pause popups until tomorrow"
                  style={styles.snoozeChip}
                  scaleTo={0.94}
                >
                  <Text style={styles.snoozeChipText}>Until tomorrow</Text>
                </PressableScale>
              </View>
            ) : null}
          </View>
        )}
      </FadeIn>

      {/* Current-slot quick entry (or the slot you're editing) */}
      <FadeIn delay={150}>
        <View style={styles.entryHeader}>
          <Text style={[type.caption, styles.entryHeaderText]}>
            {editingIsCurrent
              ? "What are you doing right now?"
              : `Editing ${formatClock(editingSlot)}–${formatClock(editingSlot + slotMs)}`}
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
          categories={settings.categories}
          onPickCategory={pickCategory}
          current={currentEntry}
          onClear={clearSlot}
          onSubmit={submit}
        />
      </FadeIn>

      {/* The 15-minute timetable */}
      <View style={styles.timeline}>
        <Text style={[type.label, styles.timelineLabel]}>TIMETABLE · tap a slot to log</Text>
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
              slotMin={slotMin}
              onEdit={(slot) => setEditing(slotStartFor(slot))}
              selected={editingSlot >= b.start && editingSlot < b.end && !editingIsCurrent}
            />
          ))
        )}
      </View>

      {/* Working-hours editor */}
      <Modal
        visible={editHours}
        transparent
        animationType="fade"
        onRequestClose={() => setEditHours(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={[type.heading, styles.modalTitle]}>Working hours</Text>
            <Text style={[type.caption, styles.modalSub]}>
              The window Time Audit tracks and pings you within.
            </Text>
            <Card style={styles.modalFieldCard}>
              <TimeField
                label="Wake up"
                icon="☀️"
                minutes={settings.wakeMinutes}
                onChange={(m) => updateSettings({ wakeMinutes: m })}
              />
              <View style={styles.modalDivider} />
              <TimeField
                label="Wind down"
                icon="🌙"
                minutes={settings.sleepMinutes}
                onChange={(m) => updateSettings({ sleepMinutes: m })}
              />
            </Card>
            <View style={styles.modalActions}>
              <Button label="Done" onPress={() => setEditHours(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SlotBlock({
  block,
  slotMin,
  onEdit,
  selected,
}: {
  block: Block;
  slotMin: number;
  onEdit: (slot: number) => void;
  selected: boolean;
}) {
  const range = `${formatClock(block.start)}–${formatClock(block.end)}`;
  const spanLabel =
    block.count > 1
      ? `${block.count} × ${slotMin}m · ${formatDuration(block.count * slotMin)}`
      : range;

  // Unlogged time is optional — fill it later, or never. So a past/idle gap is rendered as a
  // single quiet muted line, NOT a card that competes with real entries. The current ("now")
  // slot is the one exception: it stays a prompt so you can log where you are right now.
  if (block.kind === "gap" && !block.hasNow) {
    const gapLabel =
      block.count > 1 ? `${block.count} slots not logged yet` : `${range} · not logged`;
    return (
      <PressableScale
        onPress={() => onEdit(block.start)}
        accessibilityLabel={`Log unlogged time ${range}`}
        style={styles.gapQuietRow}
        scaleTo={0.99}
      >
        <View style={styles.gapQuietRail}>
          <View style={styles.gapQuietDot} />
        </View>
        <Text style={[type.caption, styles.gapQuietText]} numberOfLines={1}>
          · {gapLabel}
        </Text>
      </PressableScale>
    );
  }

  // A per-category color on the rail dot when the entry carries one; teal for a custom
  // (uncategorized) entry; the dim gap tone for an unlogged block.
  const catColor = block.kind === "entry" ? block.color : undefined;

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
            block.kind === "entry" && !block.hasNow && styles.dotEntry,
            block.hasNow && styles.dotNow,
            catColor && !block.hasNow ? { backgroundColor: catColor } : null,
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
          <View style={styles.entryLine}>
            {block.emoji ? <Text style={styles.entryEmoji}>{block.emoji}</Text> : null}
            <Text style={[type.subheading, styles.entryText]} numberOfLines={2}>
              {block.label}
            </Text>
          </View>
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

  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  kicker: { color: colors.accent },
  headerDate: { color: colors.muted, fontWeight: "700" },

  overlayBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    borderRadius: radius.md,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
  },
  overlayBannerText: { ...type.caption, color: colors.accent2, fontWeight: "700", flex: 1 },

  // two summary boxes
  boxRow: { flexDirection: "row", gap: space.s2 },
  boxWrap: { flex: 1 },
  box: { paddingVertical: space.s2, gap: 4, minHeight: 118, justifyContent: "flex-start" },
  boxKicker: { color: colors.muted },
  boxValue: { color: colors.fg, marginTop: 2 },
  boxSub: { color: colors.fg2 },
  boxEdit: { ...type.caption, color: colors.accent, fontWeight: "700", marginTop: "auto" },
  catDots: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 2 },
  catDot: { width: 11, height: 11, borderRadius: 6 },
  catMore: { ...type.caption, color: colors.muted, fontWeight: "700", marginLeft: 2 },

  // snooze
  snoozeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 4,
  },
  snoozeRowText: { color: colors.fg2 },
  snoozeChevron: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  snoozeOptions: { flexDirection: "row", flexWrap: "wrap", gap: space.s1, marginTop: space.s1 },
  snoozeChip: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  snoozeChipText: { color: colors.fg2, fontWeight: "700", fontSize: 14 },
  snoozePaused: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.s2,
    gap: space.s2,
  },
  snoozePausedText: { flex: 1 },
  snoozePausedTitle: { color: colors.accent2 },
  snoozePausedSub: { color: colors.muted, marginTop: 2 },
  resumeBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  resumeText: { color: colors.onAccent, fontWeight: "800", fontSize: 14 },

  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.s1,
  },
  entryHeaderText: { color: colors.fg2 },
  cancel: { color: colors.muted, fontSize: 13, fontWeight: "700" },

  timeline: { gap: space.s0 },
  timelineLabel: { color: colors.muted, marginBottom: space.s1 },
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
  entryLine: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  entryEmoji: { fontSize: 17 },
  entryText: { color: colors.fg, flex: 1 },
  gapText: { color: colors.gapText, fontStyle: "italic" },

  // Quiet, de-emphasized unlogged line (past/idle gaps) — a thin muted row, not a card.
  gapQuietRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s2,
    paddingVertical: space.s0,
    marginBottom: space.s1,
  },
  gapQuietRail: { width: 14, alignItems: "center" },
  gapQuietDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gap },
  gapQuietText: { color: colors.gapText, flex: 1 },
  spanText: { ...type.caption, color: colors.muted },
  spanSub: { ...type.caption, color: colors.muted, marginTop: 4 },
  nowBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.s1,
    paddingVertical: 2,
  },
  nowBadgeText: { color: colors.onAccent, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },

  // working-hours modal
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: space.s3,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    padding: space.s3,
  },
  modalTitle: { color: colors.fg, marginBottom: space.s0 },
  modalSub: { color: colors.muted, marginBottom: space.s2 },
  modalFieldCard: { gap: space.s0 },
  modalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: space.s0,
  },
  modalActions: { marginTop: space.s3 },
});
