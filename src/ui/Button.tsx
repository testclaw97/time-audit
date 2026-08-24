// The primary/secondary button. Amber-filled primary for the one important action per
// screen; a bordered "ghost" for secondary. Built on PressableScale for tactile feedback.
import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { colors, radius, shadow, space, type } from "../theme";
import PressableScale from "./PressableScale";

export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  style,
  icon,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: string;
  testID?: string;
}) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.base,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
        variant === "primary" && !disabled && shadow.accent,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? (
          <Text
            style={[
              styles.icon,
              variant === "primary" ? styles.labelOnAccent : styles.labelFg,
            ]}
          >
            {icon}
          </Text>
        ) : null}
        <Text
          style={[
            type.subheading,
            variant === "primary" ? styles.labelOnAccent : styles.labelFg,
            variant === "danger" && styles.labelDanger,
          ]}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: space.s3,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  icon: { fontSize: 17, fontWeight: "800" },
  primary: { backgroundColor: colors.accent },
  ghost: {
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  disabled: { opacity: 0.4 },
  labelOnAccent: { color: colors.onAccent },
  labelFg: { color: colors.fg },
  labelDanger: { color: colors.danger },
});
