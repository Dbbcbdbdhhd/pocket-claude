import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Story } from '../content/fake';
import { colors } from '../theme';
import { Avatar } from './Avatar';

function StoryItem({ story }: { story: Story }) {
  const ring = story.own ? undefined : story.seen ? 'seen' : 'unseen';
  return (
    <View style={styles.item}>
      <View style={styles.avatarBox}>
        <Avatar uri={story.user.avatar} size={story.own ? 66 : 58} ring={ring} />
        {story.own ? (
          <View style={styles.plus}>
            <Ionicons name="add" size={16} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.name, story.seen && !story.own && { color: colors.textMuted }]} numberOfLines={1}>
        {story.own ? 'Your story' : story.user.username}
      </Text>
    </View>
  );
}

function StoriesRowImpl({ stories }: { stories: Story[] }) {
  return (
    <View style={styles.root}>
      <FlatList
        horizontal
        data={stories}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <StoryItem story={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={7}
        windowSize={5}
      />
    </View>
  );
}

export const StoriesRow = memo(StoriesRowImpl);

const styles = StyleSheet.create({
  root: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 6 },
  list: { paddingHorizontal: 8, paddingTop: 8 },
  item: { width: 82, alignItems: 'center', gap: 4 },
  avatarBox: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  plus: { position: 'absolute', right: 3, bottom: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, borderWidth: 2.5, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 12, maxWidth: 76 },
});
