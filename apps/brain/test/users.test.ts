import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InnerMessage, InnerMessageBody, PairingCode } from '@pocket/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'pocket-users-'));
process.env.POCKET_HOME = home;
process.env.POCKET_LOG_DIR = join(home, 'logs');
process.env.POCKET_NO_KEYCHAIN = '1';

const { generateIdentity, MAC_DEVICE_ID, parsePairingCode, parsePairingUri } = await import('@pocket/protocol');
const { DeviceLink, joinAccount } = await import('@pocket/transport');
const { startNodeRelay } = await import('../../relay/src/node-server.js');
const { Brain } = await import('../src/daemon.js');
const { ensureDirs, OWNER_ID } = await import('../src/store.js');

type Relay = Awaited<ReturnType<typeof startNodeRelay>>;
type Link = InstanceType<typeof DeviceLink>;

let relay: Relay;
let brain: InstanceType<typeof Brain>;
const links: Link[] = [];

const until = <T>(what: string, fn: (resolve: (v: T) => void) => void, ms = 10_000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), ms);
    fn((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });

async function connect(code: PairingCode, role: 'executor' | 'client', name: string, userName?: string) {
  const joined = await joinAccount({ relayUrl: relay.url, code, role, name, userName });
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
  const next = <T extends InnerMessage['type']>(type: T, after = 0) =>
    until<Extract<InnerMessage, { type: T }>>(`${name} ← ${type}`, (resolve) => {
      const hit = inbox.slice(after).find((m) => m.type === type);
      if (hit) resolve(hit as Extract<InnerMessage, { type: T }>);
      else waiters.push({ match: (m) => m.type === type, resolve: (m) => resolve(m as Extract<InnerMessage, { type: T }>) });
    });
  return {
    deviceId: joined.deviceId,
    send: (body: InnerMessageBody) => link.send(brainId, body),
    inbox,
    next,
    /** Sends a request and returns the first reply of the given type that arrives after it. */
    ask: <T extends InnerMessage['type']>(body: InnerMessageBody, type: T) => {
      const mark = inbox.length;
      link.send(brainId, body);
      return next(type, mark);
    },
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
});

afterAll(async () => {
  for (const l of links) l.close();
  brain.stop();
  await relay.close();
});

describe('people', () => {
  it('keeps each person to their own chats, computers and the Mac', async () => {
    const owner = await connect(parsePairingUri(brain.startPairing().uri).code, 'client', 'owner-phone');
    const invite = brain.startPairing(undefined, { invite: {} });
    expect(invite.invite).toBe(true);
    expect(parsePairingUri(invite.uri).invite).toBe(true);
    const masha = await connect(parsePairingUri(invite.uri).code, 'client', 'masha-phone', 'Masha');
    expect(brain.users().map((u) => [u.name, u.owner === true, u.devices.length])).toEqual([[expect.any(String), true, 1], ['Masha', false, 1]]);

    // Each client learns who it is; only the owner gets the Mac as a place to work.
    const ownerStatus = await owner.ask({ type: 'status.get', payload: {} }, 'host.status');
    expect(ownerStatus.payload.user).toEqual({ id: OWNER_ID, name: expect.any(String), owner: true });
    const mashaStatus = await masha.ask({ type: 'status.get', payload: {} }, 'host.status');
    expect(mashaStatus.payload.user).toEqual({ id: expect.any(String), name: 'Masha', owner: false });
    const mashaId = mashaStatus.payload.user!.id;
    expect((await owner.ask({ type: 'computers.get', payload: {} }, 'computers.result')).payload.mac).toBeDefined();
    expect((await masha.ask({ type: 'computers.get', payload: {} }, 'computers.result')).payload.mac).toBeUndefined();

    // Chats are private.
    const created = await owner.ask({ type: 'session.create', payload: { title: 'Owner chat' } }, 'session.created');
    const ownerSession = created.payload.session.sessionId;
    expect(created.payload.session.userId).toBe(OWNER_ID);
    expect((await masha.ask({ type: 'session.list', payload: {} }, 'session.list.result')).payload.sessions).toEqual([]);
    expect((await masha.ask({ type: 'session.history', payload: { sessionId: ownerSession } }, 'error')).payload.code).toBe('unknown_session');
    expect((await owner.ask({ type: 'session.list', payload: {} }, 'session.list.result')).payload.sessions.map((s) => s.sessionId)).toEqual([ownerSession]);
    const mashaCreated = await masha.ask({ type: 'session.create', payload: { title: 'Masha chat' } }, 'session.created');
    expect(mashaCreated.payload.session.userId).toBe(mashaId);
    expect(owner.inbox.filter((m) => m.type === 'session.created').map((m) => m.type === 'session.created' && m.payload.session.title)).toEqual(['Owner chat']);

    // Without a computer of her own, Masha cannot run anything: chats never fall back to the Mac.
    expect((await masha.ask({ type: 'message.send', payload: { sessionId: mashaCreated.payload.session.sessionId, text: 'hi' } }, 'error')).payload.code).toBe('no_computer');
    expect((await masha.ask({ type: 'computer.select', payload: { deviceId: MAC_DEVICE_ID } }, 'error')).payload.code).toBe('not_owner');
    expect((await masha.ask({ type: 'user.invite', payload: {} }, 'error')).payload.code).toBe('not_owner');

    // A computer paired with a code from Masha's phone is hers alone.
    const pairing = await masha.ask({ type: 'computer.pair', payload: {} }, 'computer.pairing');
    const pc = await connect(parsePairingCode(pairing.payload.code), 'executor', 'masha-pc');
    pc.send({ type: 'executor.status', payload: { workspaces: ['C:\\\\work'], os: 'win32', shell: 'pwsh', capabilities: ['tools'] } });
    const mashaComputers = await masha.next('computers.result', masha.inbox.length);
    expect(mashaComputers.payload.computers.map((c) => c.name)).toEqual(['masha-pc']);
    expect((await owner.ask({ type: 'computers.get', payload: {} }, 'computers.result')).payload.computers).toEqual([]);
    expect((await owner.ask({ type: 'computer.select', payload: { deviceId: pc.deviceId } }, 'error')).payload.code).toBe('unknown_computer');
    expect((await owner.ask({ type: 'clipboard.get', payload: { requestId: 'r1', deviceId: pc.deviceId } }, 'clipboard.result')).payload.error).toMatch(/not paired/);
    expect(brain.users().find((u) => u.id === mashaId)?.devices.map((d) => d.name)).toEqual(['masha-phone', 'masha-pc']);

    // The owner's invite link from the phone registers people too.
    const invitation = await owner.ask({ type: 'user.invite', payload: {} }, 'user.invitation');
    const petya = await connect(parsePairingUri(invitation.payload.uri).code, 'client', 'petya-phone', 'Petya');
    expect((await petya.ask({ type: 'status.get', payload: {} }, 'host.status')).payload.user?.name).toBe('Petya');

    // Removing a person takes their devices and chats with them.
    expect(brain.removeUser('masha')).toBe(true);
    expect(brain.removeUser('owner')).toBe(false);
    expect(brain.users().map((u) => u.name)).toEqual([expect.any(String), 'Petya']);
    expect(brain.status().devices.map((d) => d.name)).toEqual(['owner-phone', 'petya-phone']);
    expect(brain.status().sessions.map((s) => s.title)).toEqual(['Owner chat']);
  });
});
