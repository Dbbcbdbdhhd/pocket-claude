import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';

export function LikeButton({ liked, onToggle, size = 26, idleColor = colors.text }: { liked: boolean; onToggle: () => void; size?: number; idleColor?: string }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const press = () => {
    scale.value = withSequence(withTiming(0.7, { duration: 80 }), withSpring(1, { damping: 6, stiffness: 220 }));
    if (!liked) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle();
  };
  return (
    <Pressable onPress={press} hitSlop={8} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
      <Animated.View style={style}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={size} color={liked ? colors.like : idleColor} />
      </Animated.View>
    </Pressable>
  );
}
