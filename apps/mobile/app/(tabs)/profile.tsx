import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/Avatar';
import { GridTile } from '../../src/components/GridTile';
import { compact, HIGHLIGHTS, makeGrid, OWN } from '../../src/content/fake';
import { colors } from '../../src/theme';

const GAP = 1.5;

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const grid = useMemo(() => makeGrid(30, 'me'), []);
  const cell = (width - GAP * 2) / 3;

  const header = (
    <View>
      <View style={styles.top}>
        <Avatar uri={OWN.avatar} size={86} />
        <View style={styles.stats}>
          <Stat value={String(grid.length)} label="posts" />
          <Stat value={compact(1284)} label="followers" />
          <Stat value={compact(312)} label="following" />
        </View>
      </View>
      <View style={styles.bio}>
        <Text style={styles.name}>Pocket User</Text>
        <Text style={styles.bioText}>Running Claude from my pocket</Text>
        <Text style={styles.bioText}>Mac thinks, Windows does</Text>
      </View>
      <View style={styles.buttons}>
        <View style={[styles.button, { flex: 1 }]}>
          <Text style={styles.buttonText}>Edit profile</Text>
        </View>
        <View style={[styles.button, { flex: 1 }]}>
          <Text style={styles.buttonText}>Share profile</Text>
        </View>
        <View style={[styles.button, styles.iconButton]}>
          <Ionicons name="person-add-outline" size={16} color={colors.text} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlights}>
        <View style={styles.highlight}>
          <View style={[styles.hlCircle, styles.hlNew]}>
            <Ionicons name="add" size={30} color={colors.text} />
          </View>
          <Text style={styles.hlLabel}>New</Text>
        </View>
        {HIGHLIGHTS.map((h) => (
          <View key={h.id} style={styles.highlight}>
            <View style={styles.hlCircle}>
              <Image source={{ uri: h.uri }} style={styles.hlImage} contentFit="cover" cachePolicy="memory-disk" />
            </View>
            <Text style={styles.hlLabel}>{h.label}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.tabs}>
        <View style={[styles.tab, styles.tabOn]}>
          <Ionicons name="grid-outline" size={24} color={colors.text} />
        </View>
        <View style={styles.tab}>
          <Ionicons name="film-outline" size={24} color={colors.textMuted} />
        </View>
        <View style={styles.tab}>
          <Ionicons name="person-circle-outline" size={26} color={colors.textMuted} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.handle}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.text} />
          <Text style={styles.handleText}>{OWN.username}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.text} />
        </View>
        <View style={styles.barIcons}>
          <Ionicons name="add-circle-outline" size={28} color={colors.text} />
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Settings">
            <Ionicons name="menu" size={30} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <FlatList
        data={grid}
        numColumns={3}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={Gap}
        renderItem={({ item }) => <GridTile tile={item} style={{ width: cell, height: cell * (4 / 3) }} />}
        initialNumToRender={12}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

function Gap() {
  return <View style={{ height: GAP }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  handle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handleText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  barIcons: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 24 },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700' },
  statLabel: { color: colors.text, fontSize: 14, marginTop: 1 },
  bio: { paddingHorizontal: 16, paddingTop: 12, gap: 1 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  bioText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  buttons: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 14 },
  button: { height: 32, borderRadius: 8, backgroundColor: colors.borderHi, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 34 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  highlights: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 14, gap: 14 },
  highlight: { alignItems: 'center', gap: 5, width: 68 },
  hlCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: colors.borderHi, padding: 3, alignItems: 'center', justifyContent: 'center' },
  hlNew: {},
  hlImage: { width: 56, height: 56, borderRadius: 28 },
  hlLabel: { color: colors.text, fontSize: 12 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tab: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.text },
});
