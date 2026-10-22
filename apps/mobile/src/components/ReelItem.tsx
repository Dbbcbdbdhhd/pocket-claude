import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compact, type Reel } from '../content/fake';
import { useLiked, useMuted } from '../state/engagement';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { AutoVideo } from './AutoVideo';
import { HeartSurface } from './HeartSurface';
import { LikeButton } from './LikeButton';

function ReelItemImpl({ reel, height, active }: { reel: Reel; height: number; active: boolean }) {
  const [liked, setLiked] = useLiked(reel.id, false);
  const [muted, toggleMuted] = useMuted();
  const likes = reel.likes + (liked ? 1 : 0);

  return (
    <View style={{ height, backgroundColor: colors.bg }}>
      <HeartSurface onDoubleTap={() => setLiked(true)} onSingleTap={toggleMuted}>
        <AutoVideo uri={reel.uri} poster={reel.poster} active={active} muted={muted} style={StyleSheet.absoluteFill} />
      </HeartSurface>
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.65)']} style={styles.shade} />
      <View style={styles.rail}>
        <View style={styles.railItem}>
          <LikeButton liked={liked} onToggle={() => setLiked()} size={30} idleColor="#FFFFFF" />
          <Text style={styles.count}>{compact(likes)}</Text>
        </View>
        <View style={styles.railItem}>
          <Ionicons name="chatbubble-outline" size={27} color="#FFFFFF" style={styles.flip} />
          <Text style={styles.count}>{compact(reel.comments)}</Text>
        </View>
        <Ionicons name="paper-plane-outline" size={27} color="#FFFFFF" />
        <Ionicons name="ellipsis-vertical" size={22} color="#FFFFFF" />
        <Image source={{ uri: reel.poster }} style={styles.audioArt} contentFit="cover" />
      </View>

      <View pointerEvents="none" style={styles.info}>
        <View style={styles.userRow}>
          <Avatar uri={reel.user.avatar} size={32} />
          <Text style={styles.username} numberOfLines={1}>
            {reel.user.username}
          </Text>
          <View style={styles.follow}>
            <Text style={styles.followText}>Follow</Text>
          </View>
        </View>
        <Text style={styles.caption} numberOfLines={2}>
          {reel.caption}
        </Text>
        <View style={styles.audioRow}>
          <Ionicons name="musical-notes" size={13} color="#FFFFFF" />
          <Text style={styles.audio} numberOfLines={1}>
            {reel.audio}
          </Text>
        </View>
      </View>
    </View>
  );
}

export const ReelItem = memo(ReelItemImpl);

const styles = StyleSheet.create({
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 260 },
  rail: { position: 'absolute', right: 12, bottom: 20, alignItems: 'center', gap: 20 },
  railItem: { alignItems: 'center', gap: 4 },
  flip: { transform: [{ scaleX: -1 }] },
  count: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  audioArt: { width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: '#FFFFFF' },
  info: { position: 'absolute', left: 12, right: 76, bottom: 20, gap: 10 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  username: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  follow: { borderWidth: 1, borderColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  followText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  caption: { color: '#FFFFFF', fontSize: 14, lineHeight: 19 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  audio: { color: '#FFFFFF', fontSize: 13, flexShrink: 1 },
});
