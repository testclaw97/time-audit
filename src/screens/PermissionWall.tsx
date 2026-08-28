// Forcing-function #1: you can't USE the app until it can do its job. On every open (and every
// return to foreground) we re-check the special-access permissions the popup needs — "display
// over other apps", exact alarms, and lock-screen/full-screen — and if any is missing we render a
// blocking wall instead of the app. Notifications + logging from OUTSIDE the app are unaffected;
// this only gates the in-app experience. On web/iOS (no native module) the wall is a no-op.
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import PressableScale from "../ui/PressableScale";
import TimePing, { isAvailable } from "../../modules/time-ping";
import { getNotifPermission, requestPermission } from "../lib/notifications";

// The REQUIRED set — the app can't do its job without these, and they're all OS-verifiable, so we
// re-check them on every foreground and re-prompt the moment one is turned off. (FSI / battery /
// autostart / background-popup are OPTIONAL and live in onboarding + Settings, so they never block.)
type Perms = { notifications: boolean; overlay: boolean; exact: boolean };
type Which = keyof Perms;

export default function PermissionWall({ children }: { children: React.ReactNode }) {
  // null = still checking (first paint); avoids a flash of the wall before the async check lands.
  const [perms, setPerms] = useState<Perms | null>(null);
  const [notifCanAskAgain, setNotifCanAskAgain] = useState(true);

  const check = useCallback(async () => {
    // Notifications works on every platform (expo-notifications); the rest are native-only.
    let notifications = true;
    try {
      const r = await getNotifPermission();
      notifications = r.granted;
      setNotifCanAskAgain(r.canAskAgain);
    } catch {
      notifications = true; // never trap on a broken check
    }
    if (!isAvailable() || !TimePing) {
      setPerms({ notifications, overlay: true, exact: true });
      return;
    }
    try {
      const [overlay, exact] = await Promise.all([
        TimePing.hasOverlayPermission(),
        TimePing.hasExactAlarm(),
      ]);
      setPerms({ notifications, overlay, exact });
    } catch {
      setPerms({ notifications, overlay: true, exact: true });
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const request = async (which: Which) => {
    try {
      if (which === "notifications") {
        if (notifCanAskAgain) await requestPermission();
        else await Linking.openSettings();
      } else if (isAvailable() && TimePing) {
        if (which === "overlay") await TimePing.requestOverlayPermission();
        else await TimePing.requestExactAlarm();
      }
    } catch {
      /* the grant lands in a system screen; AppState 'active' re-checks on return */
    }
    check();
  };

  const insets = useSafeAreaInsets();

  // Still checking, or everything granted → render the app.
  if (!perms) return null;
  const allGranted = perms.notifications && perms.overlay && perms.exact;
  if (allGranted) return <>{children}</>;

  // Some-but-not-all missing reads as a revocation ("turned off"); all missing reads as fresh setup.
  const missingCount = [perms.notifications, perms.overlay, perms.exact].filter((x) => !x).length;
  const oneMissing = missingCount > 0 && missingCount < 3;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.s5, paddingBottom: insets.bottom + space.s4 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <FadeIn>
        <Text style={styles.kicker}>{oneMissing ? "PERMISSION TURNED OFF" : "PERMISSIONS NEEDED"}</Text>
        <Text style={[type.display, styles.title]}>
          {oneMissing ? "Time Audit is\npaused." : "Time Audit is\nlocked."}
        </Text>
        <Text style={[type.body, styles.lead]}>
          {oneMissing
            ? "A permission Time Audit needs was turned off, so it can't reach you. Switch it back on to keep going."
            : "Time Audit can't run until these are on. Grant them to unlock the app."}
        </Text>
      </FadeIn>

      <FadeIn delay={110}>
        <Card style={styles.permCard} tone="flat">
          <PermRow
            title="Notifications"
            note="The check-in itself — how Time Audit reaches you every interval."
            granted={perms.notifications}
            onAllow={() => request("notifications")}
            actionLabel={notifCanAskAgain ? "Allow" : "Open settings"}
            testID="wall-notifications"
          />
          <View style={styles.divider} />
          <PermRow
            title="Display over other apps"
            note="Lets the check-in cover your screen while you're using the phone."
            granted={perms.overlay}
            onAllow={() => request("overlay")}
            testID="wall-overlay"
          />
          <View style={styles.divider} />
          <PermRow
            title="Exact alarms"
            note="Fires the check-in right on time, not whenever Android feels like it."
            granted={perms.exact}
            onAllow={() => request("exact")}
            testID="wall-exact"
          />
        </Card>
      </FadeIn>

      <FadeIn delay={230}>
        <Text style={styles.footNote}>
          The app unlocks the moment these are on. More reliability options (battery, autostart,
          lock-screen popup) live in Settings.
        </Text>
      </FadeIn>
    </ScrollView>
  );
}

function PermRow({
  title,
  note,
  granted,
  onAllow,
  actionLabel = "Allow",
  testID,
}: {
  title: string;
  note: string;
  granted: boolean;
  onAllow: () => void;
  actionLabel?: string;
  testID?: string;
}) {
  return (
    <View>
      <View style={styles.permRow}>
        <Text style={[type.bodyStrong, styles.permTitle]}>{title}</Text>
        {granted ? (
          <Text style={[type.caption, styles.permGranted]}>Granted ✓</Text>
        ) : (
          <PressableScale
            onPress={onAllow}
            accessibilityLabel={`${actionLabel} ${title}`}
            style={styles.allowBtn}
            testID={testID}
          >
            <Text style={styles.allowText}>{actionLabel}</Text>
          </PressableScale>
        )}
      </View>
      <Text style={[type.caption, styles.permNote]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.s3, gap: space.s2 },
  kicker: { ...type.label, color: colors.accent, marginBottom: space.s1 },
  title: { color: colors.fg, marginBottom: space.s2 },
  lead: { color: colors.fg2 },

  permCard: { gap: space.s1, marginTop: space.s1 },
  permRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  permTitle: { color: colors.fg, flex: 1, paddingRight: space.s2 },
  permNote: { color: colors.muted, marginTop: 2 },
  permGranted: { color: colors.teal, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.s1 },
  allowBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s0 + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
  },
  allowText: { color: colors.accent, fontWeight: "800", fontSize: 13 },

  oemCard: { gap: space.s1, marginTop: space.s1 },
  oemHeader: { ...type.label, color: colors.accent },
  oemBody: { color: colors.fg2 },
  oemBtn: {
    marginTop: space.s0,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentLine,
    backgroundColor: colors.surface2,
    paddingVertical: space.s1 + 2,
    paddingHorizontal: space.s2,
    alignItems: "center",
  },
  oemBtnText: { color: colors.accent, fontWeight: "800", fontSize: 14 },

  footNote: { ...type.caption, color: colors.muted, textAlign: "center", marginTop: space.s2 },
});
