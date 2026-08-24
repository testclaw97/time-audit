// Local-only persistence + a tiny reactive store. Everything lives on-device in
// AsyncStorage — no backend, no login, no network. Screens subscribe via useStore() and
// re-render when the log or settings change (e.g. after a notification direct-reply saves
// an entry).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { slotStartFor } from "./time";

const K_SETTINGS = "ta:settings:v1";
const K_ENTRIES = "ta:entries:v1";

export interface Settings {
  onboarded: boolean;
  tracking: boolean;
  wakeMinutes: number; // minutes since midnight, e.g. 7*60 = 420
  sleepMinutes: number; // e.g. 23*60 = 1380
}

export interface Entry {
  text: string; // raw label as typed
  ts: number; // when it was logged (epoch ms)
}

// entries keyed by slot-start epoch (as string, since JSON object keys are strings)
export type Entries = Record<string, Entry>;

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  tracking: false,
  wakeMinutes: 7 * 60,
  sleepMinutes: 23 * 60,
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
    const entries = rawE ? (JSON.parse(rawE) as Entries) : {};
    setState({ ready: true, settings, entries });
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
  setState({ settings: next });
  await persistSettings(next);
  return next;
}

/** Log an activity for the slot containing `slotStart` (defaults to now's slot). Passing
 *  an empty string clears the slot. Returns the updated entries. */
export async function logEntry(
  text: string,
  slotStart: number = slotStartFor(Date.now()),
): Promise<Entries> {
  const key = String(slotStartFor(slotStart));
  const next: Entries = { ...state.entries };
  const clean = text.trim();
  if (clean.length === 0) {
    delete next[key];
  } else {
    next[key] = { text: clean, ts: Date.now() };
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
  await Promise.all([persistEntries({}), persistSettings(DEFAULT_SETTINGS)]);
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
