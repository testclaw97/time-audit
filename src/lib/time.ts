// Pure time math for the slot grid (15 minutes by default, now RUNTIME-CONFIGURABLE). No
// React, no platform deps — trivially testable and shared by the store, the notification
// scheduler and every screen.
//
// A "slot" is a block of `SLOT_MINUTES` minutes identified by its START time (epoch ms,
// aligned to a boundary in local time — :00/:15/:30/:45 at the 15-min default). A ping fires
// at the END boundary of a slot and asks "what did you just do?" — so at the 15-min default,
// a ping firing at 10:15 logs the slot that started at 10:00.
//
// SLOT SIZE IS CONFIGURABLE. The user can change the ping interval (5/10/15/20/30/45/60 min)
// in Settings. `configureSlotMinutes(n)` swaps the live slot size; every function below reads
// the CURRENT value via `getSlotMs()` so all downstream math (slot alignment, today's slots,
// weekly aggregation, upcoming pings) follows the chosen interval. Keep this the ONLY mutable
// module state — every function stays otherwise pure (same inputs + same slot config => same
// output).

// --- live, runtime-configurable slot size ---------------------------------------------
let SLOT_MINUTES = 15; // the currently-configured interval in minutes
let SLOT_MS_CURRENT = SLOT_MINUTES * 60 * 1000; // derived, kept in lock-step

/** Set the live slot size (ping interval) in minutes. Called by the store on hydrate and
 *  whenever the user changes `settings.intervalMinutes`. Ignores non-finite / non-positive
 *  input (falls back to the 15-min default) so a corrupt setting can never zero the grid. */
export function configureSlotMinutes(min: number): void {
  // Allow FRACTIONAL minutes (e.g. 0.5 = a 30-second test cadence) — don't floor. A non-finite or
  // non-positive value still falls back to the 15-min default so a corrupt setting can't zero the grid.
  const safe = Number.isFinite(min) && min > 0 ? min : 15;
  SLOT_MINUTES = safe;
  SLOT_MS_CURRENT = safe * 60 * 1000;
}

/** The CURRENT slot length in ms — the live value all slot math reads. Use this, not the
 *  `SLOT_MS` const below, anywhere the configured interval matters. */
export function getSlotMs(): number {
  return SLOT_MS_CURRENT;
}

/** The CURRENT slot length in minutes. */
export function getSlotMinutes(): number {
  return SLOT_MINUTES;
}

// NOTE: `SLOT_MS` is the DEFAULT (15-min) slot length, kept as a stable export purely for
// backward compatibility with callers that were written against the fixed grid (e.g.
// `notifications.ts` computes `fireDate.getTime() - SLOT_MS`). It does NOT track
// `configureSlotMinutes` — LIVE slot math uses `getSlotMs()`. Do not use `SLOT_MS` for new
// code that should honour the user's chosen interval.
export const SLOT_MS = 15 * 60 * 1000;
// Slots per hour at the DEFAULT grid. Retained only as a coarse loop-guard reference; the
// actual per-day bound is derived from the live `SLOT_MINUTES` via `slotsPerDayGuard()`.
export const SLOTS_PER_HOUR = 4;

/** A generous upper bound on how many slots could fall in a day at the current interval —
 *  used only to cap the while/for loops below so a bad window can never spin forever. Uses a
 *  floor of 5 min on the interval so the bound stays finite even if something odd is set. */
function slotsPerDayGuard(): number {
  // Floor the divisor at 0.25 min (15s) so a sub-minute test interval still produces a finite —
  // and correct — per-day bound (e.g. 30s → ~2880 slots) rather than being capped at ~296.
  return Math.ceil(1440 / Math.max(0.25, SLOT_MINUTES)) + 8;
}

/** Floor a Date/epoch to the start of its slot (local-aligned) at the CURRENT interval. */
export function slotStartFor(input: Date | number): number {
  const t = typeof input === "number" ? input : input.getTime();
  const ms = getSlotMs();
  return Math.floor(t / ms) * ms;
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
  const step = getSlotMs();
  // Walk from wake boundary today to the current slot.
  let firstMod = wake;
  const first = new Date(startOfDay.getTime() + firstMod * 60 * 1000);
  let t = slotStartFor(first);
  // guard against pathological loops (max a full day of slots at the current interval)
  let guard = 0;
  const maxGuard = slotsPerDayGuard();
  while (t <= nowSlot && guard < maxGuard) {
    const mod = minuteOfDay(t);
    if (slotInWindow(mod, wake, sleep)) out.push(t);
    t += step;
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
  const step = getSlotMs();
  const slotsInDay = Math.ceil(1440 / Math.max(0.25, SLOT_MINUTES));
  for (let i = 0; i < slotsInDay; i++) {
    const t = startOfDay.getTime() + i * step;
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
  const step = getSlotMs();
  // next boundary strictly after `from`
  let t = slotStartFor(from) + step;
  const end = from.getTime() + hours * 60 * 60 * 1000;
  let guard = 0;
  // per-hour slot count at the current interval, plus headroom
  const maxGuard = Math.ceil(hours * (60 / Math.max(5, SLOT_MINUTES))) + 8;
  while (t <= end && out.length < max && guard < maxGuard) {
    if (t > from.getTime() && inPingWindow(minuteOfDay(t), wake, sleep)) {
      out.push(new Date(t));
    }
    t += step;
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
