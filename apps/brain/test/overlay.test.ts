import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InnerMessage, PairingCode } from '@pocket/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The brain reads its home from the environment at import time.
const home = mkdtempSync(join(tmpdir(), 'pocket-overlay-'));
process.env.POCKET_HOME = home;
process.env.POCKET_LOG_DIR = join(home, 'logs');
process.env.POCKET_NO_KEYCHAIN = '1';

const { generateIdentity, parsePairingUri } = await import('@pocket/protocol');
const { DeviceLink, joinAccount } = await import('@pocket/transport');
const { startNodeRelay } = await import('../../relay/src/node-server.js');
const { Brain } = await import('../src/daemon.js');
const { ensureDirs } = await import('../src/store.js');

type Relay = Awaited<ReturnType<typeof startNodeRelay>>;
type Link = InstanceType<typeof DeviceLink>;

let relay: Relay;
let brain: InstanceType<typeof Brain>;
let code: PairingCode;
const links: Link[] = [];

const until = <T>(what: string, fn: (resolve: (v: T) => void) => void, ms = 10_000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), ms);
    fn((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });

/** Joins the account with a fresh device and connects it; resolves once the relay says it is ready. */
async function connect(role: 'executor' | 'client', name: string) {
  const joined = await joinAccount({ relayUrl: relay.url, code, role, name });
  const link = new DeviceLink({
    relayUrl: relay.url,
    accountId: joined.bundle.accountId,
    deviceId: joined.deviceId,
    role,
    identity: joined.identity,
    peers: { [joined.bundle.brainDeviceId]: joined.bundle.brainEncPub },
  });
  links.push(link);
  const inbox: InnerMessage[] = [];
  const waiters: { match: (m: InnerMessage) => boolean; resolve: (m: InnerMessage) => void }[] = [];
  link.on('message', ({ message }) => {
    inbox.push(message);
    for (const w of waiters.splice(0)) {
      if (w.match(message)) w.resolve(message);
      else waiters.push(w);
    }
  });
  const ready = until<void>(`${name} ready`, (ok) => link.on('ready', () => ok()));
  link.connect();
  await ready;
  const brainId = joined.bundle.brainDeviceId;
  return {
    deviceId: joined.deviceId,
    send: (body: Parameters<Link['send']>[1]) => link.send(brainId, body),
    inbox,
    next: (type: InnerMessage['type']) =>
      until<InnerMessage>(`${name} ← ${type}`, (resolve) => {
        const hit = inbox.find((m) => m.type === type);
        if (hit) resolve(hit);
        else waiters.push({ match: (m) => m.type === type, resolve });
      }),
  };
}

beforeAll(async () => {
  ensureDirs();
  relay = await startNodeRelay({ port: 0 });
  brain = new Brain(generateIdentity(), { relayUrl: relay.url, devices: [], users: [], allowlist: [], sessions: [], replay: {} }, { persist: false });
  brain.start();
  await until<void>('brain ready', (ok) => {
    const t = setInterval(() => brain.status().relayConnected && (clearInterval(t), ok()), 25);
  });
  code = parsePairingUri(brain.startPairing().uri).code;
});

afterAll(async () => {
  for (const l of links) l.close();
  brain.stop();
  await relay.close();
});

describe('overlay executors', () => {
  it('mirrors session changes to overlays, not to plain executors, and lets overlays read sessions', async () => {
    const overlay = await connect('executor', 'overlay-pc');
    const plain = await connect('executor', 'plain-pc');
    const phone = await connect('client', 'phone');
    overlay.send({ type: 'executor.status', payload: { workspaces: [], os: 'win32', shell: 'none', capabilities: ['clipboard', 'overlay'] } });
    plain.send({ type: 'executor.status', payload: { workspaces: [], os: 'win32', shell: 'none', capabilities: ['clipboard'] } });
    // Wait until the brain has recorded both statuses: it answers every status with a computers list.
    await until<void>('both computers known', (ok) => {
      const t = setInterval(() => {
        const list = [...phone.inbox].reverse().find((m) => m.type === 'computers.result');
        if (list?.type === 'computers.result' && list.payload.computers.length === 2) (clearInterval(t), ok());
      }, 25);
    });

    phone.send({ type: 'session.create', payload: { title: 'Overlay chat' } });
    const created = await overlay.next('session.created');
    expect(created.type === 'session.created' && created.payload.session.title).toBe('Overlay chat');
    const sessionId = created.type === 'session.created' ? created.payload.session.sessionId : '';

    overlay.send({ type: 'session.list', payload: {} });
    const list = await overlay.next('session.list.result');
    expect(list.type === 'session.list.result' && list.payload.sessions.map((s) => s.sessionId)).toEqual([sessionId]);

    overlay.send({ type: 'session.history', payload: { sessionId } });
    const history = await overlay.next('session.history.result');
    expect(history.type === 'session.history.result' && history.payload).toEqual({ sessionId, events: [] });

    phone.send({ type: 'session.rename', payload: { sessionId, title: 'Renamed' } });
    const updated = await overlay.next('session.updated');
    expect(updated.type === 'session.updated' && updated.payload.session.title).toBe('Renamed');

    phone.send({ type: 'session.delete', payload: { sessionId } });
    await overlay.next('session.deleted');

    // A plain clipboard computer never hears about sessions and cannot read them.
    plain.send({ type: 'session.list', payload: {} });
    plain.send({ type: 'session.history', payload: { sessionId } });
    await new Promise((r) => setTimeout(r, 300));
    expect(plain.inbox.map((m) => m.type).filter((t) => t.startsWith('session.'))).toEqual([]);
  });
});
