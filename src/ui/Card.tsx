// The one card surface — a rounded, hairline-bordered panel with optional soft depth and
// tinted variants. Consistent radius + border + padding everywhere, so every screen reads
// as the same material.
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { colors, radius, shadow, space } from "../theme";

export default function Card({
  children,
  style,
  tone = "surface",
  raised = false,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "surface" | "accent" | "teal" | "flat";
  raised?: boolean;
  padded?: boolean;
}) {
  return (
    <View
      style={[
        styles.base,
        padded && styles.padded,
        tone === "accent" && styles.accent,
        tone === "teal" && styles.teal,
        tone === "flat" && styles.flat,
        raised && shadow.soft,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  padded: { padding: space.s2 },
  accent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentLine,
  },
  teal: {
    backgroundColor: colors.tealSoft,
    borderColor: colors.tealLine,
  },
  flat: {
    backgroundColor: colors.surface2,
    borderColor: colors.line,
  },
});
