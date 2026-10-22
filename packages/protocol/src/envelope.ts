import { z } from 'zod';
import { aeadOpen, aeadSeal, randomBytes } from './crypto.js';
import { b64, fromUtf8, toHex, utf8 } from './encoding.js';
import { innerMessageSchema, PROTOCOL_VERSION, type InnerMessage, type InnerMessageBody } from './messages.js';

export const pushHintSchema = z.enum(['completed', 'permission', 'executor_offline']);
export type PushHint = z.infer<typeof pushHintSchema>;

/** The only part of a message the relay can read. */
export const wireEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(8).max(64),
  from: z.string(),
  to: z.string(),
  nonce: z.string(),
  ct: z.string(),
  pushHint: pushHintSchema.optional(),
});
export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

const aadFor = (v: number, id: string, from: string, to: string) => utf8(`${v}|${id}|${from}|${to}`);

export function newMessageId(): string {
  return toHex(randomBytes(16));
}

/** Strictly increasing per process and across restarts (clock based), used for replay protection. */
export class CounterSource {
  private last = 0;
  next(): number {
    const candidate = Date.now() * 1000;
    this.last = candidate > this.last ? candidate : this.last + 1;
    return this.last;
  }
}

export function sealEnvelope(args: {
  from: string;
  to: string;
  key: Uint8Array;
  body: InnerMessageBody;
  counter: number;
  pushHint?: PushHint;
}): WireEnvelope {
  const id = newMessageId();
  const inner: InnerMessage = { ts: Date.now(), counter: args.counter, ...args.body };
  const { nonce, ct } = aeadSeal(args.key, utf8(JSON.stringify(inner)), aadFor(PROTOCOL_VERSION, id, args.from, args.to));
  return {
    v: PROTOCOL_VERSION,
    id,
    from: args.from,
    to: args.to,
    nonce: b64.encode(nonce),
    ct: b64.encode(ct),
    ...(args.pushHint ? { pushHint: args.pushHint } : {}),
  };
}

export function openEnvelope(env: WireEnvelope, key: Uint8Array): InnerMessage {
  const plain = aeadOpen(key, b64.decode(env.nonce), b64.decode(env.ct), aadFor(env.v, env.id, env.from, env.to));
  return innerMessageSchema.parse(JSON.parse(fromUtf8(plain)));
}

/** Rejects replays: counters must strictly increase per sender, ids are deduplicated. */
export class ReplayGuard {
  private readonly lastCounter = new Map<string, number>();
  private readonly seenIds = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(private readonly maxIds = 4096) {}

  accept(from: string, id: string, counter: number): boolean {
    if (this.seenIds.has(id)) return false;
    const last = this.lastCounter.get(from) ?? 0;
    if (counter <= last) return false;
    this.lastCounter.set(from, counter);
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > this.maxIds) this.seenIds.delete(this.seenOrder.shift()!);
    return true;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.lastCounter);
  }

  restore(counters: Record<string, number>): void {
    for (const [from, c] of Object.entries(counters)) this.lastCounter.set(from, c);
  }
}
