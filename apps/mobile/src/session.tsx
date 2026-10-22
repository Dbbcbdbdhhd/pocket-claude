import { ChatClient, type ChatState } from '@pocket/client-core';
import { deserializeIdentity, serializeIdentity, type PairingCode } from '@pocket/protocol';
import { joinAccount } from '@pocket/transport';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  loadCredentials,
  loadReplayState,
  loadSnapshot,
  saveCredentials,
  saveReplayState,
  saveSnapshot,
  wipeAll,
  type StoredCredentials,
} from './storage';

type Phase = 'loading' | 'unpaired' | 'paired';

interface SessionContextValue {
  phase: Phase;
  credentials: StoredCredentials | null;
  client: ChatClient | null;
  /** `userName` registers a new person (invite links); without it the phone joins the code's owner. */
  pair: (args: { relayUrl: string; code: PairingCode; userName?: string }) => Promise<void>;
  unpair: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const SNAPSHOT_DEBOUNCE_MS = 1500;
const REPLAY_INTERVAL_MS = 10_000;

const EMPTY_STATE: ChatState = {
  connection: 'offline',
  brainOnline: false,
  host: null,
  sessions: [],
  threads: {},
  loaded: {},
  permissions: [],
  models: [],
  activity: null,
  computers: [],
  activeComputer: null,
  mac: null,
  pairing: null,
  invitation: null,
  lastError: null,
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [client, setClient] = useState<ChatClient | null>(null);

  useEffect(() => {
    loadCredentials().then(
      (c) => {
        setCredentials(c);
        setPhase(c ? 'paired' : 'unpaired');
      },
      () => setPhase('unpaired'),
    );
  }, []);

  useEffect(() => {
    if (!credentials) {
      setClient(null);
      return;
    }
    let disposed = false;
    let created: ChatClient | null = null;
    let unsubscribe = () => {};
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    let replayTimer: ReturnType<typeof setInterval> | null = null;
    let appSub: { remove: () => void } | null = null;

    (async () => {
      const [snapshot, replayState] = await Promise.all([loadSnapshot().catch(() => null), loadReplayState().catch(() => undefined)]);
      if (disposed) return;
      const c = new ChatClient({
        relayUrl: credentials.relayUrl,
        accountId: credentials.accountId,
        deviceId: credentials.deviceId,
        identity: deserializeIdentity(credentials.identity),
        brainDeviceId: credentials.brainDeviceId,
        brainEncPub: credentials.brainEncPub,
        replayState,
        onRelayMoved: (relayUrl) => void saveCredentials({ ...credentials, relayUrl }).catch(() => {}),
      });
      created = c;
      if (snapshot) c.hydrate(snapshot);

      const persistReplay = () => void saveReplayState(c.replayState()).catch(() => {});
      let lastSessions = c.getState().sessions;
      let lastThreads = c.getState().threads;
      unsubscribe = c.subscribe((s) => {
        if (s.sessions === lastSessions && s.threads === lastThreads) return;
        lastSessions = s.sessions;
        lastThreads = s.threads;
        if (snapshotTimer) clearTimeout(snapshotTimer);
        snapshotTimer = setTimeout(() => {
          snapshotTimer = null;
          void saveSnapshot(c.snapshot()).catch(() => {});
        }, SNAPSHOT_DEBOUNCE_MS);
      });
      replayTimer = setInterval(persistReplay, REPLAY_INTERVAL_MS);
      appSub = AppState.addEventListener('change', (st) => {
        if (st !== 'active') {
          persistReplay();
          void saveSnapshot(c.snapshot()).catch(() => {});
        }
      });
      c.connect();
      setClient(c);
    })();

    return () => {
      disposed = true;
      unsubscribe();
      appSub?.remove();
      if (snapshotTimer) clearTimeout(snapshotTimer);
      if (replayTimer) clearInterval(replayTimer);
      if (created) {
        void saveReplayState(created.replayState()).catch(() => {});
        created.close();
      }
      setClient(null);
    };
  }, [credentials]);

  const pair = useCallback(async ({ relayUrl, code, userName }: { relayUrl: string; code: PairingCode; userName?: string }) => {
    const joined = await joinAccount({
      relayUrl,
      code,
      role: 'client',
      name: Device.modelName ?? 'Android phone',
      ...(userName ? { userName } : {}),
    });
    const next: StoredCredentials = {
      relayUrl,
      accountId: joined.reply.accountId,
      deviceId: joined.deviceId,
      identity: serializeIdentity(joined.identity),
      brainDeviceId: joined.reply.brainDeviceId,
      brainEncPub: joined.bundle.brainEncPub,
    };
    await saveCredentials(next);
    setCredentials(next);
    setPhase('paired');
  }, []);

  const unpair = useCallback(async () => {
    setCredentials(null);
    await wipeAll();
    setPhase('unpaired');
  }, []);

  const value = useMemo(() => ({ phase, credentials, client, pair, unpair }), [phase, credentials, client, pair, unpair]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider missing');
  return ctx;
}

export function useChatState(): ChatState {
  const { client } = useSession();
  const clientRef = useRef(client);
  clientRef.current = client;
  const subscribe = useCallback(
    (cb: () => void) => (client ? client.subscribe(cb) : () => {}),
    [client],
  );
  return useSyncExternalStore(
    subscribe,
    () => clientRef.current?.getState() ?? EMPTY_STATE,
    () => EMPTY_STATE,
  );
}
