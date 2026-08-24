// The in-app quick-entry: "What are you doing right now?" A rounded input + amber send
// button. On submit it plays a satisfying "logged ✓" flash — the one delightful
// micro-interaction — then clears. Reused on Today and (in compact form) elsewhere.
import React, { useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radius, space, type } from "../theme";
import PressableScale from "./PressableScale";

export default function QuickEntry({
  placeholder = "What are you doing right now?",
  onSubmit,
  autoFocus = false,
}: {
  placeholder?: string;
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const check = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  const flashLogged = () => {
    check.setValue(0);
    Animated.sequence([
      Animated.timing(check, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.delay(650),
      Animated.timing(check, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    onSubmit(clean);
    setText("");
    flashLogged();
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          style={[type.body, styles.input]}
          returnKeyType="done"
          onSubmitEditing={submit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          maxLength={40}
        />
        <PressableScale
          onPress={submit}
          disabled={!text.trim()}
          accessibilityLabel="Log entry"
          style={[styles.send, !text.trim() && styles.sendDisabled]}
        >
          <Text style={styles.sendIcon}>↑</Text>
        </PressableScale>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.toast,
          {
            opacity: check,
            transform: [
              { scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
            ],
          },
        ]}
      >
        <Text style={styles.toastText}>Logged ✓</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingLeft: space.s2,
    paddingRight: space.s0 + 2,
    paddingVertical: space.s0 + 2,
  },
  fieldFocused: { borderColor: colors.accentLine, backgroundColor: colors.surface3 },
  input: { flex: 1, color: colors.fg, paddingVertical: 8 },
  send: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: colors.surface3 },
  sendIcon: { color: colors.onAccent, fontSize: 20, fontWeight: "800", marginTop: -2 },
  toast: {
    position: "absolute",
    top: -46,
    alignSelf: "center",
    backgroundColor: colors.teal,
    paddingHorizontal: space.s2,
    paddingVertical: space.s0 + 2,
    borderRadius: radius.pill,
  },
  toastText: { color: colors.onTeal, fontWeight: "800", fontSize: 14 },
});
