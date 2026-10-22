import { describe, expect, it } from 'vitest';
import {
  b64,
  deriveDeviceId,
  derivePairKeys,
  deserializeIdentity,
  generateIdentity,
  openSealed,
  serializeIdentity,
  sealTo,
  sign,
  utf8,
  verify,
} from '../src/index.js';

describe('identity', () => {
  it('round-trips through serialization', () => {
    const id = generateIdentity();
    const back = deserializeIdentity(serializeIdentity(id));
    expect(back.signSk).toEqual(id.signSk);
    expect(back.encSk).toEqual(id.encSk);
    expect(back.signPub).toEqual(id.signPub);
    expect(back.encPub).toEqual(id.encPub);
  });

  it('derives a stable 32-char hex device id', () => {
    const id = generateIdentity();
    const a = deriveDeviceId(id.signPub);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveDeviceId(id.signPub)).toBe(a);
    expect(deriveDeviceId(generateIdentity().signPub)).not.toBe(a);
  });
});

describe('sign/verify', () => {
  it('verifies a valid signature and rejects tampering', () => {
    const id = generateIdentity();
    const msg = utf8('hello');
    const sig = sign(msg, id.signSk);
    expect(verify(sig, msg, id.signPub)).toBe(true);
    expect(verify(sig, utf8('hellO'), id.signPub)).toBe(false);
    expect(verify(sig, msg, generateIdentity().signPub)).toBe(false);
  });
});

describe('derivePairKeys', () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const aId = deriveDeviceId(a.signPub);
  const bId = deriveDeviceId(b.signPub);

  it('gives mirrored tx/rx keys', () => {
    const ka = derivePairKeys(a, aId, b.encPub, bId);
    const kb = derivePairKeys(b, bId, a.encPub, aId);
    expect(ka.tx).toEqual(kb.rx);
    expect(ka.rx).toEqual(kb.tx);
    expect(ka.tx).not.toEqual(ka.rx);
  });

  it('throws when both ids are the same', () => {
    expect(() => derivePairKeys(a, aId, b.encPub, aId)).toThrow();
  });
});

describe('sealed box', () => {
  const recipient = generateIdentity();

  it('round-trips', () => {
    const sealed = sealTo(recipient.encPub, utf8('secret'));
    expect(openSealed(recipient, sealed)).toEqual(utf8('secret'));
  });

  it('fails for the wrong recipient', () => {
    const sealed = sealTo(recipient.encPub, utf8('secret'));
    expect(() => openSealed(generateIdentity(), sealed)).toThrow();
  });

  it('fails when any region is tampered', () => {
    const sealed = sealTo(recipient.encPub, utf8('secret'));
    for (const i of [0, 40, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[i] = bad[i]! ^ 1;
      expect(() => openSealed(recipient, bad)).toThrow();
    }
  });

  it('rejects truncated input', () => {
    expect(() => openSealed(recipient, new Uint8Array(10))).toThrow('too short');
  });

  it('keeps ciphertext non-deterministic', () => {
    expect(b64.encode(sealTo(recipient.encPub, utf8('x')))).not.toBe(b64.encode(sealTo(recipient.encPub, utf8('x'))));
  });
});
