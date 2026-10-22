import { describe, expect, it } from 'vitest';
import {
  b64,
  CounterSource,
  openEnvelope,
  ReplayGuard,
  sealEnvelope,
  wireEnvelopeSchema,
  type InnerMessageBody,
} from '../src/index.js';

const key = new Uint8Array(32).fill(7);
const body: InnerMessageBody = { type: 'message.send', payload: { sessionId: 's1', text: 'hi' } };
const seal = () => sealEnvelope({ from: 'dev-a', to: 'dev-b', key, body, counter: 5 });

describe('envelope', () => {
  it('round-trips a message.send body', () => {
    const env = wireEnvelopeSchema.parse(seal());
    const inner = openEnvelope(env, key);
    expect(inner.type).toBe('message.send');
    expect(inner.counter).toBe(5);
    expect(inner.ts).toBeGreaterThan(0);
    expect(inner).toMatchObject(body);
  });

  it('includes pushHint only when given', () => {
    expect(seal()).not.toHaveProperty('pushHint');
    expect(sealEnvelope({ from: 'a', to: 'b', key, body, counter: 1, pushHint: 'completed' }).pushHint).toBe('completed');
  });

  it('fails with the wrong key', () => {
    expect(() => openEnvelope(seal(), new Uint8Array(32).fill(8))).toThrow();
  });

  it.each(['to', 'from', 'id'] as const)('binds %s via AAD', (field) => {
    const env = seal();
    expect(() => openEnvelope({ ...env, [field]: field === 'id' ? 'f'.repeat(32) : 'evil' }, key)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const env = seal();
    const ct = b64.decode(env.ct);
    ct[0] = ct[0]! ^ 1;
    expect(() => openEnvelope({ ...env, ct: b64.encode(ct) }, key)).toThrow();
  });

  it('wire schema rejects v:2', () => {
    expect(wireEnvelopeSchema.safeParse({ ...seal(), v: 2 }).success).toBe(false);
    expect(wireEnvelopeSchema.safeParse(seal()).success).toBe(true);
  });
});

describe('CounterSource', () => {
  it('is strictly increasing over 10k calls', () => {
    const c = new CounterSource();
    let prev = 0;
    for (let i = 0; i < 10_000; i++) {
      const n = c.next();
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });
});

describe('ReplayGuard', () => {
  it('rejects duplicate ids', () => {
    const g = new ReplayGuard();
    expect(g.accept('a', 'id-00001', 1)).toBe(true);
    expect(g.accept('a', 'id-00001', 2)).toBe(false);
  });

  it('rejects non-increasing counters', () => {
    const g = new ReplayGuard();
    expect(g.accept('a', 'id-00001', 10)).toBe(true);
    expect(g.accept('a', 'id-00002', 10)).toBe(false);
    expect(g.accept('a', 'id-00003', 9)).toBe(false);
    expect(g.accept('a', 'id-00004', 11)).toBe(true);
  });

  it('tracks senders independently', () => {
    const g = new ReplayGuard();
    expect(g.accept('a', 'id-00001', 100)).toBe(true);
    expect(g.accept('b', 'id-00002', 1)).toBe(true);
  });

  it('snapshots and restores counters', () => {
    const g = new ReplayGuard();
    g.accept('a', 'id-00001', 100);
    g.accept('b', 'id-00002', 50);
    const snap = g.snapshot();
    expect(snap).toEqual({ a: 100, b: 50 });
    const g2 = new ReplayGuard();
    g2.restore(snap);
    expect(g2.accept('a', 'id-00003', 100)).toBe(false);
    expect(g2.accept('a', 'id-00004', 101)).toBe(true);
    expect(g2.accept('b', 'id-00005', 51)).toBe(true);
  });

  it('evicts oldest ids beyond capacity', () => {
    const g = new ReplayGuard(2);
    g.accept('a', 'id-00001', 1);
    g.accept('a', 'id-00002', 2);
    g.accept('a', 'id-00003', 3);
    expect(g.accept('a', 'id-00001', 4)).toBe(true);
  });
});
