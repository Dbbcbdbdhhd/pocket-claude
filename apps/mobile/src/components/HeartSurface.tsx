import { Ionicons } from '@expo/vector-icons';
import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';

const DOUBLE_TAP_MS = 280;

export function HeartSurface({
  onDoubleTap,
  onSingleTap,
  children,
}: {
  onDoubleTap: () => void;
  onSingleTap?: () => void;
  children: ReactNode;
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const lastTap = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const burst = () => {
    scale.value = 0.2;
    scale.value = withSpring(1, { damping: 7, stiffness: 180 });
    opacity.value = withSequence(withTiming(1, { duration: 60 }), withDelay(480, withTiming(0, { duration: 220 })));
  };

  const press = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      burst();
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (onSingleTap) {
      timer.current = setTimeout(() => {
        timer.current = null;
        onSingleTap();
      }, DOUBLE_TAP_MS);
    }
  };

  const heart = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  return (
    <Pressable onPress={press} style={styles.root}>
      {children}
      <View pointerEvents="none" style={styles.center}>
        <Animated.View style={heart}>
          <Ionicons name="heart" size={104} color="#FFFFFF" style={styles.shadow} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12 },
});
