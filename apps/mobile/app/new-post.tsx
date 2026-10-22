import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { colors } from '../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const OPTIONS: { icon: IconName; label: string }[] = [
  { icon: 'grid-outline', label: 'Post' },
  { icon: 'film-outline', label: 'Reel' },
  { icon: 'add-circle-outline', label: 'Story' },
  { icon: 'heart-circle-outline', label: 'Story highlight' },
  { icon: 'radio-outline', label: 'Live' },
];

export default function NewPostSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Create</Text>
        {OPTIONS.map((o) => (
          <Pressable key={o.label} onPress={() => router.back()} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}>
            <Ionicons name={o.icon} size={26} color={colors.text} />
            <Text style={styles.label}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surfaceHi, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#555555', marginBottom: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 56 },
  label: { color: colors.text, fontSize: 16 },
});
