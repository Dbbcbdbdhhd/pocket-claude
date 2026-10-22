import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { agoLong, withCommas, type Post } from '../content/fake';
import { useLiked, useMuted, useSaved } from '../state/engagement';
import { colors } from '../theme';
import { Avatar } from './Avatar';
import { AutoVideo } from './AutoVideo';
import { HeartSurface } from './HeartSurface';
import { LikeButton } from './LikeButton';

function PostCardImpl({ post, active }: { post: Post; active: boolean }) {
  const { width } = useWindowDimensions();
  const [liked, setLiked] = useLiked(post.id, post.liked);
  const [saved, toggleSaved] = useSaved(post.id);
  const [muted, toggleMuted] = useMuted();
  const [expanded, setExpanded] = useState(false);
  const likes = post.likes + (liked && !post.liked ? 1 : 0);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Avatar uri={post.user.avatar} size={32} ring={post.hasStory ? 'unseen' : undefined} />
        <View style={styles.headerText}>
          <Text style={styles.username} numberOfLines={1}>
            {post.user.username}
          </Text>
          {post.kind === 'video' ? <Text style={styles.sub}>Original audio</Text> : null}
        </View>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
      </View>

      <View style={{ width, height: width }}>
        <HeartSurface onDoubleTap={() => setLiked(true)} onSingleTap={post.kind === 'video' ? toggleMuted : undefined}>
          {post.kind === 'video' ? (
            <AutoVideo uri={post.uri} poster={post.poster} active={active} muted={muted} style={StyleSheet.absoluteFill} />
          ) : (
            <Image source={{ uri: post.uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} recyclingKey={post.uri} />
          )}
        </HeartSurface>
        {post.kind === 'video' ? (
          <Pressable onPress={toggleMuted} style={styles.mute} hitSlop={8} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={13} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <LikeButton liked={liked} onToggle={() => setLiked()} />
          <Ionicons name="chatbubble-outline" size={24} color={colors.text} style={styles.flip} />
          <Ionicons name="paper-plane-outline" size={24} color={colors.text} />
        </View>
        <Pressable onPress={toggleSaved} hitSlop={8} accessibilityLabel="Save">
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.meta}>
        <Text style={styles.bold}>{withCommas(likes)} likes</Text>
        <Pressable onPress={() => setExpanded(true)}>
          <Text style={styles.body} numberOfLines={expanded ? undefined : 2}>
            <Text style={styles.bold}>{post.user.username}</Text> {post.caption}
          </Text>
        </Pressable>
        <Text style={styles.muted}>View all {withCommas(post.comments)} comments</Text>
        <Text style={styles.time}>{agoLong(post.minutesAgo)}</Text>
      </View>
    </View>
  );
}

export const PostCard = memo(PostCardImpl);

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, paddingBottom: 14 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  headerText: { flex: 1 },
  username: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sub: { color: colors.text, fontSize: 12, marginTop: 1 },
  mute: { position: 'absolute', right: 12, bottom: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  actions: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flip: { transform: [{ scaleX: -1 }] },
  meta: { paddingHorizontal: 12, gap: 3 },
  bold: { color: colors.text, fontSize: 14, fontWeight: '600' },
  body: { color: colors.text, fontSize: 14, lineHeight: 19 },
  muted: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  time: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
