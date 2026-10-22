import { Ionicons } from '@expo/vector-icons';
import type { ClipboardItem, Computer } from '@pocket/protocol';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatState, useSession } from './session';
import { colors } from './theme';

interface PcClipboard {
  /** The computer whose clipboard is used: the last picked one, else the first online. */
  target: Computer | undefined;
  read(): Promise<ClipboardItem[]>;
  write(item: ClipboardItem, label?: string): Promise<void>;
}

const Ctx = createContext<PcClipboard | null>(null);

export function PcClipboardProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { client } = useSession();
  const state = useChatState();
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = useMemo(() => {
    const list = state.computers.filter((c) => c.capabilities?.includes('clipboard'));
    return list.find((c) => c.deviceId === state.activeComputer && c.online) ?? list.find((c) => c.online) ?? list[0];
  }, [state.computers, state.activeComputer]);

  const show = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const value = useMemo<PcClipboard>(
    () => ({
      target,
      read: async () => {
        if (!client || !target) throw new Error('No computer shares its clipboard yet');
        return client.readClipboard(target.deviceId);
      },
      write: async (item, label) => {
        try {
          if (!client || !target) throw new Error('No computer shares its clipboard yet');
          await client.writeClipboard(target.deviceId, item);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          show(`${label ?? 'Copied'} to ${target.name}`);
        } catch (e) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          show(e instanceof Error ? e.message : 'Could not copy', true);
          throw e;
        }
      },
    }),
    [client, target, show],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 84 }, toast.error && styles.toastError]}>
          <Ionicons name={toast.error ? 'alert-circle' : 'checkmark-circle'} size={16} color={toast.error ? colors.danger : colors.ok} />
          <Text style={styles.toastText} numberOfLines={2}>
            {toast.text}
          </Text>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function usePcClipboard(): PcClipboard {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('PcClipboardProvider missing');
  return ctx;
}

/** "Copy to PC" control used under replies and on code blocks. */
export function CopyToPc({ text, compact, label = 'To PC' }: { text: string; compact?: boolean; label?: string }) {
  const { target, write } = usePcClipboard();
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const press = () => {
    if (busy || !text) return;
    setBusy(true);
    void write({ kind: 'text', text }, compact ? 'Code copied' : 'Copied')
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <Pressable
      onPress={press}
      hitSlop={8}
      disabled={!target.online}
      accessibilityLabel={`Copy to ${target.name} clipboard`}
      style={({ pressed }) => [compact ? styles.iconBtn : styles.pill, !target.online && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="desktop-outline" size={compact ? 14 : 13} color={colors.textMuted} />}
      {compact ? null : <Text style={styles.pillText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '86%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surfaceHi,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHi,
    zIndex: 50,
  },
  toastError: { borderColor: 'rgba(237,73,86,0.5)' },
  toastText: { color: colors.text, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: colors.surface },
  pillText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  iconBtn: { width: 26, height: 22, alignItems: 'center', justifyContent: 'center' },
});
