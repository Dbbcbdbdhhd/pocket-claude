import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ChatState } from '@pocket/client-core';
import type { SerializedIdentity } from '@pocket/protocol';

export interface StoredCredentials {
  relayUrl: string;
  accountId: string;
  deviceId: string;
  identity: SerializedIdentity;
  brainDeviceId: string;
  brainEncPub: string;
}

type Snapshot = Pick<ChatState, 'sessions' | 'threads'>;

const CREDENTIALS_KEY = 'pocketclaude.credentials';
const BIOMETRIC_KEY = 'pc.biometric';
const SNAPSHOT_KEY = 'pc.snapshot';
const REPLAY_KEY = 'pc.replay';

const MAX_CACHED_THREADS = 30;
const MAX_CACHED_ITEMS = 150;

/** expo-secure-store has no web implementation; the browser build (dev preview only) falls back to AsyncStorage. */
const secrets =
  Platform.OS === 'web'
    ? { getItemAsync: AsyncStorage.getItem, setItemAsync: AsyncStorage.setItem, deleteItemAsync: AsyncStorage.removeItem }
    : SecureStore;

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const raw = await secrets.getItemAsync(CREDENTIALS_KEY);
  return raw ? (JSON.parse(raw) as StoredCredentials) : null;
}

export function saveCredentials(creds: StoredCredentials): Promise<void> {
  return secrets.setItemAsync(CREDENTIALS_KEY, JSON.stringify(creds));
}

export async function wipeAll(): Promise<void> {
  await secrets.deleteItemAsync(CREDENTIALS_KEY);
  await AsyncStorage.multiRemove([SNAPSHOT_KEY, REPLAY_KEY]);
}

export async function loadBiometricEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BIOMETRIC_KEY)) !== '0';
}

export function saveBiometricEnabled(enabled: boolean): Promise<void> {
  return AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? '1' : '0');
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

export function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const recent = new Set(snapshot.sessions.slice(0, MAX_CACHED_THREADS).map((s) => s.sessionId));
  const threads: Snapshot['threads'] = {};
  for (const [id, items] of Object.entries(snapshot.threads)) {
    if (recent.has(id)) threads[id] = items.slice(-MAX_CACHED_ITEMS);
  }
  return AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ sessions: snapshot.sessions, threads }));
}

export async function loadReplayState(): Promise<Record<string, number> | undefined> {
  const raw = await AsyncStorage.getItem(REPLAY_KEY);
  return raw ? (JSON.parse(raw) as Record<string, number>) : undefined;
}

export function saveReplayState(state: Record<string, number>): Promise<void> {
  return AsyncStorage.setItem(REPLAY_KEY, JSON.stringify(state));
}
