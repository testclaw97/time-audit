// A small floating "feedback" button pinned bottom-right, always visible over the tab screens.
// Tapping opens a quick menu: report a problem, suggest a feature, or share the app. Report/
// suggest open the mail app (prefilled with app + device context); share uses the OS share sheet.
// Local-only app, so feedback goes out via the user's own mail/share — no backend.
import React, { useState } from "react";
import { Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, type } from "../theme";
import PressableScale from "./PressableScale";

// Where "Report a problem" / "Suggest a feature" emails go. TJ: set this to your support inbox.
const FEEDBACK_EMAIL = "feedback@timeaudit.app";
const APP_VERSION = "1.0.0";

const SHARE_TEXT =
  "I'm auditing my time with Time Audit — every 15 minutes it asks what I'm doing, " +
  "then shows where my week actually went. You get ~1,000 fifteen-minute blocks a week. " +
  "Where do yours go?";

function deviceLine(): string {
  return `\n\n—\nTime Audit v${APP_VERSION} · ${Platform.OS} ${Platform.Version}`;
}

async function openMail(subject: string, body: string) {
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    /* fall through to share */
  }
  // No mail app — fall back to the share sheet so the feedback still has somewhere to go.
  try {
    await Share.share({ message: `${subject}\n\n${body}` });
  } catch {
    /* user cancelled */
  }
}

export default function FeedbackFab() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const report = () => {
    setOpen(false);
    void openMail(
      "Time Audit — problem report",
      `What went wrong?\n\n(Steps to reproduce, what you expected, what happened.)${deviceLine()}`,
    );
  };
  const suggest = () => {
    setOpen(false);
    void openMail(
      "Time Audit — feature idea",
      `My idea:\n\n${deviceLine()}`,
    );
  };
  const share = () => {
    setOpen(false);
    void Share.share({ message: SHARE_TEXT }).catch(() => {});
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityLabel="Feedback and sharing"
        accessibilityRole="button"
        style={[styles.fab, { bottom: insets.bottom + FAB_LIFT }]}
        scaleTo={0.9}
      >
        <Text style={styles.fabGlyph}>💬</Text>
      </PressableScale>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <View style={[styles.menu, { bottom: insets.bottom + FAB_LIFT + 56 }]}>
            <MenuItem emoji="🐞" label="Report a problem" onPress={report} />
            <View style={styles.divider} />
            <MenuItem emoji="💡" label="Suggest a feature" onPress={suggest} />
            <View style={styles.divider} />
            <MenuItem emoji="↗" label="Share Time Audit" onPress={share} />
          </View>
        </View>
      </Modal>
    </>
  );
}

// Height the FAB sits above the bottom inset — clears the ~68pt tab bar with margin.
const FAB_LIFT = 84;

function MenuItem({ emoji, label, onPress }: { emoji: string; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={styles.item} scaleTo={0.97}>
      <Text style={styles.itemEmoji}>{emoji}</Text>
      <Text style={[type.bodyStrong, styles.itemLabel]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: space.s3,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    // subtle lift off the content
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  fabGlyph: { fontSize: 22 },

  scrim: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  menu: {
    position: "absolute",
    right: space.s3,
    minWidth: 220,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingVertical: space.s0,
    ...(Platform.OS === "android" ? { elevation: 12 } : {}),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  item: { flexDirection: "row", alignItems: "center", gap: space.s2, paddingVertical: space.s2, paddingHorizontal: space.s3 },
  itemEmoji: { fontSize: 18, width: 22, textAlign: "center" },
  itemLabel: { color: colors.fg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: space.s2 },
});
