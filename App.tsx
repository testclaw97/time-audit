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
import InsightsScreen from "./src/screens/InsightsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import {
  drainPendingLogs,
  getState,
  hydrate,
  logEntry,
  syncCategoriesToNative,
  useStore,
  type Settings,
} from "./src/lib/store";
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

type Tab = "today" | "insights" | "settings";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "◷" },
  { key: "insights", label: "Insights", icon: "▟" },
  { key: "settings", label: "Settings", icon: "⚙" },
];

function Root() {
  const insets = useSafeAreaInsets();
  const { ready, settings } = useStore();
  const [tab, setTab] = useState<Tab>("today");
  const [focusSlot, setFocusSlot] = useState<number | null>(null);
  const seededRef = useRef(false);

  // Bootstrap once: load state, set up notification channels, then arm the pings via the
  // native-first path (armPings picks native chooser vs expo-notifications by isAvailable()).
  useEffect(() => {
    (async () => {
      await hydrate();
      await setupNotificationChannels();
      await armPings(getState().settings);
    })();
  }, []);

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
      if (next === "active") void armPings(getState().settings);
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

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
    <View style={styles.appRoot}>
      <View style={styles.screen}>
        {tab === "today" ? (
          <TodayScreen focusSlot={focusSlot} onManageCategories={() => setTab("settings")} />
        ) : tab === "insights" ? (
          <InsightsScreen />
        ) : (
          <SettingsScreen onReset={() => setTab("today")} />
        )}
      </View>

      <View style={[styles.tabbar, { paddingBottom: insets.bottom + space.s0 }]}>
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
    </View>
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
    backgroundColor: colors.bgSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: space.s1,
    paddingHorizontal: space.s2,
    ...(Platform.OS === "web" ? { maxWidth: 480, width: "100%", alignSelf: "center" } : {}),
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: space.s0 },
  tabIcon: { fontSize: 20, color: colors.faint },
  tabIconActive: { color: colors.accent },
  tabLabel: { ...type.caption, fontSize: 11, color: colors.faint, fontWeight: "700" },
  tabLabelActive: { color: colors.fg },
});
