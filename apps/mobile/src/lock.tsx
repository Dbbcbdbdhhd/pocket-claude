import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadBiometricEnabled, saveBiometricEnabled } from './storage';
import { colors, space } from './theme';

const RELOCK_AFTER_MS = 60_000;

interface LockContextValue {
  enabled: boolean;
  available: boolean;
  setEnabled: (next: boolean) => Promise<void>;
}

const LockContext = createContext<LockContextValue | null>(null);

async function detectAvailable(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [available, setAvailable] = useState(false);
  const [locked, setLocked] = useState(true);
  const authenticating = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  const availableRef = useRef(available);
  enabledRef.current = enabled;
  availableRef.current = available;

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (authenticating.current) return false;
    authenticating.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Pocket' });
      return res.success;
    } finally {
      authenticating.current = false;
    }
  }, []);

  const unlock = useCallback(async () => {
    if (await authenticate()) setLocked(false);
  }, [authenticate]);

  useEffect(() => {
    (async () => {
      const [on, hw] = await Promise.all([loadBiometricEnabled(), detectAvailable().catch(() => false)]);
      setEnabledState(on);
      setAvailable(hw);
      setReady(true);
      if (on && hw) {
        if (await authenticate()) setLocked(false);
      } else {
        setLocked(false);
      }
    })();
  }, [authenticate]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state !== 'active' || backgroundedAt.current === null) return;
      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (away >= RELOCK_AFTER_MS && enabledRef.current && availableRef.current) {
        setLocked(true);
        void authenticate().then((ok) => ok && setLocked(false));
      }
    });
    return () => sub.remove();
  }, [authenticate]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (!next && availableRef.current && !(await authenticate())) return;
      await saveBiometricEnabled(next);
      setEnabledState(next);
    },
    [authenticate],
  );

  const value = useMemo(() => ({ enabled, available, setEnabled }), [enabled, available, setEnabled]);

  return (
    <LockContext.Provider value={value}>
      {children}
      {(!ready || locked) && (
        <View style={styles.overlay}>
          <View style={styles.mark}>
            <Ionicons name="lock-closed" size={26} color={colors.accent} />
          </View>
          <Text style={styles.title}>Pocket is locked</Text>
          {ready && (
            <Pressable onPress={unlock} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
              <Text style={styles.buttonText}>Unlock</Text>
            </Pressable>
          )}
        </View>
      )}
    </LockContext.Provider>
  );
}

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('LockProvider missing');
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    zIndex: 100,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  button: { backgroundColor: colors.accent, paddingHorizontal: space.xxl, paddingVertical: space.md, borderRadius: 8 },
  buttonText: { color: colors.userText, fontWeight: '600', fontSize: 15 },
});
