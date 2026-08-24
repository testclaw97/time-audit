// Turn the raw slot log into the payoff: an honest, ranked breakdown of where time went.
// Every logged slot is 15 minutes. Slots inside the awake window that were never answered
// become an explicit "Unlogged" bucket — we don't invent data, and the gap is part of the
// truth.
import type { Entries } from "./store";
import {
  SLOT_MS,
  displayLabel,
  normalizeLabel,
  slotsForDay,
  todaySlots,
} from "./time";

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
