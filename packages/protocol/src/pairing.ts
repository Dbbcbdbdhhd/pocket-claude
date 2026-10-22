import { z } from 'zod';
import {
  constantTimeEqual,
  deriveDeviceId,
  hkdfSha256,
  hmacSha256,
  openSealed,
  randomBytes,
  sealTo,
  sha256Bytes,
  sign,
  verify,
  type Identity,
} from './crypto.js';
import { b32, b64, b64url, concatBytes, fromUtf8, groupChars, toHex, utf8 } from './encoding.js';
import { roleSchema, type Role } from './messages.js';
import { rosterEntrySchema, type PairingBundle } from './relay-frames.js';

export const PAIRING_TTL_MS = 5 * 60_000;
const CODE_BYTES = 10;

export interface PairingCode {
  bytes: Uint8Array;
  /** Human form typed on the executor, e.g. ABCD-EFGH-IJKL-MNOP */
  display: string;
  pairingId: string;
}

export function newPairingCode(): PairingCode {
  return pairingCodeFromBytes(randomBytes(CODE_BYTES));
}

export function parsePairingCode(input: string): PairingCode {
  const bytes = b32.decode(input);
  if (bytes.length !== CODE_BYTES) throw new Error('invalid pairing code');
  return pairingCodeFromBytes(bytes);
}

function pairingCodeFromBytes(bytes: Uint8Array): PairingCode {
  return {
    bytes,
    display: groupChars(b32.encode(bytes)),
    pairingId: toHex(sha256Bytes(concatBytes(utf8('pocket/v1/pairing-id|'), bytes))).slice(0, 24),
  };
}

/** `invite` marks a link that registers a new person: the phone asks for their name before joining. */
export function pairingUri(code: PairingCode, relayUrl: string, opts: { invite?: boolean } = {}): string {
  return `pocketclaude://pair?code=${b64url.encode(code.bytes)}&relay=${encodeURIComponent(relayUrl)}${opts.invite ? '&invite=1' : ''}`;
}

export function parsePairingUri(uri: string): { code: PairingCode; relayUrl: string; invite: boolean } {
  const url = new URL(uri);
  const code = url.searchParams.get('code');
  const relay = url.searchParams.get('relay');
  if (url.protocol !== 'pocketclaude:' || !code || !relay) throw new Error('not a pairing link');
  return { code: pairingCodeFromBytes(b64url.decode(code)), relayUrl: relay, invite: url.searchParams.get('invite') === '1' };
}

/** Shown on the brain and on the joining device so the user can detect a relay swapping the brain's keys. */
export function safetyNumber(bundle: Pick<PairingBundle, 'brainSignPub' | 'brainEncPub'>): string {
  const digest = sha256Bytes(concatBytes(utf8('pocket/v1/safety|'), b64.decode(bundle.brainSignPub), b64.decode(bundle.brainEncPub)));
  return groupChars(b32.encode(digest.slice(0, 10)));
}

const pairRequestSchema = z.object({
  deviceId: z.string(),
  signPub: z.string(),
  encPub: z.string(),
  role: roleSchema,
  name: z.string().max(64),
  /** The person joining through an invite; the brain registers them under this name. */
  userName: z.string().max(64).optional(),
  pairingId: z.string(),
  ts: z.number(),
  proof: z.string(),
  sig: z.string(),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

const proofKey = (code: PairingCode) => hkdfSha256(code.bytes, 'pocket/v1', 'pair-proof');

function requestTranscript(r: Omit<PairRequest, 'proof' | 'sig'>): Uint8Array {
  // userName is appended only when present so requests from older devices still verify.
  const parts = ['pocket/v1/pair', r.deviceId, r.signPub, r.encPub, r.role, r.name, r.pairingId, r.ts, ...(r.userName !== undefined ? [r.userName] : [])];
  return utf8(parts.join('|'));
}

export function createPairRequest(args: {
  identity: Identity;
  role: Exclude<Role, 'brain'>;
  name: string;
  userName?: string;
  code: PairingCode;
  bundle: PairingBundle;
}): { deviceId: string; blob: string } {
  const deviceId = deriveDeviceId(args.identity.signPub);
  const base = {
    deviceId,
    signPub: b64.encode(args.identity.signPub),
    encPub: b64.encode(args.identity.encPub),
    role: args.role,
    name: args.name,
    ...(args.userName !== undefined ? { userName: args.userName } : {}),
    pairingId: args.code.pairingId,
    ts: Date.now(),
  };
  const transcript = requestTranscript(base);
  const request: PairRequest = {
    ...base,
    proof: b64.encode(hmacSha256(proofKey(args.code), transcript)),
    sig: b64.encode(sign(transcript, args.identity.signSk)),
  };
  const blob = sealTo(b64.decode(args.bundle.brainEncPub), utf8(JSON.stringify(request)));
  return { deviceId, blob: b64.encode(blob) };
}

/** Run on the brain. Throws unless the request proves knowledge of the code and possession of its keys. */
export function openPairRequest(args: { brain: Identity; code: PairingCode; blob: string; now?: number }): PairRequest {
  const request = pairRequestSchema.parse(JSON.parse(fromUtf8(openSealed(args.brain, b64.decode(args.blob)))));
  const { proof, sig, ...base } = request;
  const transcript = requestTranscript(base);
  if (request.pairingId !== args.code.pairingId) throw new Error('pairing id mismatch');
  if (!constantTimeEqual(hmacSha256(proofKey(args.code), transcript), b64.decode(proof))) throw new Error('bad pairing proof');
  if (!verify(b64.decode(sig), transcript, b64.decode(request.signPub))) throw new Error('bad pairing signature');
  if (deriveDeviceId(b64.decode(request.signPub)) !== request.deviceId) throw new Error('device id does not match key');
  if (Math.abs((args.now ?? Date.now()) - request.ts) > PAIRING_TTL_MS) throw new Error('pairing request expired');
  return request;
}

const pairReplySchema = z.object({
  ok: z.literal(true),
  accountId: z.string(),
  brainDeviceId: z.string(),
  roster: z.array(rosterEntrySchema),
});
export type PairReply = z.infer<typeof pairReplySchema>;

export function sealPairReply(reply: PairReply, deviceEncPub: string): string {
  return b64.encode(sealTo(b64.decode(deviceEncPub), utf8(JSON.stringify(reply))));
}

export function openPairReply(identity: Identity, blob: string): PairReply {
  return pairReplySchema.parse(JSON.parse(fromUtf8(openSealed(identity, b64.decode(blob)))));
}
