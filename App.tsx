// App root: bootstrap (hydrate store + notification setup), the notification response
// wiring (direct-reply saves to the log; a tap opens Today to the slot), a foreground
// reschedule, and a lightweight custom bottom-tab nav (Today · Insights · Settings).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

import { colors, radius, space, type } from "./src/theme";
import PressableScale from "./src/ui/PressableScale";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import TodayScreen from "./src/screens/TodayScreen";
import CategoriesScreen from "./src/screens/CategoriesScreen";
import InsightsScreen from "./src/screens/InsightsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import PermissionWall from "./src/screens/PermissionWall";
import CatchUpModal from "./src/screens/CatchUpModal";
import FeedbackFab from "./src/ui/FeedbackFab";
import {
  drainPendingLogs,
  getState,
  hydrate,
  logEntry,
  syncCategoriesToNative,
  useStore,
  type Settings,
} from "./src/lib/store";
import { trailingGapSlots } from "./src/lib/insights";
import {
  installNotificationHandler,
  parseResponse,
  reschedulePings,
  setupNotificationChannels,
} from "./src/lib/notifications";
// The native full-screen category chooser (Android only). `isAvailable()` is false on web/iOS
// where `TimePing` is null, so every native call is guarded on it (see armPings below).
import TimePing, { isAvailable } from "./modules/time-ping";

installNotificationHandler();

// Arm (or disarm) the pings for the current settings — the SINGLE source of ping truth,
// called on cold start, on foreground, and whenever the ping settings change.
//
// On Android the NATIVE full-screen chooser owns pings: sync the category set, drain any slots
// the chooser logged while the app was away, then schedule (tracking on) or cancel (tracking
// off). On web/iOS the native module is absent, so we fall back to the expo-notifications
// scheduler. We branch on `isAvailable()` and run EXACTLY ONE path — never both — so Android
// can't fire the native chooser AND an expo-notification ping for the same slot (double popup).
// All native calls are guarded + try/caught so web/iOS can never crash here.
async function armPings(s: Settings): Promise<void> {
  if (isAvailable() && TimePing) {
    try {
      await syncCategoriesToNative();
      await drainPendingLogs();
      if (s.tracking) {
        await TimePing.schedule({
          intervalMinutes: s.intervalMinutes,
          wakeMinutes: s.wakeMinutes,
          sleepMinutes: s.sleepMinutes,
          // Snooze: the scheduler skips boundaries before this instant and the receiver stays
          // silent until it passes, so pausing popups needs no separate native call.
          pausedUntilMs: s.pausedUntil,
          // Whether the full-screen chooser is allowed over the LOCK SCREEN (optional toggle); when
          // off, a locked-screen ping stays a notification and the chooser waits until the phone's in use.
          lockScreenPopup: s.lockScreenPopup,
          // Hardcore (opt-in): block the phone with the chooser on unlock until answered.
          hardcoreMode: s.hardcoreMode,
        });
      } else {
        await TimePing.cancelAll();
      }
    } catch (e) {
      console.warn("[app] native ping arm failed", e);
    }
    return;
  }
  // web / iOS: expo-notifications fallback. reschedulePings cancels first and no-ops when
  // tracking is off, so it's safe (and idempotent) to call unconditionally.
  await reschedulePings(s);
}

// Consume any "Other" focus slot the native chooser stashed: when the user taps "Other" on the
// full-screen popup (locked or in-use), native opens the app and stows the slot; we read-and-clear
// it here so Today can open quick-entry for exactly that slot. Returns the slotStart, or null when
// there's nothing pending / on web/iOS. Guarded so it can never crash bootstrap or a foreground.
async function consumeLaunchSlot(): Promise<number | null> {
  if (!isAvailable() || !TimePing) return null;
  try {
    const slot = await TimePing.consumeLaunchSlot();
    return typeof slot === "number" && slot > 0 ? slot : null;
  } catch (e) {
    console.warn("[app] consumeLaunchSlot failed", e);
    return null;
  }
}

// Four tabs — Today (the truth), Categories (edit the answers), Insights (trends + share), and
// Settings. Everything is one tap from the bottom bar; the Today header still has a gear as a
// shortcut too.
type Tab = "today" | "categories" | "insights" | "settings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "🏠" },
  { key: "categories", label: "Categories", icon: "🏷️" },
  { key: "insights", label: "Insights", icon: "📊" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

function Root() {
  const insets = useSafeAreaInsets();
  const { ready, settings } = useStore();
  const [tab, setTab] = useState<Tab>("today");
  const [focusSlot, setFocusSlot] = useState<number | null>(null);
  // Forcing-function #2: a snapshot of the "you've been away" gap that must be filled before the
  // app is usable. Captured on open/foreground; cleared once every block in it is logged. Held as a
  // stable snapshot so filling blocks out of order can't shrink the run and let you slip past.
  const [forcedGap, setForcedGap] = useState<number[] | null>(null);
  const seededRef = useRef(false);

  // Re-evaluate the on-open catch-up wall: if we're not already showing one and there's a run of
  // ≥2 unlogged blocks trailing to now, snapshot it and force it. Called on mount + every foreground.
  const evaluateCatchUp = useCallback(() => {
    setForcedGap((cur) => {
      if (cur != null) return cur; // already forcing — don't recompute mid-fill
      const s = getState().settings;
      const g = trailingGapSlots(
        getState().entries,
        s.wakeMinutes,
        s.sleepMinutes,
        s.trackingStartedAt,
      );
      return g.length >= 2 ? g : null;
    });
  }, []);

  // Bootstrap once: load state, set up notification channels, then arm the pings via the
  // native-first path (armPings picks native chooser vs expo-notifications by isAvailable()).
  useEffect(() => {
    (async () => {
      await hydrate();
      await setupNotificationChannels();
      await armPings(getState().settings);
      evaluateCatchUp();
      // If the app was cold-started by an "Other" tap on the popup, land on that slot's entry.
      const slot = await consumeLaunchSlot();
      if (slot != null) {
        setFocusSlot(slot);
        setTab("today");
      }
    })();
  }, [evaluateCatchUp]);

  // Handle a direct-reply / tap from a notification.
  const handleResponse = useCallback((response: Notifications.NotificationResponse) => {
    const parsed = parseResponse(response);
    if (!parsed) return;
    if (typeof parsed.text === "string") {
      // Direct reply — save silently to the slot's log.
      if (parsed.text.trim().length > 0) logEntry(parsed.text, parsed.slotStart);
      else {
        setFocusSlot(parsed.slotStart);
        setTab("today");
      }
    } else {
      // Plain tap — open Today focused on the slot.
      setFocusSlot(parsed.slotStart);
      setTab("today");
    }
  }, []);

  useEffect(() => {
    let sub: Notifications.Subscription | undefined;
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) handleResponse(last);
      } catch {
        /* web / no-op */
      }
      sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    })();
    return () => sub?.remove();
  }, [handleResponse]);

  // On foreground: drain anything the native chooser logged while away and re-arm the rolling
  // window. armPings handles the native (drain + schedule/cancel) vs expo (reschedule) branch.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active") {
        void armPings(getState().settings);
        evaluateCatchUp();
        // An "Other" tap that opened the app while it was already running lands here — focus the slot.
        void (async () => {
          const slot = await consumeLaunchSlot();
          if (slot != null) {
            setFocusSlot(slot);
            setTab("today");
          }
        })();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [evaluateCatchUp]);

  // Re-arm whenever the ping settings change (interval / awake window / tracking toggle).
  // Deps are the raw values from useStore() so the effect fires on any of them. armPings is
  // idempotent (native schedule cancels+reschedules, cancelAll off; expo reschedulePings the
  // same), so a redundant run is harmless. Gated on `ready` so we don't arm the DEFAULT_SETTINGS
  // before hydrate has loaded the persisted ones.
  useEffect(() => {
    if (!ready) return;
    void armPings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    settings.intervalMinutes,
    settings.wakeMinutes,
    settings.sleepMinutes,
    settings.tracking,
    settings.pausedUntil, // pausing/resuming popups re-arms the schedule
    settings.lockScreenPopup, // toggling lock-screen popup re-arms with the new flag
    settings.hardcoreMode, // toggling hardcore re-arms so the native flag updates
  ]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!settings.onboarded) {
    return (
      <OnboardingScreen
        onDone={() => {
          setTab("today");
        }}
      />
    );
  }

  return (
    <PermissionWall>
      <View style={styles.appRoot}>
        <View style={styles.screen}>
          {tab === "today" ? (
            <TodayScreen
              focusSlot={focusSlot}
              onOpenSettings={() => setTab("settings")}
              onRequestCatchUp={evaluateCatchUp}
            />
          ) : tab === "categories" ? (
            <CategoriesScreen />
          ) : tab === "insights" ? (
            <InsightsScreen onOpenSettings={() => setTab("settings")} />
          ) : (
            <SettingsScreen
              onReset={() => {
                setFocusSlot(null);
                setTab("today");
              }}
              onGoHome={() => setTab("today")}
              onRequestCatchUp={evaluateCatchUp}
            />
          )}
        </View>

        <View style={[styles.tabbar, { paddingBottom: insets.bottom + space.s1 }]}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <PressableScale
                key={t.key}
                onPress={() => {
                  if (t.key === "today") setFocusSlot(null);
                  setTab(t.key);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
                style={styles.tab}
                scaleTo={0.9}
              >
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              </PressableScale>
            );
          })}
        </View>

        {/* Always-on feedback / share button, bottom-right over the tab screens. */}
        <FeedbackFab />

        {/* Forcing-function #2: the on-open catch-up wall — can't be dismissed until the whole
            "you've been away" run is logged. Cleared once every block in the snapshot is filled. */}
        <CatchUpModal
          visible={forcedGap != null}
          slots={forcedGap ?? []}
          mandatory
          onClose={() => setForcedGap(null)}
        />
      </View>
    </PermissionWall>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  appRoot: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  tabbar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
    paddingTop: space.s1,
    paddingHorizontal: space.s2,
    ...(Platform.OS === "web" ? { maxWidth: 480, width: "100%", alignSelf: "center" } : {}),
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: space.s1,
  },
  tabIcon: { fontSize: 22, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
  tabLabel: { ...type.caption, fontSize: 11, color: colors.faint, fontWeight: "700" },
  tabLabelActive: { color: colors.accent },
});
