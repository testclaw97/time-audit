// Home / Today — a simple home: two summary boxes (working time + categories), a "pause
// popups" snooze control, then the 15-minute timetable (newest at the top). The timetable is a
// flat, scannable list — EVERY interval from wake to now is its own row (no merging, no
// expand/collapse). Each row shows the logged category (dot + emoji + label) or a quiet
// "tap to log"; the current interval is marked NOW. Tapping any row logs/edits THAT interval
// via the QuickEntry above (the "Editing …" header + one-tap chips). One tap on a chip = logged.
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
  slotStartFor,
  todaySlots,
} from "../lib/time";

// Safety cap on how many interval rows we render at once (newest first). wake→now is at most a
// day; at a 5-min interval an 18h window is ~216 rows, so we cap and note "+N earlier".
const MAX_ROWS = 180;

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
  // On a native Android build, whether the popup's two special-access grants are still missing.
  // Overlay = cover the screen while in use; full-screen-intent = show over the LOCK SCREEN.
  // If EITHER is missing the popup can't fully work — drives the nudge banner. False on web/iOS.
  const [overlayNeeded, setOverlayNeeded] = useState(false);
  const [fsiNeeded, setFsiNeeded] = useState(false);

  const paused = settings.pausedUntil > nowMs;
  const permNeeded = overlayNeeded || fsiNeeded;

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

  // Track BOTH popup grants on mount + on every return to the foreground (they're granted in a
  // system screen, so they flip off-screen). Guarded — no-op on web/iOS where the banner stays hidden.
  const refreshPerms = useCallback(async () => {
    if (!isAvailable() || !TimePing) {
      setOverlayNeeded(false);
      setFsiNeeded(false);
      return;
    }
    try {
      const [overlay, fsi] = await Promise.all([
        TimePing.hasOverlayPermission(),
        TimePing.hasFullScreenIntent(),
      ]);
      setOverlayNeeded(!overlay);
      setFsiNeeded(!fsi);
    } catch (e) {
      console.warn("[today] refreshPerms failed", e);
    }
  }, []);

  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPerms();
    });
    return () => sub.remove();
  }, [refreshPerms]);

  // Tapping the banner requests whichever grant is missing (overlay first, then lock-screen).
  const requestMissing = async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      if (overlayNeeded) await TimePing.requestOverlayPermission();
      else await TimePing.requestFullScreenIntent();
    } catch (e) {
      console.warn("[today] requestMissing failed", e);
    }
    refreshPerms();
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

  // Newest interval first — the plain wake→now list, capped for safety. NO merging: every
  // interval is its own row. Slice keeps the most recent MAX_ROWS; the rest is a quiet note.
  const rowsDesc = useMemo(() => [...slots].reverse(), [slots]);
  const shownRows = rowsDesc.slice(0, MAX_ROWS);
  const earlierCount = rowsDesc.length - shownRows.length;

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

  // Tap a timetable row -> edit that interval via the QuickEntry above. Tapping the current
  // interval returns to the plain "right now" picker (editing = null).
  const selectSlot = (slot: number) => {
    const s = slotStartFor(slot);
    setEditing(s === currentSlot ? null : s);
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
      {permNeeded ? (
        <FadeIn>
          <PressableScale
            onPress={requestMissing}
            accessibilityLabel="The popup can't fully work yet. Tap to enable."
            style={styles.overlayBanner}
            scaleTo={0.99}
          >
            <Text style={styles.overlayBannerText}>
              ⚠️ The popup can't fully work yet — tap to enable.
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
              <Text style={[type.caption, styles.boxSub]} numberOfLines={2}>
                {formatDuration(loggedCount * slotMin)} logged · {loggedCount} of{" "}
                {slots.length} check-ins
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
            editingIsCurrent ? "e.g. deep work, email, lunch…" : "Log this check-in…"
          }
          categories={settings.categories}
          onPickCategory={pickCategory}
          current={currentEntry}
          onClear={clearSlot}
          onSubmit={submit}
        />
      </FadeIn>

      {/* The 15-minute timetable — one row per interval, newest first, tap to log/edit */}
      <View style={styles.timeline}>
        <Text style={[type.label, styles.timelineLabel]}>TIMETABLE · tap a time to log</Text>
        {shownRows.length === 0 ? (
          <Card tone="flat" style={styles.empty}>
            <Text style={styles.emptyIcon}>🕒</Text>
            <Text style={[type.bodyStrong, styles.emptyTitle]}>Your day starts here</Text>
            <Text style={[type.caption, styles.emptyBody]}>
              Your first check-in opens at your wake time. Log what you're doing above.
            </Text>
          </Card>
        ) : (
          <>
            {shownRows.map((slot) => {
              const e = entries[String(slot)];
              const label = e?.text?.trim() ? e.text.trim() : null;
              const cat = e?.category ? catById.get(e.category) : undefined;
              const isNow = slot === currentSlot;
              return (
                <TimelineRow
                  key={slot}
                  slot={slot}
                  slotMs={slotMs}
                  label={label}
                  emoji={cat?.emoji}
                  color={cat?.color}
                  isNow={isNow}
                  selected={!editingIsCurrent && editingSlot === slot}
                  onPress={() => selectSlot(slot)}
                />
              );
            })}
            {earlierCount > 0 ? (
              <Text style={styles.earlierNote}>
                +{earlierCount} earlier {earlierCount === 1 ? "block" : "blocks"} not shown
              </Text>
            ) : null}
          </>
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

// One interval row in the flat timetable. Logged rows get a solid surface + colored dot/emoji
// so they pop; empty rows stay a quiet "tap to log" so the day's real entries stand out. The
// current interval is tinted and badged NOW. Tapping the row edits it via the QuickEntry above.
function TimelineRow({
  slot,
  slotMs,
  label,
  emoji,
  color,
  isNow,
  selected,
  onPress,
}: {
  slot: number;
  slotMs: number;
  label: string | null;
  emoji?: string;
  color?: string;
  isNow: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const range = `${formatClock(slot)}–${formatClock(slot + slotMs)}`;
  const logged = label != null;
  // Dot: accent for NOW, the category color (or teal for a custom entry) when logged, else the
  // dim gap tone for an empty interval.
  const dotColor = isNow ? colors.accent : logged ? color ?? colors.teal : colors.gap;
  const a11y = logged
    ? `Edit ${formatClock(slot)}, logged as ${label}`
    : `Log ${formatClock(slot)}`;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={a11y}
      style={[
        styles.row,
        logged && styles.rowLogged,
        isNow && styles.rowNow,
        selected && styles.rowSelected,
      ]}
      scaleTo={0.985}
    >
      <View style={styles.railCol}>
        <View style={styles.railLine} />
        <View style={[styles.railDot, { backgroundColor: dotColor }, isNow && styles.railDotNow]} />
      </View>

      <View style={styles.rowMain}>
        {logged ? (
          <View style={styles.rowLoggedLine}>
            {emoji ? <Text style={styles.rowEmoji}>{emoji}</Text> : null}
            <Text style={[type.bodyStrong, styles.rowLabel]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ) : (
          <Text style={[type.body, isNow ? styles.rowNowText : styles.rowEmptyText]} numberOfLines={1}>
            {isNow ? "Right now — tap to log" : "tap to log"}
          </Text>
        )}
      </View>

      <View style={styles.rowRight}>
        {isNow ? (
          <View style={styles.nowBadge}>
            <Text style={styles.nowBadgeText}>NOW</Text>
          </View>
        ) : null}
        <Text style={[type.mono, styles.rowTime]}>{formatClock(slot)}</Text>
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

  // One flat interval row: slim left rail (continuous line + dot), content, right-aligned time.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    paddingVertical: space.s1,
    paddingHorizontal: space.s1,
    marginBottom: 2,
  },
  // Logged rows get a solid surface so they pop; empty rows stay transparent + quiet.
  rowLogged: { backgroundColor: colors.surface, borderColor: colors.line },
  rowNow: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  rowSelected: { borderColor: colors.accent },

  railCol: { width: 16, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  railLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.line },
  railDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  railDotNow: { width: 12, height: 12, borderRadius: 6 },

  rowMain: { flex: 1, minWidth: 0 },
  rowLoggedLine: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  rowEmoji: { fontSize: 16 },
  rowLabel: { color: colors.fg, flexShrink: 1 },
  rowEmptyText: { color: colors.gapText },
  rowNowText: { color: colors.accent2, fontWeight: "700" },

  rowRight: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  rowTime: { color: colors.fg2, fontVariant: ["tabular-nums"] },

  earlierNote: {
    ...type.caption,
    color: colors.muted,
    textAlign: "center",
    marginTop: space.s1,
  },

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
