// JS entry for the local Expo module `time-ping`.
//
// This is the ONLY place JS reaches for the native Kotlin side. It resolves the native
// module registered as "TimePing" (see TimePingModule.kt's `Name("TimePing")`).
//
// `requireOptionalNativeModule` returns `null` — instead of throwing — when the native
// module isn't present. That is the normal case on **web and iOS**: this module ships
// Android code only, so on every other platform `TimePing` is null and callers fall back
// to the expo-notifications ping path (see src/lib/notifications.ts). That's why nothing
// here imports React Native's `Platform` — the null check IS the platform check, and it
// keeps the web bundle clean (the web build of expo-modules-core provides a stub that just
// returns null instead of touching any native code).
//
// Contract: when this module is present (an Android device/emulator build) it is the SOLE
// ping source — the JS layer must NOT also schedule expo-notification pings, or every slot
// would fire twice. `isAvailable()` is what the JS layer branches on to pick exactly one.
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * One selectable activity category, rendered as a chip on the full-screen chooser.
 * Kept byte-for-byte in sync with `Category` in src/lib/store.ts and with the native
 * seed in PingStore.kt (`DEFAULT_CATEGORIES` ids must match across all three).
 */
export interface PingCategory {
  /** Stable id, e.g. "work". This is what a PendingLog records, NOT the label. */
  id: string;
  /** Emoji shown big on the chip, e.g. "💼". */
  emoji: string;
  /** Human label, e.g. "Work". */
  label: string;
  /** Hex color "#f5a623" — the chip tint + timeline dot. */
  color: string;
}

/**
 * A slot the native chooser logged while the app was away (killed / backgrounded / phone
 * asleep). JS drains these on foreground and replays them into the entry store.
 *
 *  · `slotStart` — epoch ms of the slot the ping was ASKING about (fireTime - intervalMs).
 *    Carried on every alarm so a late tap still lands on the correct slot, never "now".
 *  · `category`  — a PingCategory.id, OR the sentinel "__other__" when the user tapped the
 *    "Other" chip (which opens the app for a custom typed label instead of storing a value).
 *  · `ts`        — epoch ms the tap actually happened (for ordering / audit).
 */
export interface PendingLog {
  slotStart: number;
  category: string;
  ts: number;
}

/** The exact surface implemented by TimePingModule.kt. Kept in lockstep with the Kotlin. */
export interface TimePingModule {
  /**
   * (Re)arm the rolling window of pings. Cancels any existing alarms first, then schedules
   * one exact alarm per in-window boundary for roughly the next 24h (capped ~60). Returns
   * the number of alarms actually scheduled. Each firing also chains the next boundary, so
   * the queue self-perpetuates beyond this initial batch and survives long idle stretches.
   */
  schedule(opts: {
    intervalMinutes: number;
    wakeMinutes: number;
    sleepMinutes: number;
    /** Epoch ms until which popups are snoozed. 0 / omitted = not paused. The scheduler skips
     *  boundaries before this instant and the receiver stays silent until it passes. */
    pausedUntilMs?: number;
  }): Promise<number>;
  /** Cancel every scheduled ping alarm (used when tracking is turned off). */
  cancelAll(): Promise<void>;
  /** Persist the category set the full-screen chooser renders. Call on any category edit. */
  setCategories(cats: PingCategory[]): Promise<void>;
  /** Logs the chooser recorded while the app was away — drained by JS on foreground. */
  getPendingLogs(): Promise<PendingLog[]>;
  /** Empty the pending-log queue after JS has merged it into the entry store. */
  clearPendingLogs(): Promise<void>;
  /** Fire the chooser NOW (Settings "Test the popup" + e2e). slotStart = now floored to interval. */
  triggerTestPing(): Promise<void>;
  /**
   * Is the persistent native ping engine (PingService, the always-on foreground service) currently
   * alive? True while tracking is on and the OS hasn't killed the process. Lets the app surface
   * engine health (e.g. a "tracking is running" indicator, or a nudge to grant battery exemption
   * if it keeps dying). Always false on web/iOS (no native module). Cheap — reads a static flag.
   */
  isEngineRunning(): Promise<boolean>;

  // --- special-access permission gates (each is a Settings bounce, never a runtime dialog) ---
  /** Android 12+: AlarmManager.canScheduleExactAlarms(); true on older OSes. */
  hasExactAlarm(): Promise<boolean>;
  /** Open ACTION_REQUEST_SCHEDULE_EXACT_ALARM (Android 12+); no-op on older OSes. */
  requestExactAlarm(): Promise<void>;
  /** Android 14+: NotificationManager.canUseFullScreenIntent(); true on older OSes. */
  hasFullScreenIntent(): Promise<boolean>;
  /** Open ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT (Android 14+); no-op on older OSes. */
  requestFullScreenIntent(): Promise<void>;
  /** "Display over other apps" (SYSTEM_ALERT_WINDOW) — the key grant for a full-screen chooser
   *  while the phone is unlocked/in use (lets the ping launch PingActivity from the background). */
  hasOverlayPermission(): Promise<boolean>;
  /** Open ACTION_MANAGE_OVERLAY_PERMISSION for our package. */
  requestOverlayPermission(): Promise<void>;
  /** PowerManager.isIgnoringBatteryOptimizations() for our package. */
  hasBatteryExemption(): Promise<boolean>;
  /** Open ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS for our package. */
  requestBatteryExemption(): Promise<void>;
}

// `null` on web / iOS (no native module registered), the real module on Android.
const Native = requireOptionalNativeModule<TimePingModule>("TimePing");

/** Whether the native Android full-screen pinger is actually present on this build. */
export function isAvailable(): boolean {
  return Native != null;
}

export default Native;
