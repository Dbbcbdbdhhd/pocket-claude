import type { SerializedIdentity } from '@pocket/protocol';

const KEY = 'pocketClaude.state';

export interface PairingState {
  relayUrl: string;
  accountId: string;
  brainDeviceId: string;
  brainEncPub: string;
  executor: { deviceId: string; identity: SerializedIdentity };
  client: { deviceId: string; identity: SerializedIdentity; replay: Record<string, number> };
  replay: Record<string, number>;
}

export interface SecretStore {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

export async function loadState(secrets: SecretStore): Promise<PairingState | undefined> {
  const raw = await secrets.get(KEY);
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as PairingState;
    return s.relayUrl && s.accountId && s.brainDeviceId && s.brainEncPub && s.executor?.deviceId && s.client?.deviceId
      ? { ...s, replay: s.replay ?? {}, client: { ...s.client, replay: s.client.replay ?? {} } } : undefined;
  } catch {
    return undefined;
  }
}

export async function saveState(secrets: SecretStore, state: PairingState): Promise<void> {
  await secrets.store(KEY, JSON.stringify(state));
}

export async function clearState(secrets: SecretStore): Promise<void> {
  await secrets.delete(KEY);
}
