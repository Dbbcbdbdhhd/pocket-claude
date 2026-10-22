import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';
import { ClaudeAvatar } from './ClaudeAvatar';

function Dot({ delay }: { delay: number }) {
  const o = useSharedValue(0.35);
  useEffect(() => {
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.35, { duration: 380 })), -1));
  }, [o, delay]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

export function TypingBubble() {
  return (
    <View style={styles.row}>
      <ClaudeAvatar size={28} />
      <View style={styles.bubble}>
        <Dot delay={0} />
        <Dot delay={160} />
        <Dot delay={320} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 6 },
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bubble, borderRadius: 22, paddingHorizontal: 16, height: 40 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.textDim },
});
