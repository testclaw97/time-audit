// The in-app quick-entry. Primary path is now ONE-TAP category chips (emoji + label, tinted
// with the category color) laid out in a wrap grid — tap one to log the slot instantly. A
// small "Custom…" text field remains for anything that isn't a category. When the slot
// already has an entry we show it (its color + emoji) with a Clear affordance so a re-tap
// changes or clears it. On a custom submit it plays the satisfying "logged ✓" flash.
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
import type { Category } from "../lib/store";
import PressableScale from "./PressableScale";

/** "#f5a623" -> "rgba(245, 166, 35, a)". Falls back to the amber accent for a bad hex. */
function tint(hex: string, alpha: number): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return `rgba(245, 166, 35, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(245, 166, 35, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function QuickEntry({
  placeholder = "What are you doing right now?",
  onSubmit,
  autoFocus = false,
  categories,
  onPickCategory,
  current,
  onClear,
}: {
  placeholder?: string;
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
  /** Category chips to show as one-tap options above the custom field. */
  categories?: Category[];
  /** Called when a chip is tapped. Parent logs `logEntry(cat.label, slot, cat.id)`. */
  onPickCategory?: (cat: Category) => void;
  /** The slot's existing entry (if any) — shown as a banner with a Clear button. */
  current?: { label: string; category?: Category } | null;
  /** Clear the slot's entry. */
  onClear?: () => void;
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

  const pick = (cat: Category) => {
    onPickCategory?.(cat);
    flashLogged();
  };

  const activeId = current?.category?.id;

  return (
    <View style={styles.wrap}>
      {current ? (
        <View
          style={[
            styles.current,
            {
              backgroundColor: current.category
                ? tint(current.category.color, 0.14)
                : colors.surface2,
              borderColor: current.category
                ? tint(current.category.color, 0.5)
                : colors.line,
            },
          ]}
        >
          <View
            style={[
              styles.currentDot,
              { backgroundColor: current.category?.color ?? colors.teal },
            ]}
          />
          <Text style={[type.bodyStrong, styles.currentText]} numberOfLines={1}>
            {current.category?.emoji ? `${current.category.emoji} ` : ""}
            {current.label}
          </Text>
          {onClear ? (
            <PressableScale
              onPress={onClear}
              accessibilityLabel="Clear this slot"
              style={styles.clearBtn}
              hitSlop={8}
            >
              <Text style={styles.clearText}>Clear</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}

      {categories && categories.length > 0 ? (
        <View style={styles.chipGrid}>
          {categories.map((cat) => {
            const selected = cat.id === activeId;
            return (
              <PressableScale
                key={cat.id}
                onPress={() => pick(cat)}
                accessibilityLabel={`Log ${cat.label}`}
                accessibilityState={{ selected }}
                scaleTo={0.94}
                style={[
                  styles.chip,
                  {
                    backgroundColor: tint(cat.color, selected ? 0.26 : 0.13),
                    borderColor: tint(cat.color, selected ? 0.9 : 0.5),
                  },
                ]}
              >
                <Text style={styles.chipEmoji}>{cat.emoji}</Text>
                <Text style={[type.bodyStrong, styles.chipLabel]} numberOfLines={1}>
                  {cat.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      ) : null}

      {categories && categories.length > 0 ? (
        <Text style={[type.label, styles.customLabel]}>OR TYPE YOUR OWN</Text>
      ) : null}

      <View style={[styles.field, focused && styles.fieldFocused]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={
            categories && categories.length > 0 ? "Custom…" : placeholder
          }
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

  current: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1,
    marginBottom: space.s1,
  },
  currentDot: { width: 10, height: 10, borderRadius: 5 },
  currentText: { flex: 1, color: colors.fg },
  clearBtn: {
    paddingHorizontal: space.s1,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
  },
  clearText: { ...type.caption, color: colors.fg2, fontWeight: "700" },

  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.s1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s0 + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s2,
    paddingVertical: space.s1 + 2,
    minHeight: 44,
  },
  chipEmoji: { fontSize: 17 },
  chipLabel: { color: colors.fg },

  customLabel: { color: colors.muted, marginTop: space.s2, marginBottom: space.s1 },

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
