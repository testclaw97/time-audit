// Forcing-function #1: you can't USE the app until it can do its job. On every open (and every
// return to foreground) we re-check the special-access permissions the popup needs — "display
// over other apps", exact alarms, and lock-screen/full-screen — and if any is missing we render a
// blocking wall instead of the app. Notifications + logging from OUTSIDE the app are unaffected;
// this only gates the in-app experience. On web/iOS (no native module) the wall is a no-op.
import React, { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import Card from "../ui/Card";
import FadeIn from "../ui/FadeIn";
import PressableScale from "../ui/PressableScale";
import TimePing, { isAvailable } from "../../modules/time-ping";

const OEM_BRANDS = /xiaomi|redmi|poco|samsung|oppo|realme|oneplus|vivo|huawei|honor/;

type Perms = { overlay: boolean; exact: boolean; fsi: boolean };

export default function PermissionWall({ children }: { children: React.ReactNode }) {
  // null = still checking (first paint); avoids a flash of the wall before the async check lands.
  const [perms, setPerms] = useState<Perms | null>(null);
  const [manufacturer, setManufacturer] = useState("");
  const isOem = OEM_BRANDS.test(manufacturer);
  const brand = manufacturer
    ? manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1)
    : "your phone";

  const check = useCallback(async () => {
    if (!isAvailable() || !TimePing) {
      // web / iOS: no special-access model — never block.
      setPerms({ overlay: true, exact: true, fsi: true });
      return;
    }
    try {
      const [overlay, exact, fsi] = await Promise.all([
        TimePing.hasOverlayPermission(),
        TimePing.hasExactAlarm(),
        TimePing.hasFullScreenIntent(),
      ]);
      setPerms({ overlay, exact, fsi });
    } catch {
      // Never trap the user behind a broken check — fail open.
      setPerms({ overlay: true, exact: true, fsi: true });
    }
  }, []);

  useEffect(() => {
    check();
    void (async () => {
      if (isAvailable() && TimePing) {
        try {
          setManufacturer((await TimePing.getManufacturer()) || "");
        } catch {
          /* ignore */
        }
      }
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const request = async (which: keyof Perms) => {
    if (!isAvailable() || !TimePing) return;
    try {
      if (which === "overlay") await TimePing.requestOverlayPermission();
      else if (which === "exact") await TimePing.requestExactAlarm();
      else await TimePing.requestFullScreenIntent();
    } catch {
      /* the grant lands in a system screen; AppState 'active' re-checks on return */
    }
    check();
  };

  const openOem = async () => {
    if (!isAvailable() || !TimePing) return;
    try {
      await TimePing.openOemAppPermissions();
    } catch {
      /* ignore */
    }
    check();
  };

  const insets = useSafeAreaInsets();

  // Still checking, or everything granted → render the app.
  if (!perms) return null;
  const allGranted = perms.overlay && perms.exact && perms.fsi;
  if (allGranted) return <>{children}</>;

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
        <Text style={styles.kicker}>ONE-TIME SETUP</Text>
        <Text style={[type.display, styles.title]}>
          Finish setting up{"\n"}Time Audit.
        </Text>
        <Text style={[type.body, styles.lead]}>
          Time Audit checks in with a full-screen popup — grant these so it can actually reach you.
          Until then the app stays locked.
        </Text>
      </FadeIn>

      <FadeIn delay={110}>
        <Card style={styles.permCard} tone="flat">
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
          <View style={styles.divider} />
          <PermRow
            title="Show over lock screen"
            note="Lets the check-in appear even when your phone is locked."
            granted={perms.fsi}
            onAllow={() => request("fsi")}
            testID="wall-fsi"
          />
        </Card>
      </FadeIn>

      {isOem ? (
        <FadeIn delay={170}>
          <Card tone="accent" style={styles.oemCard}>
            <Text style={styles.oemHeader}>ALSO ON {brand.toUpperCase()}</Text>
            <Text style={[type.caption, styles.oemBody]}>
              {brand} hides extra switches Android's permissions don't cover. Turn ON "Display
              pop-up while running in background", "Show on lock screen", and Autostart — or the
              popup gets silently blocked.
            </Text>
            <PressableScale
              onPress={openOem}
              accessibilityLabel={`Open ${brand} permissions`}
              style={styles.oemBtn}
              scaleTo={0.98}
            >
              <Text style={styles.oemBtnText}>Open {brand} permissions ›</Text>
            </PressableScale>
          </Card>
        </FadeIn>
      ) : null}

      <FadeIn delay={230}>
        <Text style={styles.footNote}>
          The app unlocks the moment these are on. Check-ins and one-tap logging from the
          notification keep working regardless.
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
  testID,
}: {
  title: string;
  note: string;
  granted: boolean;
  onAllow: () => void;
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
            accessibilityLabel={`Allow ${title}`}
            style={styles.allowBtn}
            testID={testID}
          >
            <Text style={styles.allowText}>Allow</Text>
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
