// Home — "The Truth". This is the PAYOFF screen, not a logging form: the popup logs (one tap
// from the lock screen), and here you come to FACE where the day went. A streak, a hero showing
// hours tracked + the Deep/Shallow/Reactive split, a blunt Hormozi verdict, then a glanceable
// timeline where tapping any block opens a modal to log/fill it. Settings + pause live in the
// header (gear + bell); the old always-on "what are you doing?" picker is gone by design.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import QuickEntry from "../ui/QuickEntry";
import PressableScale from "../ui/PressableScale";
import Button from "../ui/Button";
import type { Category } from "../lib/store";
import { logEntry, logManyEntries, pausePopups, resumePopups, useStore } from "../lib/store";
import {
  KIND_META,
  computeKindSplit,
  computeStreak,
  hormoziVerdict,
  todayKeys,
} from "../lib/insights";
import TimePing, { isAvailable } from "../../modules/time-ping";
import {
  formatClock,
  formatDuration,
  getSlotMinutes,
  getSlotMs,
  slotStartFor,
  todaySlots,
} from "../lib/time";

// Safety cap on timeline rows (newest first); the rest is a quiet "+N earlier" note.
const MAX_ROWS = 180;

const SNOOZE_PRESETS = [
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
] as const;

/** Milliseconds until the next local wake boundary (today if ahead, else tomorrow). */
function msUntilNextWake(wakeMinutes: number): number {
  const now = new Date();
  const wake = new Date(now);
  wake.setHours(Math.floor(wakeMinutes / 60), wakeMinutes % 60, 0, 0);
  if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
  return wake.getTime() - now.getTime();
}

export default function TodayScreen({
  focusSlot,
  onOpenSettings,
}: {
  focusSlot?: number | null;
  /** Open the Settings modal (App.tsx wires this). */
  onOpenSettings?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { settings, entries } = useStore();
  const [now, setNow] = useState(() => new Date());
  const [logSlot, setLogSlot] = useState<number | null>(null); // slot open in the log modal
  const [showPause, setShowPause] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [overlayNeeded, setOverlayNeeded] = useState(false);
  const [fsiNeeded, setFsiNeeded] = useState(false);

  const paused = settings.pausedUntil > nowMs;
  const permNeeded = overlayNeeded || fsiNeeded;

  // Keep the timeline + "now" live.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tick each second only while paused, so the "paused until…" line stays fresh.
  useEffect(() => {
    if (settings.pausedUntil <= Date.now()) {
      setNowMs(Date.now());
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settings.pausedUntil]);

  // Popup grants (overlay = in-use full-screen; FSI = over the lock screen). No-op on web/iOS.
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

  // A notification / "Other" tap can ask us to open the log modal on a specific slot.
  useEffect(() => {
    if (typeof focusSlot === "number") setLogSlot(slotStartFor(focusSlot));
  }, [focusSlot]);

  const slotMs = getSlotMs();
  const slotMin = getSlotMinutes();
  const currentSlot = slotStartFor(now.getTime());

  const slots = useMemo(
    () => todaySlots(settings.wakeMinutes, settings.sleepMinutes, now),
    [settings.wakeMinutes, settings.sleepMinutes, now],
  );

  const catById = useMemo(
    () => new Map(settings.categories.map((c) => [c.id, c] as const)),
    [settings.categories],
  );

  // The truth: today's Deep/Shallow/Reactive split + streak + verdict.
  const split = useMemo(
    () =>
      computeKindSplit(
        entries,
        todayKeys(settings.wakeMinutes, settings.sleepMinutes, now),
        settings.categories,
      ),
    [entries, settings.wakeMinutes, settings.sleepMinutes, settings.categories, now],
  );
  const streak = useMemo(
    () => computeStreak(entries, settings.wakeMinutes, settings.sleepMinutes, now),
    [entries, settings.wakeMinutes, settings.sleepMinutes, now],
  );
  const verdict = useMemo(() => hormoziVerdict(split), [split]);

  const loggedCount = useMemo(
    () => slots.filter((s) => entries[String(s)]?.text?.trim()).length,
    [slots, entries],
  );

  const rowsDesc = useMemo(() => [...slots].reverse(), [slots]);
  const shownRows = rowsDesc.slice(0, MAX_ROWS);
  const earlierCount = rowsDesc.length - shownRows.length;

  // Catch-up: the run of consecutive unlogged blocks ending at NOW — i.e. what you missed while
  // you were away. One category tap fills the whole gap (see catchUpFill). Only surfaced at ≥2.
  const trailingGap = useMemo(() => {
    const g: number[] = [];
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (entries[String(s)]?.text?.trim()) break;
      g.push(s);
    }
    return g.reverse(); // ascending
  }, [slots, entries]);
  const gapMinutes = trailingGap.length * slotMin;

  const catchUpFill = (cat: Category) => {
    if (trailingGap.length === 0) return;
    void logManyEntries(trailingGap, cat.label, cat.id);
  };

  // ---- log modal ----
  const openLog = (slot: number) => setLogSlot(slotStartFor(slot));
  const closeLog = () => setLogSlot(null);
  const logEntryFor = (text: string, category?: string) => {
    if (logSlot == null) return;
    logEntry(text, logSlot, category);
    closeLog();
  };

  const logModalEntry = logSlot != null ? entries[String(logSlot)] : undefined;
  const logModalCurrent =
    logModalEntry?.text?.trim()
      ? {
          label: logModalEntry.text.trim(),
          category: logModalEntry.category ? catById.get(logModalEntry.category) : undefined,
        }
      : null;
  const logIsCurrent = logSlot === currentSlot;

  // ---- pause actions ----
  const snooze = (ms: number) => {
    void pausePopups(ms);
    setShowPause(false);
  };
  const resume = () => {
    void resumePopups();
    setShowPause(false);
  };

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s2, paddingBottom: insets.bottom + space.s6 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header: date + streak, pause bell + settings gear */}
      <FadeIn>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[type.label, styles.kicker]}>TODAY</Text>
            <Text style={[type.heading, styles.headerDate]}>{dateLabel}</Text>
          </View>
          <View style={styles.headerActions}>
            <IconBtn
              glyph="🔔"
              active={paused}
              label={paused ? "Popups paused" : "Pause popups"}
              onPress={() => setShowPause(true)}
            />
            <IconBtn glyph="⚙︎" label="Settings" onPress={onOpenSettings} disabled={!onOpenSettings} />
          </View>
        </View>
      </FadeIn>

      {permNeeded ? (
        <FadeIn>
          <PressableScale
            onPress={requestMissing}
            accessibilityLabel="The popup can't fully work yet. Tap to enable."
            style={styles.banner}
            scaleTo={0.99}
          >
            <Text style={styles.bannerText}>⚠️ The popup can't fully work yet — tap to enable.</Text>
          </PressableScale>
        </FadeIn>
      ) : null}

      {paused ? (
        <FadeIn>
          <PressableScale onPress={resume} accessibilityLabel="Resume popups" style={styles.pausedPill}>
            <Text style={styles.pausedPillText} numberOfLines={1}>
              🔕 Paused until {formatClock(settings.pausedUntil)} · tap to resume
            </Text>
          </PressableScale>
        </FadeIn>
      ) : null}

      {/* Catch-up — you've been away; one tap fills the whole gap */}
      {trailingGap.length >= 2 ? (
        <FadeIn>
          <Card tone="accent" style={styles.catchUp}>
            <Text style={styles.catchUpTitle}>⏳ You've been away</Text>
            <Text style={styles.catchUpSub}>
              {trailingGap.length} blocks ({formatDuration(gapMinutes)}) unlogged. What were you doing?
            </Text>
            <View style={styles.catchUpChips}>
              {settings.categories.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => catchUpFill(c)}
                  accessibilityLabel={`Fill the last ${trailingGap.length} blocks with ${c.label}`}
                  style={styles.catchUpChip}
                  scaleTo={0.94}
                >
                  <Text style={styles.catchUpEmoji}>{c.emoji}</Text>
                  <Text style={styles.catchUpChipText} numberOfLines={1}>
                    {c.label}
                  </Text>
                </PressableScale>
              ))}
            </View>
            <Text style={styles.catchUpHint}>Different things? Tap each block below instead.</Text>
          </Card>
        </FadeIn>
      ) : null}

      {/* HERO — the truth */}
      <FadeIn delay={60}>
        <Card style={styles.hero}>
          {streak > 0 ? (
            <View style={styles.streakRow}>
              <Text style={styles.streakText}>🔥 {streak}-day streak</Text>
            </View>
          ) : null}

          {split.loggedMin > 0 ? (
            <>
              <Text style={styles.heroValue}>{formatDuration(split.loggedMin)}</Text>
              <Text style={styles.heroCaption}>
                tracked today · {loggedCount} of {slots.length} check-ins
              </Text>

              <SplitBar split={split} />

              <View style={styles.legend}>
                <LegendDot kind="deep" pct={split.deepPct} />
                <LegendDot kind="shallow" pct={split.shallowPct} />
                <LegendDot kind="reactive" pct={split.reactivePct} />
              </View>
            </>
          ) : (
            <View style={styles.heroEmpty}>
              <Text style={styles.heroValue}>—</Text>
              <Text style={styles.heroCaption}>
                Nothing logged yet today. Tap a block below, or wait for the next check-in.
              </Text>
            </View>
          )}
        </Card>
      </FadeIn>

      {/* Hormozi verdict */}
      <FadeIn delay={110}>
        <View style={styles.verdict}>
          <Text style={[type.title, styles.verdictHeadline]}>{verdict.headline}</Text>
          <Text style={[type.body, styles.verdictSub]}>{verdict.sub}</Text>
        </View>
      </FadeIn>

      {/* Timeline — tap a block to log/fill it */}
      <View style={styles.timeline}>
        <Text style={[type.label, styles.timelineLabel]}>YOUR DAY · tap a block to log</Text>
        {shownRows.length === 0 ? (
          <Card tone="flat" style={styles.empty}>
            <Text style={styles.emptyIcon}>🕒</Text>
            <Text style={[type.bodyStrong, styles.emptyTitle]}>Your day starts here</Text>
            <Text style={[type.caption, styles.emptyBody]}>
              Your first check-in opens at your wake time. Tap any block to log it.
            </Text>
          </Card>
        ) : (
          <>
            {shownRows.map((slot) => {
              const e = entries[String(slot)];
              const label = e?.text?.trim() ? e.text.trim() : null;
              const cat = e?.category ? catById.get(e.category) : undefined;
              return (
                <TimelineRow
                  key={slot}
                  slot={slot}
                  slotMs={slotMs}
                  label={label}
                  emoji={cat?.emoji}
                  color={cat?.color}
                  isNow={slot === currentSlot}
                  onPress={() => openLog(slot)}
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

      {/* Log-a-slot modal */}
      <Modal visible={logSlot != null} transparent animationType="slide" onRequestClose={closeLog}>
        <View style={styles.sheetScrim}>
          <Pressable style={styles.sheetBackdrop} onPress={closeLog} accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s2 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[type.heading, styles.sheetTitle]}>
              {logIsCurrent
                ? "What are you doing right now?"
                : logSlot != null
                ? `${formatClock(logSlot)}–${formatClock(logSlot + slotMs)}`
                : ""}
            </Text>
            {logSlot != null ? (
              <QuickEntry
                key={logSlot}
                placeholder={logIsCurrent ? "e.g. deep work, email, lunch…" : "Log this block…"}
                categories={settings.categories}
                onPickCategory={(c: Category) => logEntryFor(c.label, c.id)}
                current={logModalCurrent}
                onClear={() => logEntryFor("")}
                onSubmit={(t: string) => logEntryFor(t)}
              />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Pause popups sheet */}
      <Modal visible={showPause} transparent animationType="slide" onRequestClose={() => setShowPause(false)}>
        <View style={styles.sheetScrim}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setShowPause(false)}
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s2 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[type.heading, styles.sheetTitle]}>Pause popups</Text>
            <Text style={[type.caption, styles.sheetSub]}>
              Silence the check-in popups for a while — tracking stays on.
            </Text>
            {paused ? (
              <Button label={`Resume now (paused until ${formatClock(settings.pausedUntil)})`} onPress={resume} />
            ) : (
              <View style={styles.pauseGrid}>
                {SNOOZE_PRESETS.map((p) => (
                  <PressableScale
                    key={p.label}
                    onPress={() => snooze(p.ms)}
                    accessibilityLabel={`Pause for ${p.label}`}
                    style={styles.pauseChip}
                    scaleTo={0.95}
                  >
                    <Text style={styles.pauseChipText}>{p.label}</Text>
                  </PressableScale>
                ))}
                <PressableScale
                  onPress={() => snooze(msUntilNextWake(settings.wakeMinutes))}
                  accessibilityLabel="Pause until tomorrow"
                  style={styles.pauseChip}
                  scaleTo={0.95}
                >
                  <Text style={styles.pauseChipText}>Until tomorrow</Text>
                </PressableScale>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/** The Deep/Shallow/Reactive stacked bar over the whole elapsed window — unlogged shows as the
 *  honest grey remainder, so gaps are part of the truth. */
function SplitBar({
  split,
}: {
  split: ReturnType<typeof computeKindSplit>;
}) {
  const total = split.totalMin || 1;
  const seg = (min: number, color: string, key: string) =>
    min > 0 ? (
      <View key={key} style={{ width: `${(min / total) * 100}%`, backgroundColor: color }} />
    ) : null;
  return (
    <View style={styles.splitBar}>
      {seg(split.deepMin, KIND_META.deep.color, "deep")}
      {seg(split.shallowMin, KIND_META.shallow.color, "shallow")}
      {seg(split.reactiveMin, KIND_META.reactive.color, "reactive")}
      {seg(split.unloggedMin, colors.gap, "gap")}
    </View>
  );
}

function LegendDot({ kind, pct }: { kind: keyof typeof KIND_META; pct: number }) {
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

function IconBtn({
  glyph,
  label,
  onPress,
  active,
  disabled,
}: {
  glyph: string;
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="button"
      style={[styles.iconBtn, active && styles.iconBtnActive, disabled && styles.iconBtnDisabled]}
      scaleTo={0.9}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </PressableScale>
  );
}

// One glanceable timeline block. Logged blocks get a solid surface + colored dot; empty blocks
// stay quiet ("tap to log") so the day's real entries stand out. NOW is tinted + badged.
function TimelineRow({
  slot,
  slotMs,
  label,
  emoji,
  color,
  isNow,
  onPress,
}: {
  slot: number;
  slotMs: number;
  label: string | null;
  emoji?: string;
  color?: string;
  isNow: boolean;
  onPress: () => void;
}) {
  const logged = label != null;
  const dotColor = isNow ? colors.accent : logged ? color ?? colors.teal : colors.gap;
  const a11y = logged ? `Edit ${formatClock(slot)}, logged as ${label}` : `Log ${formatClock(slot)}`;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={a11y}
      style={[styles.row, logged && styles.rowLogged, isNow && styles.rowNow]}
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
  content: { paddingHorizontal: space.s3, gap: space.s2 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flex: 1 },
  kicker: { color: colors.accent, marginBottom: 2 },
  headerDate: { color: colors.fg },
  headerActions: { flexDirection: "row", gap: space.s1 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  iconBtnDisabled: { opacity: 0.4 },
  iconGlyph: { fontSize: 18, color: colors.fg2 },

  banner: {
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    borderRadius: radius.md,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
  },
  bannerText: { ...type.caption, color: colors.accent2, fontWeight: "700" },

  pausedPill: {
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    borderRadius: radius.pill,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    alignItems: "center",
  },
  pausedPillText: { ...type.caption, color: colors.accent2, fontWeight: "700" },

  // catch-up
  catchUp: { paddingVertical: space.s2, gap: space.s1 },
  catchUpTitle: { ...type.subheading, color: colors.accent2 },
  catchUpSub: { ...type.caption, color: colors.fg2 },
  catchUpChips: { flexDirection: "row", flexWrap: "wrap", gap: space.s1, marginTop: space.s0 },
  catchUpChip: {
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
  catchUpEmoji: { fontSize: 15 },
  catchUpChipText: { color: colors.fg2, fontWeight: "700", fontSize: 13, maxWidth: 120 },
  catchUpHint: { ...type.caption, color: colors.muted, marginTop: space.s0 },

  // hero
  hero: { paddingVertical: space.s3, gap: space.s1 },
  streakRow: { marginBottom: space.s0 },
  streakText: { ...type.bodyStrong, color: colors.accent2 },
  heroValue: { fontSize: 52, lineHeight: 56, fontWeight: "800", color: colors.fg, letterSpacing: -1 },
  heroCaption: { ...type.caption, color: colors.muted, marginTop: 2 },
  heroEmpty: { gap: space.s1 },
  splitBar: {
    flexDirection: "row",
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.gap,
    overflow: "hidden",
    marginTop: space.s2,
  },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.s2, marginTop: space.s2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...type.caption, color: colors.fg2, fontWeight: "600" },
  legendPct: { color: colors.fg, fontWeight: "800" },

  // verdict
  verdict: { gap: space.s0, marginTop: space.s1 },
  verdictHeadline: { color: colors.fg },
  verdictSub: { color: colors.fg2 },

  // timeline
  timeline: { gap: space.s0, marginTop: space.s1 },
  timelineLabel: { color: colors.muted, marginBottom: space.s1 },
  empty: { alignItems: "center", paddingVertical: space.s4, gap: space.s1 },
  emptyIcon: { fontSize: 30, marginBottom: space.s0 },
  emptyTitle: { color: colors.fg },
  emptyBody: { color: colors.muted, textAlign: "center", maxWidth: 260 },

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
  rowLogged: { backgroundColor: colors.surface, borderColor: colors.line },
  rowNow: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  railCol: { width: 16, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  railLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.line },
  railDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: colors.bg },
  railDotNow: { width: 12, height: 12, borderRadius: 6 },
  rowMain: { flex: 1, minWidth: 0 },
  rowLoggedLine: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  rowEmoji: { fontSize: 16 },
  rowLabel: { color: colors.fg, flexShrink: 1 },
  rowEmptyText: { color: colors.gapText },
  rowNowText: { color: colors.accent2, fontWeight: "700" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  rowTime: { color: colors.fg2, fontVariant: ["tabular-nums"] },
  earlierNote: { ...type.caption, color: colors.muted, textAlign: "center", marginTop: space.s1 },
  nowBadge: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.s1, paddingVertical: 2 },
  nowBadgeText: { color: colors.onAccent, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },

  // bottom sheets (log + pause)
  sheetScrim: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingHorizontal: space.s3,
    paddingTop: space.s2,
    gap: space.s2,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: space.s1,
  },
  sheetTitle: { color: colors.fg },
  sheetSub: { color: colors.muted, marginTop: -space.s1 },
  pauseGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  pauseChip: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  pauseChipText: { color: colors.fg2, fontWeight: "700", fontSize: 15 },
});
