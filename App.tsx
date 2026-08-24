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
  getState,
  hydrate,
  logEntry,
  useStore,
} from "./src/lib/store";
import {
  installNotificationHandler,
  parseResponse,
  reschedulePings,
  setupNotificationChannels,
} from "./src/lib/notifications";

installNotificationHandler();

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

  // Bootstrap once.
  useEffect(() => {
    (async () => {
      await hydrate();
      await setupNotificationChannels();
      const s = getState().settings;
      if (s.tracking) await reschedulePings(s);
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

  // Reschedule the rolling window whenever the app comes to the foreground.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active") {
        const s = getState().settings;
        if (s.tracking) reschedulePings(s);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

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
          <TodayScreen focusSlot={focusSlot} />
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
