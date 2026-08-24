// Pure time math for the 15-minute grid. No React, no platform deps — trivially testable
// and shared by the store, the notification scheduler and every screen.
//
// A "slot" is a 15-minute block identified by its START time (epoch ms, aligned to a
// :00/:15/:30/:45 boundary in local time). A ping fires at the END boundary of a slot and
// asks "what did you just do?" — so a ping firing at 10:15 logs the slot that started at
// 10:00.

export const SLOT_MS = 15 * 60 * 1000;
export const SLOTS_PER_HOUR = 4;

/** Floor a Date/epoch to the start of its 15-minute slot (local-aligned). */
export function slotStartFor(input: Date | number): number {
  const t = typeof input === "number" ? input : input.getTime();
  return Math.floor(t / SLOT_MS) * SLOT_MS;
}

/** Minutes since local midnight for a given instant. */
export function minuteOfDay(input: Date | number): number {
  const d = typeof input === "number" ? new Date(input) : input;
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes-of-day -> a Date today (used to drive the time pickers). */
export function dateFromMinutes(mins: number, base: Date = new Date()): Date {
  const d = new Date(base);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

export function minutesFromDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Is a minute-of-day inside the awake window? Handles overnight windows (sleep < wake).
 *  Convention: a ping is valid when its minute-of-day is in (wake, sleep] — the first
 *  ping lands one slot AFTER wake (logging the first awake slot). */
export function inPingWindow(mod: number, wake: number, sleep: number): boolean {
  if (wake === sleep) return true; // 24h
  if (wake < sleep) return mod > wake && mod <= sleep;
  // overnight window, e.g. 22:00 -> 06:00
  return mod > wake || mod <= sleep;
}

/** Is a SLOT (by its start minute-of-day) inside the awake window? Slot start in [wake, sleep). */
export function slotInWindow(mod: number, wake: number, sleep: number): boolean {
  if (wake === sleep) return true;
  if (wake < sleep) return mod >= wake && mod < sleep;
  return mod >= wake || mod < sleep;
}

/** "10:15" */
export function formatClock(input: Date | number): string {
  const d = typeof input === "number" ? new Date(input) : input;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Minutes-of-day -> "07:00" (for the awake-window labels). */
export function formatClockMinutes(mins: number): string {
  const h = String(Math.floor(mins / 60) % 24).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** total minutes -> "3h 30m" / "45m" / "0m" */
export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** All slot-start epochs for today, from the wake boundary up to (and including) the
 *  slot currently in progress. Newest is NOT sorted here — caller decides order. */
export function todaySlots(wake: number, sleep: number, now: Date = new Date()): number[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const nowSlot = slotStartFor(now);
  const out: number[] = [];
  // Walk from wake boundary today to the current slot.
  let firstMod = wake;
  const first = new Date(startOfDay.getTime() + firstMod * 60 * 1000);
  let t = slotStartFor(first);
  // guard against pathological loops (max a full day of slots)
  let guard = 0;
  while (t <= nowSlot && guard < 24 * SLOTS_PER_HOUR + 4) {
    const mod = minuteOfDay(t);
    if (slotInWindow(mod, wake, sleep)) out.push(t);
    t += SLOT_MS;
    guard++;
  }
  return out;
}

/** All slot-start epochs for a given calendar day within the window (full day, for
 *  weekly aggregation over past days). */
export function slotsForDay(day: Date, wake: number, sleep: number): number[] {
  const startOfDay = new Date(day);
  startOfDay.setHours(0, 0, 0, 0);
  const out: number[] = [];
  for (let i = 0; i < 24 * SLOTS_PER_HOUR; i++) {
    const t = startOfDay.getTime() + i * SLOT_MS;
    if (slotInWindow(minuteOfDay(t), wake, sleep)) out.push(t);
  }
  return out;
}

/** Upcoming PING times (Date) within the awake window over the next `hours` hours,
 *  starting from the next boundary after `from`. Each is a moment to notify. */
export function upcomingPings(
  wake: number,
  sleep: number,
  from: Date = new Date(),
  hours = 24,
  max = 60,
): Date[] {
  const out: Date[] = [];
  // next boundary strictly after `from`
  let t = slotStartFor(from) + SLOT_MS;
  const end = from.getTime() + hours * 60 * 60 * 1000;
  let guard = 0;
  while (t <= end && out.length < max && guard < hours * SLOTS_PER_HOUR + 8) {
    if (t > from.getTime() && inPingWindow(minuteOfDay(t), wake, sleep)) {
      out.push(new Date(t));
    }
    t += SLOT_MS;
    guard++;
  }
  return out;
}

/** Day key "2026-08-24" in local time. */
export function dayKey(input: Date | number): string {
  const d = typeof input === "number" ? new Date(input) : input;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize an activity label for grouping: trimmed, collapsed spaces, lowercased. */
export function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Title-case a normalized label for display. */
export function displayLabel(normalized: string): string {
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
