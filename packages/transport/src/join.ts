import {
  createPairRequest,
  generateIdentity,
  openPairReply,
  pairingBundleSchema,
  pairingServerFrameSchema,
  relayPaths,
  safetyNumber,
  type Identity,
  type PairingBundle,
  type PairingCode,
  type PairReply,
  type Role,
} from '@pocket/protocol';
import { toWsUrl, type WebSocketCtor } from './device-link.js';

export interface JoinedDevice {
  identity: Identity;
  deviceId: string;
  bundle: PairingBundle;
  reply: PairReply;
}

export async function fetchPairingBundle(relayUrl: string, code: PairingCode, fetchImpl: typeof fetch = fetch): Promise<PairingBundle> {
  const res = await fetchImpl(new URL(relayPaths.pairingBundle(code.pairingId), relayUrl).toString());
  if (res.status === 404) throw new Error('Pairing code not found or expired');
  if (!res.ok) throw new Error(`Relay returned ${res.status}`);
  const bundle = pairingBundleSchema.parse(await res.json());
  if (bundle.expiresAt < Date.now()) throw new Error('Pairing code expired');
  return bundle;
}

/**
 * Joins the account of the brain that issued `code`.
 * `confirmSafetyNumber` lets the UI show the brain's safety number and abort on mismatch.
 */
export async function joinAccount(args: {
  relayUrl: string;
  code: PairingCode;
  role: Exclude<Role, 'brain'>;
  name: string;
  /** Registers a new person under this name when joining through an invite. */
  userName?: string;
  identity?: Identity;
  confirmSafetyNumber?: (safetyNumber: string) => Promise<boolean>;
  WebSocket?: WebSocketCtor;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<JoinedDevice> {
  const bundle = await fetchPairingBundle(args.relayUrl, args.code, args.fetch);
  if (args.confirmSafetyNumber && !(await args.confirmSafetyNumber(safetyNumber(bundle)))) {
    throw new Error('Safety number rejected');
  }
  const identity = args.identity ?? generateIdentity();
  const { deviceId, blob } = createPairRequest({ identity, role: args.role, name: args.name, userName: args.userName, code: args.code, bundle });

  const Ctor = args.WebSocket ?? (globalThis.WebSocket as WebSocketCtor);
  const ws = new Ctor(toWsUrl(args.relayUrl, relayPaths.pairingSocket(args.code.pairingId)));

  const replyBlob = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Pairing timed out: is the brain online?'));
    }, args.timeoutMs ?? 60_000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'pair.request', deviceId, blob }));
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      try {
        const frame = pairingServerFrameSchema.parse(JSON.parse(String(ev.data)));
        if (frame.t === 'error') reject(new Error(frame.message));
        else resolve(frame.blob);
      } catch (e) {
        reject(e);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not reach relay'));
    };
  });

  const reply = openPairReply(identity, replyBlob);
  if (reply.brainDeviceId !== bundle.brainDeviceId || reply.accountId !== bundle.accountId) {
    throw new Error('Pairing reply does not match bundle');
  }
  return { identity, deviceId, bundle, reply };
}
