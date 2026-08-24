// Awake-window time field. On iOS/Android it opens the native clock picker
// (@react-native-community/datetimepicker); on web (where that picker is unreliable) it
// falls back to tidy −/＋ 15-minute steppers, so the web export never breaks.
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { colors, radius, space, type } from "../theme";
import { dateFromMinutes, formatClockMinutes, minutesFromDate } from "../lib/time";
import PressableScale from "./PressableScale";

export default function TimeField({
  label,
  minutes,
  onChange,
  icon,
}: {
  label: string;
  minutes: number;
  onChange: (mins: number) => void;
  icon?: string;
}) {
  const [show, setShow] = useState(false);
  const isWeb = Platform.OS === "web";

  const step = (delta: number) => {
    let next = (minutes + delta) % (24 * 60);
    if (next < 0) next += 24 * 60;
    onChange(next);
  };

  const onPicked = (event: DateTimePickerEvent, date?: Date) => {
    // Android returns a one-shot event; hide immediately.
    if (Platform.OS === "android") setShow(false);
    if (event.type === "set" && date) onChange(minutesFromDate(date));
  };

  return (
    <View style={styles.row}>
      <View style={styles.labelWrap}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={[type.bodyStrong, styles.label]}>{label}</Text>
      </View>

      {isWeb ? (
        <View style={styles.stepper}>
          <PressableScale
            onPress={() => step(-15)}
            accessibilityLabel={`${label} minus 15 minutes`}
            style={styles.stepBtn}
          >
            <Text style={styles.stepSign}>−</Text>
          </PressableScale>
          <Text style={[type.mono, styles.value]}>{formatClockMinutes(minutes)}</Text>
          <PressableScale
            onPress={() => step(15)}
            accessibilityLabel={`${label} plus 15 minutes`}
            style={styles.stepBtn}
          >
            <Text style={styles.stepSign}>＋</Text>
          </PressableScale>
        </View>
      ) : (
        <PressableScale
          onPress={() => setShow(true)}
          accessibilityLabel={`Change ${label}`}
          style={styles.chip}
        >
          <Text style={[type.mono, styles.value]}>{formatClockMinutes(minutes)}</Text>
        </PressableScale>
      )}

      {show && !isWeb ? (
        <DateTimePicker
          value={dateFromMinutes(minutes)}
          mode="time"
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          onChange={onPicked}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.s0,
  },
  labelWrap: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  icon: { fontSize: 16 },
  label: { color: colors.fg2 },
  chip: {
    backgroundColor: colors.surface3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    minWidth: 84,
    alignItems: "center",
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.s1 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  stepSign: { color: colors.fg, fontSize: 18, fontWeight: "800" },
  value: {
    color: colors.fg,
    minWidth: 58,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
