import { z } from 'zod';
import { wireEnvelopeSchema } from './envelope.js';
import { PROTOCOL_VERSION, roleSchema } from './messages.js';

export const rosterEntrySchema = z.object({
  deviceId: z.string(),
  role: roleSchema,
  name: z.string(),
  signPub: z.string(),
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const pairingBundleSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  accountId: z.string(),
  brainDeviceId: z.string(),
  brainSignPub: z.string(),
  brainEncPub: z.string(),
  expiresAt: z.number(),
});
export type PairingBundle = z.infer<typeof pairingBundleSchema>;

/** Plaintext control frames between a device and the relay. Encrypted traffic travels inside `msg.env`. */
export const deviceToRelaySchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.literal(PROTOCOL_VERSION),
    accountId: z.string(),
    deviceId: z.string(),
    role: roleSchema,
    signPub: z.string().optional(),
  }),
  z.object({ t: z.literal('auth'), sig: z.string() }),
  z.object({ t: z.literal('msg'), env: wireEnvelopeSchema }),
  z.object({ t: z.literal('pairing.publish'), pairingId: z.string(), bundle: pairingBundleSchema }),
  z.object({ t: z.literal('pairing.revoke'), pairingId: z.string() }),
  z.object({ t: z.literal('roster.add'), entry: rosterEntrySchema }),
  z.object({ t: z.literal('roster.remove'), deviceId: z.string() }),
  z.object({ t: z.literal('pair.reply'), pairingId: z.string(), deviceId: z.string(), blob: z.string() }),
  z.object({ t: z.literal('push.register'), fcmToken: z.string() }),
  z.object({ t: z.literal('ping') }),
]);
export type DeviceToRelay = z.infer<typeof deviceToRelaySchema>;

export const relayToDeviceSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('challenge'), nonce: z.string() }),
  z.object({ t: z.literal('ready'), roster: z.array(rosterEntrySchema), online: z.array(z.string()) }),
  z.object({ t: z.literal('msg'), env: wireEnvelopeSchema }),
  z.object({ t: z.literal('presence'), deviceId: z.string(), online: z.boolean() }),
  z.object({ t: z.literal('roster'), roster: z.array(rosterEntrySchema) }),
  z.object({ t: z.literal('pair.incoming'), pairingId: z.string(), deviceId: z.string(), blob: z.string() }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ t: z.literal('pong') }),
]);
export type RelayToDevice = z.infer<typeof relayToDeviceSchema>;

/** Frames on the unauthenticated pairing socket. */
export const pairingClientFrameSchema = z.object({ t: z.literal('pair.request'), deviceId: z.string(), blob: z.string() });
export type PairingClientFrame = z.infer<typeof pairingClientFrameSchema>;

export const pairingServerFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('pair.reply'), blob: z.string() }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type PairingServerFrame = z.infer<typeof pairingServerFrameSchema>;

export const challengeMessage = (nonce: string, deviceId: string): string => `pocket/v1/auth|${nonce}|${deviceId}`;

export const relayPaths = {
  device: (accountId: string) => `/v1/accounts/${accountId}/ws`,
  pairingBundle: (pairingId: string) => `/v1/pairings/${pairingId}`,
  pairingSocket: (pairingId: string) => `/v1/pairings/${pairingId}/ws`,
};
