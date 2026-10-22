import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, ring as ringColors } from '../theme';

const RING = 2;
const GAP = 3;

export function Avatar({
  uri,
  size,
  ring,
  style,
}: {
  uri: string;
  size: number;
  ring?: 'unseen' | 'seen';
  style?: StyleProp<ViewStyle>;
}) {
  const image = <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceHi }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} />;
  if (!ring) return <View style={style}>{image}</View>;
  const outer = size + 2 * (RING + GAP);
  const inner = size + 2 * GAP;
  return (
    <View style={[{ width: outer, height: outer }, style]}>
      {ring === 'unseen' ? (
        <LinearGradient colors={ringColors} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[styles.fill, { borderRadius: outer / 2 }]} />
      ) : (
        <View style={[styles.fill, { borderRadius: outer / 2, backgroundColor: colors.borderHi }]} />
      )}
      <View style={[styles.gap, { width: inner, height: inner, borderRadius: inner / 2, top: RING, left: RING }]} />
      <View style={[styles.gap, { top: RING + GAP, left: RING + GAP, width: size, height: size, backgroundColor: 'transparent' }]}>{image}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
  gap: { position: 'absolute', backgroundColor: colors.bg },
});
