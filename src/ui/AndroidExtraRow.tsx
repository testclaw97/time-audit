// An OPTIONAL Android reliability switch the app can't read programmatically (autostart, the
// background-popup op). We can't verify it, so the user marks it done after enabling — that gives
// an honest "Granted ✓ (optional)" state. Deliberately says "Android", never a brand name, because
// these live under different menus per skin but are the same Android concept.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, space, type } from "../theme";
import PressableScale from "./PressableScale";

export default function AndroidExtraRow({
  title,
  note,
  done,
  onOpen,
  onToggleDone,
  testID,
}: {
  title: string;
  note: string;
  done: boolean;
  /** Opens the relevant Android settings screen. */
  onOpen: () => void;
  /** Flips the user-confirmed "done" flag (persisted by the parent). */
  onToggleDone: () => void;
  testID?: string;
}) {
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[type.bodyStrong, styles.title]}>{title}</Text>
          <Text style={[type.caption, styles.note]}>{note}</Text>
        </View>
        {done ? (
          <PressableScale
            onPress={onToggleDone}
            accessibilityLabel={`${title} marked done — tap to undo`}
            style={styles.grantedPill}
            scaleTo={0.94}
          >
            <Text style={styles.grantedText}>Granted ✓</Text>
          </PressableScale>
        ) : (
          <PressableScale
            onPress={onOpen}
            accessibilityLabel={`Open ${title} settings`}
            style={styles.openBtn}
            testID={testID}
            scaleTo={0.94}
          >
            <Text style={styles.openText}>Open</Text>
          </PressableScale>
        )}
      </View>
      {!done ? (
        <PressableScale
          onPress={onToggleDone}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={`Mark ${title} as done`}
          style={styles.confirmRow}
        >
          <View style={styles.checkbox} />
          <Text style={styles.confirmText}>I turned this on (optional)</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: { flex: 1, paddingRight: space.s2 },
  title: { color: colors.fg },
  note: { color: colors.muted, marginTop: 2 },
  openBtn: {
    paddingHorizontal: space.s2,
    paddingVertical: space.s0 + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  openText: { color: colors.fg2, fontWeight: "800", fontSize: 13 },
  grantedPill: {
    paddingHorizontal: space.s1 + 2,
    paddingVertical: space.s0 + 1,
    borderRadius: radius.pill,
  },
  grantedText: { color: colors.teal, fontWeight: "700", fontSize: 13 },
  confirmRow: { flexDirection: "row", alignItems: "center", gap: space.s1, marginTop: space.s1 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface2,
  },
  confirmText: { ...type.caption, color: colors.fg2, fontWeight: "600" },
});
