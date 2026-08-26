// Local-only persistence + a tiny reactive store. Everything lives on-device in
// AsyncStorage — no backend, no login, no network. Screens subscribe via useStore() and
// re-render when the log or settings change (e.g. after a notification direct-reply saves
// an entry).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { configureSlotMinutes, slotStartFor } from "./time";
// The native full-screen-chooser module (Android only). It is an OPTIONAL native module:
// `isAvailable()` returns false on web and iOS (where `requireOptionalNativeModule("TimePing")`
// resolves to null), and `TimePing` is null there. EVERY native call below is guarded on
// `isAvailable()` and wrapped in try/catch so the web export (`npx expo export --platform web`)
// never imports a real native binding or crashes. Import is lazy in spirit — the module's own
// `index.ts` no-ops on non-Android — so this top-level import is safe on all platforms.
import TimePing, { isAvailable } from "../../modules/time-ping";

const K_SETTINGS = "ta:settings:v1";
const K_ENTRIES = "ta:entries:v1";

/** A loggable activity category. `id` is stable and shared with the native chooser (the
 *  Kotlin module seeds the SAME ids from DEFAULT_CATEGORIES), so a PendingLog's `category`
 *  can be resolved back to a label here. */
/** Hormozi's time buckets — the classification that powers the "where did my time go" stat.
 *  deep = high-value creation; shallow = necessary but low-value; reactive = interruptions /
 *  other-driven / distraction. Every category is tagged with one so Stats can show both the
 *  per-category breakdown AND the blunt "X% of your time was shallow/reactive" headline. */
export type CategoryKind = "deep" | "shallow" | "reactive";

export interface Category {
  id: string;
  emoji: string;
  label: string;
  color: string;
  kind: CategoryKind; // Deep / Shallow / Reactive — user-editable, defaulted per seed below
}

export interface Settings {
  onboarded: boolean;
  tracking: boolean;
  wakeMinutes: number; // minutes since midnight, e.g. 7*60 = 420
  sleepMinutes: number; // e.g. 23*60 = 1380
  intervalMinutes: number; // ping cadence in minutes (default 15; 5/10/15/20/30/45/60)
  categories: Category[]; // user-editable category list (seeded with DEFAULT_CATEGORIES)
  pausedUntil: number; // epoch ms popups are snoozed until; 0 = not paused
  lockScreenPopup: boolean; // show the full-screen popup over the LOCK SCREEN (default true; a choice)
  oemSetupConfirmed: boolean; // user confirmed they enabled the OEM (MIUI/Samsung) extra switches
}

export interface Entry {
  text: string; // raw label as typed, OR the resolved category label for a chip tap
  ts: number; // when it was logged (epoch ms)
  category?: string; // Category.id when logged via a chip; absent for custom/legacy entries
}

// entries keyed by slot-start epoch (as string, since JSON object keys are strings)
export type Entries = Record<string, Entry>;

// The seed category set. MUST stay byte-for-byte identical (ids, emoji, colors) to the native
// module's Kotlin seed — the native chooser records a PendingLog carrying one of THESE ids and
// the store resolves it back to `.label` on drain. Order here is the default display order.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "work", emoji: "💼", label: "Work", color: "#f5a623", kind: "shallow" },
  { id: "deep", emoji: "🎯", label: "Deep work", color: "#ffb84d", kind: "deep" },
  { id: "scroll", emoji: "📱", label: "Scrolling", color: "#ff5d6c", kind: "reactive" },
  { id: "eat", emoji: "🍽️", label: "Eating", color: "#38c8b0", kind: "shallow" },
  { id: "move", emoji: "🏋️", label: "Exercise", color: "#7bd88f", kind: "deep" },
  { id: "rest", emoji: "😴", label: "Rest", color: "#6c8cff", kind: "shallow" },
  { id: "people", emoji: "👥", label: "People", color: "#b98cff", kind: "shallow" },
  { id: "fun", emoji: "🎬", label: "Leisure", color: "#ff9f43", kind: "shallow" },
  { id: "travel", emoji: "🚗", label: "Travel", color: "#8a94a6", kind: "reactive" },
  { id: "learn", emoji: "🧠", label: "Learning", color: "#4dd0e1", kind: "deep" },
];

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  tracking: false,
  wakeMinutes: 7 * 60,
  sleepMinutes: 23 * 60,
  intervalMinutes: 15,
  categories: DEFAULT_CATEGORIES,
  pausedUntil: 0,
  lockScreenPopup: true,
  oemSetupConfirmed: false,
};

interface State {
  ready: boolean;
  settings: Settings;
  entries: Entries;
}

let state: State = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  entries: {},
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

/** Load persisted state from disk. Call once at app start. */
export async function hydrate(): Promise<void> {
  try {
    const [rawS, rawE] = await Promise.all([
      AsyncStorage.getItem(K_SETTINGS),
      AsyncStorage.getItem(K_ENTRIES),
    ]);
    const settings = rawS
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(rawS) as Partial<Settings>) }
      : DEFAULT_SETTINGS;
    // The spread above already back-fills intervalMinutes/categories for settings persisted
    // before those fields existed. Guard against an explicitly missing/empty categories array
    // (corrupt or partially-written data) — an empty category list would leave the chooser and
    // the in-app chips with nothing to show, so fall back to the defaults.
    if (!Array.isArray(settings.categories) || settings.categories.length === 0) {
      settings.categories = DEFAULT_CATEGORIES;
    } else {
      // Migration: categories persisted before the Deep/Shallow/Reactive tag get a default kind.
      settings.categories = settings.categories.map((c) =>
        c.kind ? c : { ...c, kind: "shallow" as CategoryKind },
      );
    }
    const entries = rawE ? (JSON.parse(rawE) as Entries) : {};
    setState({ ready: true, settings, entries });
    // Slot math must match the persisted interval BEFORE any screen reads today's slots.
    configureSlotMinutes(settings.intervalMinutes);
    // Push categories to the native chooser so a full-screen ping renders the user's set.
    // Guarded + fire-and-forget: no-op on web/iOS, never blocks hydrate.
    void syncCategoriesToNative();
  } catch (e) {
    console.warn("[store] hydrate failed", e);
    setState({ ready: true });
  }
}

async function persistSettings(s: Settings) {
  try {
    await AsyncStorage.setItem(K_SETTINGS, JSON.stringify(s));
  } catch (e) {
    console.warn("[store] persist settings failed", e);
  }
}

async function persistEntries(e: Entries) {
  try {
    await AsyncStorage.setItem(K_ENTRIES, JSON.stringify(e));
  } catch (err) {
    console.warn("[store] persist entries failed", err);
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...state.settings, ...patch };
  // If the ping cadence changed, re-point the slot math BEFORE we emit — screens re-render
  // synchronously off `emit()` and must read today's slots at the new interval immediately.
  if (patch.intervalMinutes !== undefined && patch.intervalMinutes !== state.settings.intervalMinutes) {
    configureSlotMinutes(next.intervalMinutes);
  }
  setState({ settings: next });
  await persistSettings(next);
  return next;
}

/** Snooze ALL popups for `durationMs` from now (e.g. 60*60*1000 = 1h). App.tsx re-arms the
 *  schedule off this settings change, so the native scheduler skips the paused window and the
 *  receiver stays silent until it passes. */
export async function pausePopups(durationMs: number): Promise<Settings> {
  return updateSettings({ pausedUntil: Date.now() + Math.max(0, durationMs) });
}

/** Clear any active snooze so popups resume immediately. */
export async function resumePopups(): Promise<Settings> {
  return updateSettings({ pausedUntil: 0 });
}

/** Milliseconds left on the current snooze, or 0 if not paused / expired. */
export function pauseRemainingMs(): number {
  const until = state.settings.pausedUntil;
  const left = until - Date.now();
  return left > 0 ? left : 0;
}

/** Log an activity for the slot containing `slotStart` (defaults to now's slot). Passing
 *  an empty string clears the slot. `category` (a Category.id) is stored when the entry came
 *  from a category chip / the native chooser; omitted for custom typed entries. Returns the
 *  updated entries. */
export async function logEntry(
  text: string,
  slotStart: number = slotStartFor(Date.now()),
  category?: string,
): Promise<Entries> {
  const key = String(slotStartFor(slotStart));
  const next: Entries = { ...state.entries };
  const clean = text.trim();
  if (clean.length === 0) {
    // Empty text clears the slot entirely — including any previously-stored category.
    delete next[key];
  } else {
    // Only attach the `category` key when defined, so custom/legacy entries stay shape-clean.
    next[key] = category !== undefined ? { text: clean, ts: Date.now(), category } : { text: clean, ts: Date.now() };
  }
  setState({ entries: next });
  await persistEntries(next);
  return next;
}

export async function clearAllEntries(): Promise<void> {
  setState({ entries: {} });
  await persistEntries({});
}

/** Full wipe — entries AND settings back to defaults (leaves onboarding done? no: reset). */
export async function clearAllData(): Promise<void> {
  setState({ entries: {}, settings: DEFAULT_SETTINGS });
  // Back to the default 15-min grid + default categories; keep native + slot math in step.
  configureSlotMinutes(DEFAULT_SETTINGS.intervalMinutes);
  await Promise.all([persistEntries({}), persistSettings(DEFAULT_SETTINGS)]);
  void syncCategoriesToNative();
}

// ---- categories (user-editable; mirrored to the native chooser) ---------------------

/** Build a stable, collision-free id from a label (slug), falling back to a counter. Ids are
 *  what the native chooser records in a PendingLog, so they must be unique + URL-safe-ish. */
function makeCategoryId(label: string, existing: Category[]): string {
  const base =
    label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cat";
  const taken = new Set(existing.map((c) => c.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Persist a new settings object (categories changed) + push the set to the native chooser. */
async function commitCategories(categories: Category[]): Promise<void> {
  const next = { ...state.settings, categories };
  setState({ settings: next });
  await persistSettings(next);
  void syncCategoriesToNative();
}

/** Add a category to the end of the list. Returns the created category (with its generated id). */
export async function addCategory(partial: {
  emoji: string;
  label: string;
  color: string;
  kind?: CategoryKind;
}): Promise<Category> {
  const cat: Category = {
    id: makeCategoryId(partial.label, state.settings.categories),
    emoji: partial.emoji,
    label: partial.label,
    color: partial.color,
    kind: partial.kind ?? "shallow",
  };
  await commitCategories([...state.settings.categories, cat]);
  return cat;
}

/** Patch a category's emoji/label/color (id is immutable). No-op if the id is unknown. */
export async function updateCategory(
  id: string,
  patch: Partial<Omit<Category, "id">>,
): Promise<void> {
  await commitCategories(
    state.settings.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  );
}

/** Remove a category by id. */
export async function removeCategory(id: string): Promise<void> {
  await commitCategories(state.settings.categories.filter((c) => c.id !== id));
}

/** Reorder categories to match `orderedIds`. Any current category NOT named in the list is
 *  appended (never dropped) so a stale/partial order can't silently delete categories. */
export async function reorderCategories(orderedIds: string[]): Promise<void> {
  const byId = new Map(state.settings.categories.map((c) => [c.id, c]));
  const reordered: Category[] = [];
  for (const id of orderedIds) {
    const c = byId.get(id);
    if (c) {
      reordered.push(c);
      byId.delete(id);
    }
  }
  for (const c of byId.values()) reordered.push(c); // safety: keep any unmentioned
  await commitCategories(reordered);
}

/** Restore the default category set. */
export async function resetCategories(): Promise<void> {
  await commitCategories(DEFAULT_CATEGORIES);
}

// ---- native full-screen-chooser bridge (Android only; no-ops on web/iOS) ------------

/** Push the current category set to the native chooser so a full-screen ping renders the
 *  user's set. No-op + error-swallowing when the native module is absent (web/iOS). */
export async function syncCategoriesToNative(): Promise<void> {
  if (!isAvailable() || !TimePing) return;
  try {
    await TimePing.setCategories(state.settings.categories);
  } catch (e) {
    console.warn("[store] syncCategoriesToNative failed", e);
  }
}

/** Drain slots the native chooser logged while the app was away (killed / asleep) and replay
 *  them into the entry store. Each PendingLog's `category` id resolves to its label; the
 *  "__other__" sentinel and since-deleted ids are skipped (custom labels come through the
 *  in-app quick-entry flow, not here). Idempotent — clears the native queue after merging.
 *  Returns how many entries were written. No-op on web/iOS. */
export async function drainPendingLogs(): Promise<number> {
  if (!isAvailable() || !TimePing) return 0;
  try {
    const pending = await TimePing.getPendingLogs();
    if (!pending || pending.length === 0) return 0;
    const byId = new Map(state.settings.categories.map((c) => [c.id, c]));
    const next: Entries = { ...state.entries };
    let merged = 0;
    for (const p of pending) {
      const cat = byId.get(p.category);
      if (!cat) continue; // "__other__" or a deleted category — nothing to store here
      next[String(slotStartFor(p.slotStart))] = {
        text: cat.label,
        ts: p.ts || Date.now(),
        category: cat.id,
      };
      merged++;
    }
    if (merged > 0) {
      setState({ entries: next });
      await persistEntries(next);
    }
    await TimePing.clearPendingLogs();
    return merged;
  } catch (e) {
    console.warn("[store] drainPendingLogs failed", e);
    return 0;
  }
}

// ---- read helpers (non-hook) --------------------------------------------------------
export function getState(): State {
  return state;
}

export function getEntry(slotStart: number): Entry | undefined {
  return state.entries[String(slotStartFor(slotStart))];
}

// ---- React binding ------------------------------------------------------------------
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): State {
  return state;
}

/** Reactive hook — re-renders on any store change. */
export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
