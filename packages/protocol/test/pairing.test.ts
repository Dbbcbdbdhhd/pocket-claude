import { describe, expect, it } from 'vitest';
import {
  b64,
  createPairRequest,
  deriveAccountId,
  deriveDeviceId,
  generateIdentity,
  newPairingCode,
  openPairReply,
  openPairRequest,
  PAIRING_TTL_MS,
  pairingUri,
  parsePairingCode,
  parsePairingUri,
  safetyNumber,
  sealPairReply,
  type PairingBundle,
} from '../src/index.js';

function makeBundle() {
  const brain = generateIdentity();
  const bundle: PairingBundle = {
    v: 1,
    accountId: deriveAccountId(brain.signPub),
    brainDeviceId: deriveDeviceId(brain.signPub),
    brainSignPub: b64.encode(brain.signPub),
    brainEncPub: b64.encode(brain.encPub),
    expiresAt: Date.now() + 60_000,
  };
  return { brain, bundle };
}

describe('pairing code', () => {
  it('display parses back to the same pairingId', () => {
    const code = newPairingCode();
    expect(code.display).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
    for (const input of [code.display, code.display.toLowerCase(), code.display.replaceAll('-', '')]) {
      const parsed = parsePairingCode(input);
      expect(parsed.pairingId).toBe(code.pairingId);
      expect(parsed.bytes).toEqual(code.bytes);
    }
  });

  it('rejects codes of the wrong length', () => {
    expect(() => parsePairingCode('ABCD-EFGH')).toThrow('invalid pairing code');
  });

  it('round-trips through a uri', () => {
    const code = newPairingCode();
    const relay = 'wss://relay.example.com/a?b=c&d=e';
    const parsed = parsePairingUri(pairingUri(code, relay));
    expect(parsed.relayUrl).toBe(relay);
    expect(parsed.code.pairingId).toBe(code.pairingId);
    expect(parsed.code.bytes).toEqual(code.bytes);
    expect(parsed.invite).toBe(false);
    expect(parsePairingUri(pairingUri(code, relay, { invite: true }))).toMatchObject({ relayUrl: relay, invite: true });
  });

  it('rejects foreign uris', () => {
    expect(() => parsePairingUri('https://x.test/?code=AA&relay=r')).toThrow('not a pairing link');
    expect(() => parsePairingUri('pocketclaude://pair?code=AA')).toThrow('not a pairing link');
  });
});

describe('pair request', () => {
  it('opens on the brain with the right device and role', () => {
    const { brain, bundle } = makeBundle();
    const code = newPairingCode();
    const device = generateIdentity();
    const { deviceId, blob } = createPairRequest({ identity: device, role: 'client', name: 'phone', code, bundle });
    expect(deviceId).toBe(deriveDeviceId(device.signPub));
    const req = openPairRequest({ brain, code, blob });
    expect(req.deviceId).toBe(deviceId);
    expect(req.role).toBe('client');
    expect(req.name).toBe('phone');
    expect(req.pairingId).toBe(code.pairingId);
    expect(req.signPub).toBe(b64.encode(device.signPub));
    expect(req.encPub).toBe(b64.encode(device.encPub));
  });

  it('carries and signs the name of an invited person', () => {
    const { brain, bundle } = makeBundle();
    const code = newPairingCode();
    const { blob } = createPairRequest({ identity: generateIdentity(), role: 'client', name: 'phone', userName: 'Masha', code, bundle });
    expect(openPairRequest({ brain, code, blob }).userName).toBe('Masha');
    // Requests from devices that predate userName still verify: the transcript only grows when the field is present.
    const old = createPairRequest({ identity: generateIdentity(), role: 'client', name: 'phone', code, bundle });
    expect(openPairRequest({ brain, code, blob: old.blob }).userName).toBeUndefined();
  });

  it('throws with a different code', () => {
    const { brain, bundle } = makeBundle();
    const code = newPairingCode();
    const { blob } = createPairRequest({ identity: generateIdentity(), role: 'executor', name: 'pc', code, bundle });
    expect(() => openPairRequest({ brain, code: newPairingCode(), blob })).toThrow();
  });

  it('throws when expired', () => {
    const { brain, bundle } = makeBundle();
    const code = newPairingCode();
    const { blob } = createPairRequest({ identity: generateIdentity(), role: 'client', name: 'p', code, bundle });
    expect(() => openPairRequest({ brain, code, blob, now: Date.now() + PAIRING_TTL_MS + 60_000 })).toThrow('expired');
    expect(() => openPairRequest({ brain, code, blob, now: Date.now() + 1000 })).not.toThrow();
  });

  it('throws when opened by a different brain', () => {
    const { bundle } = makeBundle();
    const code = newPairingCode();
    const { blob } = createPairRequest({ identity: generateIdentity(), role: 'client', name: 'p', code, bundle });
    expect(() => openPairRequest({ brain: generateIdentity(), code, blob })).toThrow();
  });
});

describe('pair reply', () => {
  it('round-trips to the device', () => {
    const device = generateIdentity();
    const reply = {
      ok: true as const,
      accountId: 'acc',
      brainDeviceId: 'brain',
      roster: [{ deviceId: 'd1', role: 'executor' as const, name: 'pc', signPub: 'AA==' }],
    };
    const blob = sealPairReply(reply, b64.encode(device.encPub));
    expect(openPairReply(device, blob)).toEqual(reply);
    expect(() => openPairReply(generateIdentity(), blob)).toThrow();
  });
});

describe('safetyNumber', () => {
  it('is deterministic and key dependent', () => {
    const { bundle } = makeBundle();
    const other = makeBundle().bundle;
    expect(safetyNumber(bundle)).toBe(safetyNumber({ ...bundle }));
    expect(safetyNumber(bundle)).toMatch(/^([A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);
    expect(safetyNumber(bundle)).not.toBe(safetyNumber(other));
    expect(safetyNumber(bundle)).not.toBe(safetyNumber({ ...bundle, brainEncPub: other.brainEncPub }));
  });
});
