// A pressable with tactile feedback — a gentle scale-down + dim on press-in, springing
// back on release. Pure react-native Animated (native driver, transform/opacity only), so
// it renders identically on web and native without extra deps.
import React, { useRef } from "react";
import {
  AccessibilityRole,
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from "react-native";

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean };
  testID?: string;
  hitSlop?: number;
}

export default function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.96,
  accessibilityRole = "button",
  accessibilityLabel,
  accessibilityState,
  testID,
  hitSlop,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // The visual `style` lives on the inner Animated.View (so the whole thing scales on press).
  // But flex/size props must ALSO be on the OUTER Pressable, or a `flex: 1` PressableScale won't
  // actually take its share of a flex row/column (it shrinks to content). Forward just those.
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const outerLayout: ViewStyle = {};
  if (flat.flex !== undefined) outerLayout.flex = flat.flex;
  if (flat.flexGrow !== undefined) outerLayout.flexGrow = flat.flexGrow;
  if (flat.flexShrink !== undefined) outerLayout.flexShrink = flat.flexShrink;
  if (flat.flexBasis !== undefined) outerLayout.flexBasis = flat.flexBasis;
  if (flat.alignSelf !== undefined) outerLayout.alignSelf = flat.alignSelf;
  if (flat.width !== undefined) outerLayout.width = flat.width;

  const animate = (toScale: number, toOpacity: number) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: toScale,
        useNativeDriver: true,
        speed: 40,
        bounciness: 0,
      }),
      Animated.timing(opacity, {
        toValue: toOpacity,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => animate(scaleTo, 0.85)}
      onPressOut={() => animate(1, 1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      hitSlop={hitSlop}
      style={outerLayout}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
