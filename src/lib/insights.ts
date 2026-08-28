// Turn the raw slot log into the payoff: an honest, ranked breakdown of where time went.
// Every logged slot is 15 minutes. Slots inside the awake window that were never answered
// become an explicit "Unlogged" bucket — we don't invent data, and the gap is part of the
// truth.
import type { Category, CategoryKind, Entries } from "./store";
import { colors } from "../theme";
import {
  SLOT_MS,
  displayLabel,
  getSlotMinutes,
  normalizeLabel,
  slotStartFor,
  slotsForDay,
  todaySlots,
} from "./time";

/**
 * The "you've been away" run: consecutive UNLOGGED blocks ending at NOW (ascending). Ignores
 * blocks from before tracking began (a fresh install mid-day shouldn't claim hours of absence)
 * and caps the run at 24 so a long absence stays a sensible one-screen fill. Shared by the Today
 * catch-up card and the on-open catch-up wall so both agree on exactly what "caught up" means.
 */
export function trailingGapSlots(
  entries: Entries,
  wake: number,
  sleep: number,
  trackingStartedAt: number,
  now: Date = new Date(),
): number[] {
  const slots = todaySlots(wake, sleep, now);
  const startBoundary = trackingStartedAt > 0 ? slotStartFor(trackingStartedAt) : 0;
  const gap: number[] = [];
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (entries[String(s)]?.text?.trim()) break;
    if (s < startBoundary) break;
    gap.push(s);
    if (gap.length >= 24) break;
  }
  return gap.reverse();
}

export interface Group {
  label: string; // normalized key
  display: string; // title-cased for UI
  count: number; // slots
  minutes: number; // count * 15
}

export interface Breakdown {
  totalSlots: number; // expected slots in the period (window slots that have elapsed)
  loggedSlots: number;
  unloggedSlots: number;
  loggedMinutes: number;
  unloggedMinutes: number;
  groups: Group[]; // ranked desc by count, excludes the unlogged bucket
}

/** Aggregate a set of expected slot-start epochs against the log. */
export function computeBreakdown(entries: Entries, slotKeys: number[]): Breakdown {
  const counts = new Map<string, { count: number; display: string }>();
  let logged = 0;
  for (const slot of slotKeys) {
    const e = entries[String(slot)];
    if (e && e.text.trim().length > 0) {
      logged++;
      const key = normalizeLabel(e.text);
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { count: 1, display: displayLabel(key) });
    }
  }
  const groups: Group[] = [...counts.entries()]
    .map(([label, v]) => ({
      label,
      display: v.display,
      count: v.count,
      minutes: v.count * (SLOT_MS / 60000),
    }))
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));

  const total = slotKeys.length;
  const unlogged = total - logged;
  return {
    totalSlots: total,
    loggedSlots: logged,
    unloggedSlots: unlogged,
    loggedMinutes: logged * (SLOT_MS / 60000),
    unloggedMinutes: unlogged * (SLOT_MS / 60000),
    groups,
  };
}

/** Expected slot keys for today (wake -> current slot). */
export function todayKeys(wake: number, sleep: number, now: Date = new Date()): number[] {
  return todaySlots(wake, sleep, now);
}

/** Expected slot keys for the current calendar week (Mon 00:00 -> now), across days,
 *  only counting slots that have already elapsed. */
export function weekKeys(wake: number, sleep: number, now: Date = new Date()): number[] {
  const nowMs = now.getTime();
  // Monday of this week
  const monday = new Date(now);
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(monday.getDate() - dow);
  monday.setHours(0, 0, 0, 0);

  const keys: number[] = [];
  for (let i = 0; i <= dow; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    for (const s of slotsForDay(day, wake, sleep)) {
      if (s <= nowMs) keys.push(s);
    }
  }
  return keys;
}

// ============================================================================
// v2 "The Truth" — the Hormozi Deep/Shallow/Reactive frame + streak + trends.
// This is the payoff layer the Home + Insights screens render.
// ============================================================================

/** The three time-quality buckets, with their brand color + one-word gloss. Deep = high-value
 *  creation (teal), Shallow = necessary-but-low-value (amber), Reactive = distraction/waste (red). */
export const KIND_META: Record<CategoryKind, { label: string; color: string; noun: string }> = {
  deep: { label: "Deep", color: colors.teal, noun: "deep work" },
  shallow: { label: "Shallow", color: colors.accent, noun: "shallow work" },
  reactive: { label: "Reactive", color: colors.danger, noun: "reacting" },
};

/** The Deep/Shallow/Reactive split for a set of slots, in minutes + percentages of LOGGED time. */
export interface KindSplit {
  deepMin: number;
  shallowMin: number;
  reactiveMin: number;
  loggedMin: number;
  unloggedMin: number;
  totalMin: number;
  loggedPct: number; // logged / total
  deepPct: number; // of logged
  shallowPct: number; // of logged
  reactivePct: number; // of logged
}

/** Resolve a logged slot's kind. Uncategorized (custom-text) entries default to "shallow"
 *  (matches the store's kind migration default) so they never vanish from the split. */
function slotKind(
  entries: Entries,
  slot: number,
  catById: Map<string, Category>,
): CategoryKind | null {
  const e = entries[String(slot)];
  if (!e || e.text.trim().length === 0) return null;
  const cat = e.category ? catById.get(e.category) : undefined;
  return cat?.kind ?? "shallow";
}

/** Aggregate a set of expected slot keys into the Deep/Shallow/Reactive split. Uses the LIVE
 *  interval (getSlotMinutes) so durations are correct at any cadence, not a hardcoded 15. */
export function computeKindSplit(
  entries: Entries,
  keys: number[],
  categories: Category[],
): KindSplit {
  const slotMin = getSlotMinutes();
  const catById = new Map(categories.map((c) => [c.id, c] as const));
  let deep = 0;
  let shallow = 0;
  let reactive = 0;
  let logged = 0;
  for (const slot of keys) {
    const kind = slotKind(entries, slot, catById);
    if (!kind) continue;
    logged++;
    if (kind === "deep") deep++;
    else if (kind === "reactive") reactive++;
    else shallow++;
  }
  const total = keys.length;
  const unlogged = total - logged;
  const pctOfLogged = (n: number) => (logged > 0 ? Math.round((n / logged) * 100) : 0);
  return {
    deepMin: deep * slotMin,
    shallowMin: shallow * slotMin,
    reactiveMin: reactive * slotMin,
    loggedMin: logged * slotMin,
    unloggedMin: unlogged * slotMin,
    totalMin: total * slotMin,
    loggedPct: total > 0 ? Math.round((logged / total) * 100) : 0,
    deepPct: pctOfLogged(deep),
    shallowPct: pctOfLogged(shallow),
    reactivePct: pctOfLogged(reactive),
  };
}

/** Consecutive days (ending today, or yesterday if today has nothing yet) with ≥1 logged slot.
 *  Today being empty does NOT break the streak — you may just not have logged yet. */
export function computeStreak(
  entries: Entries,
  wake: number,
  sleep: number,
  now: Date = new Date(),
): number {
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const logged = slotsForDay(d, wake, sleep).some(
      (s) => entries[String(s)]?.text?.trim(),
    );
    if (logged) {
      streak++;
    } else if (i === 0) {
      continue; // today may just be early — don't break a real streak
    } else {
      break;
    }
  }
  return streak;
}

/** One day's stacked bar for the 7-day trend. Only ELAPSED slots count (today up to now). */
export interface DayBar {
  label: string; // "Mon"
  isToday: boolean;
  deepMin: number;
  shallowMin: number;
  reactiveMin: number;
  loggedMin: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Deep/Shallow/Reactive minutes for each of the last 7 days (oldest → today). */
export function weekDayBars(
  entries: Entries,
  categories: Category[],
  wake: number,
  sleep: number,
  now: Date = new Date(),
): DayBar[] {
  const slotMin = getSlotMinutes();
  const catById = new Map(categories.map((c) => [c.id, c] as const));
  const nowMs = now.getTime();
  const bars: DayBar[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    let deep = 0;
    let shallow = 0;
    let reactive = 0;
    let logged = 0;
    for (const s of slotsForDay(d, wake, sleep)) {
      if (s > nowMs) continue;
      const kind = slotKind(entries, s, catById);
      if (!kind) continue;
      logged++;
      if (kind === "deep") deep++;
      else if (kind === "reactive") reactive++;
      else shallow++;
    }
    bars.push({
      label: DAY_NAMES[d.getDay()],
      isToday: i === 0,
      deepMin: deep * slotMin,
      shallowMin: shallow * slotMin,
      reactiveMin: reactive * slotMin,
      loggedMin: logged * slotMin,
    });
  }
  return bars;
}

/** The blunt Hormozi verdict for a split — a headline + a sub-line, tiered on where time went. */
export function hormoziVerdict(split: KindSplit): { headline: string; sub: string } {
  if (split.loggedMin === 0) {
    return {
      headline: "No data, no truth.",
      sub: "Answer a few check-ins. The honest picture builds itself — you just have to look.",
    };
  }
  if (split.reactivePct >= 40) {
    return {
      headline: "You're mostly reacting.",
      sub: `${split.reactivePct}% of your logged time was reactive. That's not your schedule — that's the world running yours.`,
    };
  }
  if (split.deepPct >= 45) {
    return {
      headline: "That's a real day.",
      sub: `${split.deepPct}% deep work. This is what moving the needle looks like. Don't break the streak.`,
    };
  }
  if (split.reactivePct >= 20) {
    return {
      headline: "Half yours, half theirs.",
      sub: `${split.deepPct}% deep, ${split.reactivePct}% reactive. Every block you don't own, someone else does.`,
    };
  }
  return {
    headline: "Steady hands.",
    sub: `${split.deepPct}% deep, ${split.shallowPct}% shallow. Solid — now see if tomorrow can beat it.`,
  };
}

/** Project a measured amount of minutes over N elapsed days to a full year. */
export function projectAnnual(minutes: number, overDays: number): {
  hoursPerYear: number;
  daysPerYear: number;
} {
  const perDay = overDays > 0 ? minutes / overDays : 0;
  const perYearMin = perDay * 365;
  return {
    hoursPerYear: Math.round(perYearMin / 60),
    daysPerYear: Math.round((perYearMin / 60 / 24) * 10) / 10,
  };
}
