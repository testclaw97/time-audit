// The 15-minute pings — the heart of the app.
//
// RELIABILITY MODEL. Android aggressively throttles background JS, so we do NOT run a
// JS setInterval. Instead we hand the OS a batch of *scheduled* (calendar/date-triggered)
// notifications — these are AlarmManager-backed on Android and fire even when the app is
// killed. We schedule every in-window 15-minute boundary for the next ~24h, and we
// RE-SCHEDULE the rolling 24h window every time the app is opened/foregrounded. The
// pending queue is capped (iOS allows only 64 pending), which is why we can't schedule
// weeks ahead; the app-open reschedule keeps the window full. A device reboot clears the
// OS queue until the app is next opened — this is the known caveat of a no-backend design.
//
// DIRECT REPLY. We register a notification *category* with a textInput action, so the user
// can type 1–2 words on the notification and submit WITHOUT opening the app. The response
// listener (wired in App.tsx) reads `userText` + the slot stamped in the notification's
// data payload and writes it straight to the log.
//
// WEB. expo-notifications largely no-ops on web and some calls throw; every entry point
// guards on Platform.OS === "web" so the web export never crashes.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { Settings } from "./store";
import { SLOT_MS, upcomingPings } from "./time";
// The native full-screen chooser (Android). When it's present it is the SOLE ping source, so
// this expo-notifications path must never ALSO schedule — see the guard in reschedulePings.
import { isAvailable } from "../../modules/time-ping";

export const CATEGORY_ID = "time_audit_log";
export const ACTION_LOG = "LOG_TEXT";
export const CHANNEL_ID = "time-audit-pings";

const isWeb = Platform.OS === "web";

/** Foreground presentation: show the ping even while the app is open. */
export function installNotificationHandler(): void {
  if (isWeb) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** One-time setup: Android channel + the direct-reply category. Safe to call repeatedly. */
export async function setupNotificationChannels(): Promise<void> {
  if (isWeb) return;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "15-minute pings",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180],
        lightColor: "#f5a623",
        sound: "default",
      });
    }
    await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      {
        identifier: ACTION_LOG,
        buttonTitle: "Log it",
        textInput: {
          submitButtonTitle: "Save",
          placeholder: "e.g. email, lunch, scrolling…",
        },
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (e) {
    console.warn("[notifications] setup failed", e);
  }
}

export async function getPermissionStatus(): Promise<Notifications.PermissionStatus | "web"> {
  if (isWeb) return "web";
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/** Ask for notification permission. Returns true if granted. */
export async function requestPermission(): Promise<boolean> {
  if (isWeb) return false;
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    status = req.status;
  }
  return status === "granted";
}

/** Cancel every pending ping. */
export async function cancelAllPings(): Promise<void> {
  if (isWeb) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn("[notifications] cancel failed", e);
  }
}

/** Cancel + reschedule the rolling 24h window of in-window pings. Call on app open and
 *  whenever the awake window / tracking state changes. Returns how many were scheduled. */
export async function reschedulePings(settings: Settings): Promise<number> {
  if (isWeb) return 0;
  // Always clear any expo-scheduled pings first. This also neutralises pings left over from a
  // pre-native build after an upgrade, so they can't double up with the native chooser.
  await cancelAllPings();
  // On Android the NATIVE module owns pings (the full-screen chooser). Never ALSO schedule expo
  // notifications there or every slot fires twice. cancelAllPings above already cleared any
  // legacy/stray expo pings; we just don't schedule new ones. (App.tsx armPings enforces the
  // same branch; this source-level guard covers direct callers — onboarding, settings.)
  if (isAvailable()) return 0;
  if (!settings.tracking) return 0;

  const pings = upcomingPings(settings.wakeMinutes, settings.sleepMinutes, new Date(), 24, 60);
  let scheduled = 0;
  for (const fireDate of pings) {
    const slotStart = fireDate.getTime() - SLOT_MS; // the slot this ping asks about
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "What did you just do?",
          body: "Log the last 15 minutes.",
          categoryIdentifier: CATEGORY_ID,
          data: { slotStart, kind: "ping" },
          ...(Platform.OS === "ios" ? { interruptionLevel: "timeSensitive" as const } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
          ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
        },
      });
      scheduled++;
    } catch (e) {
      console.warn("[notifications] schedule failed for", fireDate, e);
    }
  }
  return scheduled;
}

export async function countScheduled(): Promise<number> {
  if (isWeb) return 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.length;
  } catch {
    return 0;
  }
}

/** Extract the slot + typed text from a notification response. Returns null if it's not a
 *  ping response we understand. `text` is undefined for a plain tap (opens the app). */
export function parseResponse(
  response: Notifications.NotificationResponse,
): { slotStart: number; text?: string } | null {
  const data = response.notification.request.content.data as
    | { slotStart?: number; kind?: string }
    | undefined;
  if (!data || data.kind !== "ping" || typeof data.slotStart !== "number") return null;
  const userText = (response as { userText?: string }).userText;
  if (response.actionIdentifier === ACTION_LOG) {
    return { slotStart: data.slotStart, text: userText ?? "" };
  }
  // DEFAULT_ACTION_IDENTIFIER — user tapped the body; open app to quick-entry for the slot.
  return { slotStart: data.slotStart };
}
