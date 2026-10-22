import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '../src/format';
import { useLock } from '../src/lock';
import { useSession } from '../src/session';
import { colors, mono } from '../src/theme';

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

function Row({
  icon,
  label,
  value,
  hint,
  tint = colors.text,
  onPress,
  right,
}: {
  icon: IconName;
  label: string;
  value?: string;
  hint?: string;
  tint?: string;
  onPress?: () => void;
  right?: ReactNode;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={26} color={tint} />
      <View style={styles.rowBody}>
        <Text style={[styles.label, { color: tint }]}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {value !== undefined ? (
        <Text selectable style={styles.value} numberOfLines={1} ellipsizeMode="middle">
          {value}
        </Text>
      ) : null}
      {right}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials, client, unpair } = useSession();
  const lock = useLock();

  const stopEverything = () =>
    Alert.alert('Stop everything?', 'Kills all Claude processes on the Mac and all running commands on the Windows laptop.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop everything',
        style: 'destructive',
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          client?.kill();
        },
      },
    ]);

  const confirmUnpair = () =>
    Alert.alert('Unpair this phone?', 'The keys on this phone are erased. You will need to pair again with a new code.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpair', style: 'destructive', onPress: () => void unpair() },
    ]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top, height: 48 + insets.top }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Settings and activity</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Section title="Connection" />
        <Row icon="cloud-outline" label="Relay" value={credentials?.relayUrl ?? '—'} />
        <Row icon="person-circle-outline" label="Account" value={credentials?.accountId ?? '—'} />
        <Row icon="phone-portrait-outline" label="This device" value={credentials?.deviceId ?? '—'} />

        <Section title="Security" />
        <Row
          icon="finger-print"
          label="Biometric lock"
          hint={lock.available ? 'Ask on launch and after 60 s in background' : 'No biometrics or screen lock set up on this phone'}
          right={
            <Switch
              value={lock.enabled}
              onValueChange={(v) => void lock.setEnabled(v)}
              trackColor={{ false: colors.borderHi, true: colors.accent }}
              thumbColor="#FFFFFF"
            />
          }
        />

        <Section title="Login" />
        <Row icon="stop-circle-outline" label="Stop everything" tint={colors.danger} onPress={stopEverything} />
        <Row icon="log-out-outline" label="Unpair this phone" tint={colors.accent} onPress={confirmUnpair} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 16 },
  back: { width: 28 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  section: { color: colors.textMuted, fontSize: 14, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, minHeight: 56 },
  rowBody: { flexShrink: 1, flexGrow: 1, gap: 2, paddingVertical: 8 },
  label: { fontSize: 16 },
  hint: { color: colors.textMuted, fontSize: 13 },
  value: { flexShrink: 1, maxWidth: '55%', color: colors.textMuted, fontFamily: mono, fontSize: 12.5, textAlign: 'right' },
});
