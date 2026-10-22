import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/Avatar';
import { GridTile } from '../../src/components/GridTile';
import { makeExploreBlock, makeSuggestedAccounts, type ExploreBlock } from '../../src/content/fake';
import { colors } from '../../src/theme';

const GAP = 1.5;
const PAGE = 5;

const Block = memo(function Block({ block, width }: { block: ExploreBlock; width: number }) {
  const cell = (width - GAP * 2) / 3;
  const small = { width: cell, height: cell };
  const tall = { width: cell, height: cell * 2 + GAP };
  const [t0, t1, t2, t3, t4] = block.tiles;
  const left = block.tallLeft;
  const column = (a: ExploreBlock['tiles'][number], b: ExploreBlock['tiles'][number]) => (
    <View style={{ gap: GAP }}>
      <GridTile tile={a} style={small} />
      <GridTile tile={b} style={small} />
    </View>
  );
  return (
    <View style={[styles.block, { width }]}>
      {left ? <GridTile tile={t0} style={tall} icon={t0.kind === 'video' ? 'play' : undefined} /> : column(t1, t2)}
      {left ? column(t1, t2) : column(t3, t4)}
      {left ? column(t3, t4) : <GridTile tile={t0} style={tall} />}
    </View>
  );
});

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [blocks, setBlocks] = useState<ExploreBlock[]>(() => Array.from({ length: PAGE }, (_, i) => makeExploreBlock(i)));
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState('');
  const accounts = useMemo(() => makeSuggestedAccounts(24), []);
  const shown = useMemo(() => accounts.filter((a) => a.username.includes(query.trim().toLowerCase())), [accounts, query]);

  const loadMore = useCallback(() => setBlocks((b) => [...b, ...Array.from({ length: PAGE }, (_, i) => makeExploreBlock(b.length + i))]), []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {focused ? (
          <Pressable
            onPress={() => {
              setFocused(false);
              setQuery('');
            }}
            hitSlop={8}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      {focused ? (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.username}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.account}>
              <Avatar uri={item.avatar} size={44} />
              <Text style={styles.accountName}>{item.username}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <Block block={item} width={width} />}
          ItemSeparatorComponent={Gap}
          onEndReached={loadMore}
          onEndReachedThreshold={1.5}
          initialNumToRender={3}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

function Gap() {
  return <View style={{ height: GAP }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, height: 52 },
  search: { flex: 1, height: 36, borderRadius: 10, backgroundColor: colors.surfaceHi, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  cancel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  block: { flexDirection: 'row', gap: GAP },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  accountName: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
