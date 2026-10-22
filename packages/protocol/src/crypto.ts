import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { b64, concatBytes, toHex, utf8 } from './encoding.js';

export { randomBytes };

export interface Identity {
  signSk: Uint8Array;
  signPub: Uint8Array;
  encSk: Uint8Array;
  encPub: Uint8Array;
}

export interface SerializedIdentity {
  signSk: string;
  encSk: string;
}

export function generateIdentity(): Identity {
  return identityFromSecrets(ed25519.utils.randomSecretKey(), x25519.utils.randomSecretKey());
}

export function identityFromSecrets(signSk: Uint8Array, encSk: Uint8Array): Identity {
  return { signSk, signPub: ed25519.getPublicKey(signSk), encSk, encPub: x25519.getPublicKey(encSk) };
}

export function serializeIdentity(id: Identity): SerializedIdentity {
  return { signSk: b64.encode(id.signSk), encSk: b64.encode(id.encSk) };
}

export function deserializeIdentity(s: SerializedIdentity): Identity {
  return identityFromSecrets(b64.decode(s.signSk), b64.decode(s.encSk));
}

/** Device ids and account ids are derived from the Ed25519 public key so the relay can verify them. */
export function deriveDeviceId(signPub: Uint8Array): string {
  return toHex(sha256(concatBytes(utf8('pocket/v1/device|'), signPub))).slice(0, 32);
}

export function deriveAccountId(brainSignPub: Uint8Array): string {
  return toHex(sha256(concatBytes(utf8('pocket/v1/account|'), brainSignPub))).slice(0, 32);
}

export function sign(message: Uint8Array, signSk: Uint8Array): Uint8Array {
  return ed25519.sign(message, signSk);
}

export function verify(signature: Uint8Array, message: Uint8Array, signPub: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, signPub);
  } catch {
    return false;
  }
}

export interface PairKeys {
  tx: Uint8Array;
  rx: Uint8Array;
}

/**
 * Static-static X25519 between two devices, split into one key per direction.
 * Direction keys are ordered by device id so both sides agree without negotiation.
 */
export function derivePairKeys(me: Identity, myDeviceId: string, peerEncPub: Uint8Array, peerDeviceId: string): PairKeys {
  if (myDeviceId === peerDeviceId) throw new Error('cannot derive pair keys with self');
  const shared = x25519.getSharedSecret(me.encSk, peerEncPub);
  const [lo, hi] = myDeviceId < peerDeviceId ? [myDeviceId, peerDeviceId] : [peerDeviceId, myDeviceId];
  const okm = hkdf(sha256, shared, utf8(`${lo}|${hi}`), utf8('pocket/v1/pair'), 64);
  const loToHi = okm.slice(0, 32);
  const hiToLo = okm.slice(32, 64);
  return myDeviceId === lo ? { tx: loToHi, rx: hiToLo } : { tx: hiToLo, rx: loToHi };
}

export const NONCE_BYTES = 24;

export function aeadSeal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): { nonce: Uint8Array; ct: Uint8Array } {
  const nonce = randomBytes(NONCE_BYTES);
  return { nonce, ct: xchacha20poly1305(key, nonce, aad).encrypt(plaintext) };
}

export function aeadOpen(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, aad: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, nonce, aad).decrypt(ct);
}

/** Anonymous sealed box: ephemeral X25519 → HKDF → XChaCha20-Poly1305. Layout: ephPub(32) | nonce(24) | ct. */
export function sealTo(recipientEncPub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const ephSk = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSk);
  const key = sealKey(x25519.getSharedSecret(ephSk, recipientEncPub), ephPub, recipientEncPub);
  const { nonce, ct } = aeadSeal(key, plaintext, concatBytes(ephPub, recipientEncPub));
  return concatBytes(ephPub, nonce, ct);
}

export function openSealed(recipient: Identity, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 32 + NONCE_BYTES + 16) throw new Error('sealed box too short');
  const ephPub = sealed.slice(0, 32);
  const nonce = sealed.slice(32, 32 + NONCE_BYTES);
  const ct = sealed.slice(32 + NONCE_BYTES);
  const key = sealKey(x25519.getSharedSecret(recipient.encSk, ephPub), ephPub, recipient.encPub);
  return aeadOpen(key, nonce, ct, concatBytes(ephPub, recipient.encPub));
}

function sealKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephPub, recipientPub), utf8('pocket/v1/seal'), 32);
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message);
}

export function hkdfSha256(ikm: Uint8Array, salt: string, info: string, length = 32): Uint8Array {
  return hkdf(sha256, ikm, utf8(salt), utf8(info), length);
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
