import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Tile } from '../content/fake';
import { colors } from '../theme';

function GridTileImpl({ tile, style, icon }: { tile: Tile; style: StyleProp<ViewStyle>; icon?: 'albums' | 'play' }) {
  const badge = icon ?? (tile.kind === 'video' ? 'play' : undefined);
  return (
    <View style={[style, styles.tile]}>
      <Image source={{ uri: tile.uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={tile.uri} transition={120} />
      {badge ? <Ionicons name={badge === 'play' ? 'play' : 'albums'} size={16} color="#FFFFFF" style={styles.badge} /> : null}
    </View>
  );
}

export const GridTile = memo(GridTileImpl);

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  badge: { position: 'absolute', top: 6, right: 6, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
});
