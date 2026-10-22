import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  b64,
  challengeMessage,
  deriveAccountId,
  deriveDeviceId,
  derivePairKeys,
  generateIdentity,
  newPairingCode,
  openPairRequest,
  parsePairingCode,
  sealEnvelope,
  sealPairReply,
  sign,
  type Identity,
  type InnerMessage,
  type PairingBundle,
  type PairingCode,
  type RelayToDevice,
  type RosterEntry,
} from '@pocket/protocol';
import { DeviceLink, joinAccount } from '@pocket/transport';
import { startNodeRelay, type NodeRelay } from '../src/node-server.js';

let relay: NodeRelay;
const links: DeviceLink[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => {
  relay = await startNodeRelay({ port: 0 });
});

afterEach(() => {
  for (const l of links.splice(0)) l.close();
  for (const s of sockets.splice(0)) s.close();
});

afterAll(async () => {
  await relay.close();
});

const TIMEOUT = 5000;

function waitFor<T>(
  subscribe: (resolve: (v: T) => void) => () => void,
  what: string,
  timeoutMs = TIMEOUT,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const off = subscribe((v) => {
      clearTimeout(timer);
      off();
      resolve(v);
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${what}`));
    }, timeoutMs);
  });
}

const ready = (link: DeviceLink) =>
  link.isReady
    ? Promise.resolve()
    : waitFor<void>((res) => link.on('ready', () => res()), 'ready');

const nextMessage = (link: DeviceLink, pred: (m: InnerMessage, from: string) => boolean = () => true) =>
  waitFor<{ from: string; message: InnerMessage }>(
    (res) => link.on('message', (m) => pred(m.message, m.from) && res(m)),
    'message',
  );

const nextControl = (link: DeviceLink, pred: (f: RelayToDevice) => boolean) =>
  waitFor<RelayToDevice>((res) => link.on('control', (f) => pred(f) && res(f)), 'control frame');

const nextPresence = (link: DeviceLink, deviceId: string, online: boolean) =>
  waitFor<void>((res) => link.on('presence', (id, on) => id === deviceId && on === online && res()), 'presence');

const nextDisconnect = (link: DeviceLink) => waitFor<string>((res) => link.on('disconnected', res), 'disconnected');

interface Brain {
  identity: Identity;
  deviceId: string;
  accountId: string;
  link: DeviceLink;
}

async function startBrain(): Promise<Brain> {
  const identity = generateIdentity();
  const deviceId = deriveDeviceId(identity.signPub);
  const accountId = deriveAccountId(identity.signPub);
  const link = new DeviceLink({ relayUrl: relay.url, accountId, deviceId, role: 'brain', identity, peers: {} });
  links.push(link);
  const r = ready(link);
  link.connect();
  await r;
  return { identity, deviceId, accountId, link };
}

interface Paired {
  identity: Identity;
  deviceId: string;
  role: 'executor' | 'client';
  link: DeviceLink;
}

/** Runs the full pairing handshake and returns a device whose link is created but not yet connected. */
async function pairDevice(brain: Brain, role: 'executor' | 'client', name = role): Promise<Paired> {
  const code = newPairingCode();
  const bundle: PairingBundle = {
    v: 1,
    accountId: brain.accountId,
    brainDeviceId: brain.deviceId,
    brainSignPub: b64.encode(brain.identity.signPub),
    brainEncPub: b64.encode(brain.identity.encPub),
    expiresAt: Date.now() + 300_000,
  };
  brain.link.sendControl({ t: 'pairing.publish', pairingId: code.pairingId, bundle });
  const off = brain.link.on('control', (f) => {
    if (f.t !== 'pair.incoming' || f.pairingId !== code.pairingId) return;
    const req = openPairRequest({ brain: brain.identity, code, blob: f.blob });
    brain.link.sendControl({
      t: 'roster.add',
      entry: { deviceId: req.deviceId, role: req.role as 'executor' | 'client', name: req.name, signPub: req.signPub },
    });
    brain.link.addPeer(req.deviceId, req.encPub);
    brain.link.sendControl({
      t: 'pair.reply',
      pairingId: code.pairingId,
      deviceId: req.deviceId,
      blob: sealPairReply({ ok: true, accountId: brain.accountId, brainDeviceId: brain.deviceId, roster: [] }, req.encPub),
    });
  });
  // The relay processes frames in order, but the bundle must be fetchable before joinAccount runs.
  await waitForBundle(code);
  try {
    const joined = await joinAccount({ relayUrl: relay.url, code, role, name });
    const link = new DeviceLink({
      relayUrl: relay.url,
      accountId: brain.accountId,
      deviceId: joined.deviceId,
      role,
      identity: joined.identity,
      peers: { [brain.deviceId]: joined.bundle.brainEncPub },
    });
    links.push(link);
    return { identity: joined.identity, deviceId: joined.deviceId, role, link };
  } finally {
    off();
  }
}

async function waitForBundle(code: PairingCode): Promise<void> {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const res = await fetch(`${relay.url}/v1/pairings/${code.pairingId}`);
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('pairing bundle never published');
}

async function connect(p: Paired): Promise<void> {
  const r = ready(p.link);
  p.link.connect();
  await r;
}

/** Minimal raw socket with a frame queue, to speak the relay protocol by hand. */
class RawSocket {
  readonly ws: WebSocket;
  readonly frames: Record<string, unknown>[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    sockets.push(this.ws);
    this.closed = new Promise((res) => {
      this.ws.addEventListener('close', (ev) => res({ code: ev.code, reason: ev.reason }));
    });
    this.ws.addEventListener('message', (ev) => {
      this.frames.push(JSON.parse(String(ev.data)));
      for (const w of this.waiters.splice(0)) w();
    });
  }

  opened(): Promise<void> {
    return waitFor<void>((res) => {
      this.ws.addEventListener('open', () => res(), { once: true });
      return () => {};
    }, 'socket open');
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }

  async next(t: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      const i = this.frames.findIndex((f) => f.t === t);
      if (i >= 0) return this.frames.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t} frame`);
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 50);
      });
    }
  }
}

const accountWs = (accountId: string) => `${relay.url.replace('http', 'ws')}/v1/accounts/${accountId}/ws`;

async function rawAuth(accountId: string, who: { identity: Identity; deviceId: string; role: string }): Promise<RawSocket> {
  const raw = new RawSocket(accountWs(accountId));
  await raw.opened();
  raw.send({ t: 'hello', v: 1, accountId, deviceId: who.deviceId, role: who.role });
  const challenge = await raw.next('challenge');
  const sig = sign(new TextEncoder().encode(challengeMessage(challenge.nonce as string, who.deviceId)), who.identity.signSk);
  raw.send({ t: 'auth', sig: b64.encode(sig) });
  await raw.next('ready');
  return raw;
}

/** Sends `n` numbered messages, pausing once so the relay's per-connection rate limit (burst 200) never drops any. */
async function sendPaced(link: DeviceLink, to: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (i === 100) await new Promise((r) => setTimeout(r, 250));
    link.send(to, { type: 'message.send', payload: { sessionId: 's', text: String(i) } });
  }
}

describe('relay', () => {
  it('1. brain bootstraps a new account and receives ready', async () => {
    const identity = generateIdentity();
    const deviceId = deriveDeviceId(identity.signPub);
    const accountId = deriveAccountId(identity.signPub);
    const link = new DeviceLink({ relayUrl: relay.url, accountId, deviceId, role: 'brain', identity, peers: {} });
    links.push(link);
    const r = waitFor<{ roster: RosterEntry[]; online: string[] }>(
      (res) => link.on('ready', (roster, online) => res({ roster, online })),
      'ready',
    );
    link.connect();
    const { roster, online } = await r;
    expect(roster).toEqual([{ deviceId, role: 'brain', name: 'brain', signPub: b64.encode(identity.signPub) }]);
    expect(online).toEqual([]);
    expect(link.isReady).toBe(true);
  });

  describe('2. hello validation', () => {
    it('rejects a hello whose deviceId is not derived from the presented key', async () => {
      const id = generateIdentity();
      const other = generateIdentity();
      const accountId = deriveAccountId(id.signPub);
      const raw = new RawSocket(accountWs(accountId));
      await raw.opened();
      raw.send({
        t: 'hello', v: 1, accountId, deviceId: deriveDeviceId(other.signPub), role: 'brain', signPub: b64.encode(id.signPub),
      });
      const closed = await raw.closed;
      expect(closed.code).toBe(4403);
    });

    it('rejects a hello whose accountId is not derived from the presented key', async () => {
      const id = generateIdentity();
      const other = generateIdentity();
      const accountId = deriveAccountId(other.signPub);
      const raw = new RawSocket(accountWs(accountId));
      await raw.opened();
      raw.send({
        t: 'hello', v: 1, accountId, deviceId: deriveDeviceId(id.signPub), role: 'brain', signPub: b64.encode(id.signPub),
      });
      const closed = await raw.closed;
      expect(closed.code).toBe(4403);
    });

    it('rejects a hello for another account than the socket path', async () => {
      const id = generateIdentity();
      const other = generateIdentity();
      const raw = new RawSocket(accountWs(deriveAccountId(other.signPub)));
      await raw.opened();
      raw.send({
        t: 'hello', v: 1, accountId: deriveAccountId(id.signPub), deviceId: deriveDeviceId(id.signPub), role: 'brain', signPub: b64.encode(id.signPub),
      });
      expect((await raw.closed).code).toBe(4400);
    });

    it('rejects a bad auth signature', async () => {
      const id = generateIdentity();
      const accountId = deriveAccountId(id.signPub);
      const deviceId = deriveDeviceId(id.signPub);
      const raw = new RawSocket(accountWs(accountId));
      await raw.opened();
      raw.send({ t: 'hello', v: 1, accountId, deviceId, role: 'brain', signPub: b64.encode(id.signPub) });
      const challenge = await raw.next('challenge');
      const wrong = sign(new TextEncoder().encode(challengeMessage(challenge.nonce as string, deviceId)), generateIdentity().signSk);
      raw.send({ t: 'auth', sig: b64.encode(wrong) });
      expect((await raw.closed).code).toBe(4401);
    });

    it('closes unauthenticated sockets that send traffic', async () => {
      const raw = new RawSocket(accountWs(deriveAccountId(generateIdentity().signPub)));
      await raw.opened();
      raw.send({ t: 'roster.remove', deviceId: 'x' });
      expect((await raw.closed).code).toBe(4401);
    });

    it('answers malformed frames with bad_frame', async () => {
      const raw = new RawSocket(accountWs(deriveAccountId(generateIdentity().signPub)));
      await raw.opened();
      raw.ws.send('not json');
      expect((await raw.next('error')).code).toBe('bad_frame');
    });
  });

  describe('3. pairing', () => {
    it('pairs an executor and a client and serves the bundle', async () => {
      const brain = await startBrain();
      const code = newPairingCode();
      const bundle: PairingBundle = {
        v: 1,
        accountId: brain.accountId,
        brainDeviceId: brain.deviceId,
        brainSignPub: b64.encode(brain.identity.signPub),
        brainEncPub: b64.encode(brain.identity.encPub),
        expiresAt: Date.now() + 300_000,
      };
      brain.link.sendControl({ t: 'pairing.publish', pairingId: code.pairingId, bundle });
      await waitForBundle(code);
      const res = await fetch(`${relay.url}/v1/pairings/${code.pairingId}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(bundle);
      // The human form of the code resolves to the same pairing id.
      expect(parsePairingCode(code.display).pairingId).toBe(code.pairingId);

      const executor = await pairDevice(brain, 'executor');
      const client = await pairDevice(brain, 'client');
      expect(executor.deviceId).toBe(deriveDeviceId(executor.identity.signPub));

      const rosterSeen = waitFor<RosterEntry[]>(
        (res2) => brain.link.on('roster', (r) => r.length === 3 && res2(r)),
        'roster of 3',
      ).catch(() => null);
      const r = ready(executor.link);
      executor.link.connect();
      await r;
      await rosterSeen;
      const roster = await new Promise<RosterEntry[]>((res2) => {
        const l = new DeviceLink({
          relayUrl: relay.url, accountId: brain.accountId, deviceId: client.deviceId, role: 'client',
          identity: client.identity, peers: {},
        });
        links.push(l);
        l.on('ready', (ro) => res2(ro));
        l.connect();
      });
      expect(roster.map((e) => e.role).sort()).toEqual(['brain', 'client', 'executor']);
    });

    it('returns 404 for unknown and expired pairing ids', async () => {
      const brain = await startBrain();
      expect((await fetch(`${relay.url}/v1/pairings/${'0'.repeat(24)}`)).status).toBe(404);

      const code = newPairingCode();
      brain.link.sendControl({
        t: 'pairing.publish',
        pairingId: code.pairingId,
        bundle: {
          v: 1, accountId: brain.accountId, brainDeviceId: brain.deviceId,
          brainSignPub: b64.encode(brain.identity.signPub), brainEncPub: b64.encode(brain.identity.encPub),
          expiresAt: Date.now() + 150,
        },
      });
      await waitForBundle(code);
      await new Promise((r) => setTimeout(r, 200));
      expect((await fetch(`${relay.url}/v1/pairings/${code.pairingId}`)).status).toBe(404);
    });

    it('returns 404 after the brain revokes a pairing', async () => {
      const brain = await startBrain();
      const code = newPairingCode();
      brain.link.sendControl({
        t: 'pairing.publish',
        pairingId: code.pairingId,
        bundle: {
          v: 1, accountId: brain.accountId, brainDeviceId: brain.deviceId,
          brainSignPub: b64.encode(brain.identity.signPub), brainEncPub: b64.encode(brain.identity.encPub),
          expiresAt: Date.now() + 300_000,
        },
      });
      await waitForBundle(code);
      brain.link.sendControl({ t: 'pairing.revoke', pairingId: code.pairingId });
      const deadline = Date.now() + TIMEOUT;
      let status = 200;
      while (status === 200 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
        status = (await fetch(`${relay.url}/v1/pairings/${code.pairingId}`)).status;
      }
      expect(status).toBe(404);
    });

    it('rejects joinAccount for an unknown code', async () => {
      await expect(joinAccount({ relayUrl: relay.url, code: newPairingCode(), role: 'client', name: 'x' })).rejects.toThrow(/not found/);
    });

    it('reports brain_offline on the pairing socket when the brain is gone', async () => {
      const brain = await startBrain();
      const code = newPairingCode();
      brain.link.sendControl({
        t: 'pairing.publish',
        pairingId: code.pairingId,
        bundle: {
          v: 1, accountId: brain.accountId, brainDeviceId: brain.deviceId,
          brainSignPub: b64.encode(brain.identity.signPub), brainEncPub: b64.encode(brain.identity.encPub),
          expiresAt: Date.now() + 300_000,
        },
      });
      await waitForBundle(code);
      brain.link.close();
      await new Promise((r) => setTimeout(r, 100));
      await expect(
        joinAccount({ relayUrl: relay.url, code, role: 'client', name: 'x', timeoutMs: 3000 }),
      ).rejects.toThrow(/offline/);
    });
  });

  describe('4. end-to-end messaging', () => {
    it('delivers client -> brain, brain -> executor and executor -> brain, plus presence', async () => {
      const brain = await startBrain();
      const executor = await pairDevice(brain, 'executor');
      const client = await pairDevice(brain, 'client');

      const execOnline = nextPresence(brain.link, executor.deviceId, true);
      await connect(executor);
      await execOnline;
      const clientOnline = nextPresence(brain.link, client.deviceId, true);
      await connect(client);
      await clientOnline;

      const atBrain = nextMessage(brain.link, (m) => m.type === 'message.send');
      expect(client.link.send(brain.deviceId, { type: 'message.send', payload: { sessionId: 's1', text: 'hello brain' } })).toBe(true);
      const got = await atBrain;
      expect(got.from).toBe(client.deviceId);
      expect(got.message).toMatchObject({ type: 'message.send', payload: { sessionId: 's1', text: 'hello brain' } });

      const atExec = nextMessage(executor.link, (m) => m.type === 'tool.call');
      brain.link.send(executor.deviceId, { type: 'tool.call', payload: { callId: 'c1', name: 'bash', args: { cmd: 'ls' } } });
      const call = await atExec;
      expect(call.from).toBe(brain.deviceId);
      expect(call.message).toMatchObject({ type: 'tool.call', payload: { callId: 'c1', name: 'bash', args: { cmd: 'ls' } } });

      const result = nextMessage(brain.link, (m) => m.type === 'tool.result');
      executor.link.send(brain.deviceId, { type: 'tool.result', payload: { callId: 'c1', content: 'ok', isError: false } });
      expect((await result).message).toMatchObject({ type: 'tool.result', payload: { callId: 'c1', content: 'ok', isError: false } });

      const execOffline = nextPresence(brain.link, executor.deviceId, false);
      executor.link.close();
      await execOffline;
      expect(brain.link.isOnline(executor.deviceId)).toBe(false);
      expect(brain.link.isOnline(client.deviceId)).toBe(true);

      const clientSeesBrainOffline = nextPresence(client.link, brain.deviceId, false);
      brain.link.close();
      await clientSeesBrainOffline;
    });

    it('lists already-connected peers in ready.online', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const online = waitFor<string[]>((res) => client.link.on('ready', (_r, on) => res(on)), 'ready');
      client.link.connect();
      expect(await online).toEqual([brain.deviceId]);
    });

    it('relays ciphertext only: the plaintext never appears on the wire', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      const spy = await rawAuth(brain.accountId, { identity: brain.identity, deviceId: brain.deviceId, role: 'brain' });
      // The raw brain replaces the link's socket server-side; the link is closed with 4409.
      const secret = 'top-secret-plaintext';
      const frame = spy.next('msg');
      const disc = nextDisconnect(brain.link);
      await disc;
      client.link.send(brain.deviceId, { type: 'message.send', payload: { sessionId: 's', text: secret } });
      expect(JSON.stringify(await frame)).not.toContain(secret);
    });
  });

  describe('5. authorization', () => {
    it('forbids client -> executor and executor -> client addressing', async () => {
      const brain = await startBrain();
      const executor = await pairDevice(brain, 'executor');
      const client = await pairDevice(brain, 'client');
      await connect(executor);
      await connect(client);
      // Peers are normally brain-only; add each other's keys to attempt the send anyway.
      client.link.addPeer(executor.deviceId, b64.encode(executor.identity.encPub));
      executor.link.addPeer(client.deviceId, b64.encode(client.identity.encPub));

      const err = nextControl(client.link, (f) => f.t === 'error');
      client.link.send(executor.deviceId, { type: 'tool.call', payload: { callId: 'x', name: 'bash', args: {} } });
      expect(await err).toMatchObject({ t: 'error', code: 'forbidden' });

      const err2 = nextControl(executor.link, (f) => f.t === 'error');
      executor.link.send(client.deviceId, { type: 'error', payload: { code: 'x', message: 'y' } });
      expect(await err2).toMatchObject({ t: 'error', code: 'forbidden' });
    });

    it('forbids non-brain devices from sending brain-only control frames', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      const err = nextControl(client.link, (f) => f.t === 'error');
      client.link.sendControl({ t: 'roster.remove', deviceId: brain.deviceId });
      expect(await err).toMatchObject({ t: 'error', code: 'forbidden' });
    });

    it('rejects an envelope whose from is not the sender', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const raw = await rawAuth(brain.accountId, { identity: client.identity, deviceId: client.deviceId, role: 'client' });
      const keys = derivePairKeys(client.identity, client.deviceId, brain.identity.encPub, brain.deviceId);
      const env = sealEnvelope({
        from: client.deviceId, to: brain.deviceId, key: keys.tx, counter: 1,
        body: { type: 'status.get', payload: {} },
      });
      raw.send({ t: 'msg', env: { ...env, from: 'someone-else' } });
      expect((await raw.next('error')).code).toBe('spoofed_from');
    });

    it('rejects unknown peers', async () => {
      const brain = await startBrain();
      const err = nextControl(brain.link, (f) => f.t === 'error');
      const ghost = generateIdentity();
      brain.link.addPeer(deriveDeviceId(ghost.signPub), b64.encode(ghost.encPub));
      brain.link.send(deriveDeviceId(ghost.signPub), { type: 'status.get', payload: {} });
      expect(await err).toMatchObject({ code: 'unknown_peer' });
    });

    it('refuses connections from a device that is not in the roster', async () => {
      const brain = await startBrain();
      const stranger = generateIdentity();
      const deviceId = deriveDeviceId(stranger.signPub);
      const raw = new RawSocket(accountWs(brain.accountId));
      await raw.opened();
      raw.send({ t: 'hello', v: 1, accountId: brain.accountId, deviceId, role: 'client' });
      expect((await raw.closed).code).toBe(4403);

      // The same through DeviceLink: it must never become ready.
      const link = new DeviceLink({
        relayUrl: relay.url, accountId: brain.accountId, deviceId, role: 'client', identity: stranger,
        peers: { [brain.deviceId]: b64.encode(brain.identity.encPub) },
      });
      links.push(link);
      let becameReady = false;
      link.on('ready', () => { becameReady = true; });
      link.connect();
      await new Promise((r) => setTimeout(r, 300));
      link.close();
      expect(becameReady).toBe(false);
    });

    it('refuses a rostered device that claims a different role', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const raw = new RawSocket(accountWs(brain.accountId));
      await raw.opened();
      raw.send({ t: 'hello', v: 1, accountId: brain.accountId, deviceId: client.deviceId, role: 'brain' });
      expect((await raw.closed).code).toBe(4403);
    });

    it('does not create an account for a non-brain hello', async () => {
      const id = generateIdentity();
      const raw = new RawSocket(accountWs(deriveAccountId(id.signPub)));
      await raw.opened();
      raw.send({ t: 'hello', v: 1, accountId: deriveAccountId(id.signPub), deviceId: deriveDeviceId(id.signPub), role: 'client' });
      expect((await raw.closed).code).toBe(4404);
    });

    it('rejects roster.add for a brain entry or a mismatched device id', async () => {
      const brain = await startBrain();
      const rogue = generateIdentity();
      brain.link.sendControl({
        t: 'roster.add',
        entry: { deviceId: deriveDeviceId(rogue.signPub), role: 'brain', name: 'evil', signPub: b64.encode(rogue.signPub) },
      });
      brain.link.sendControl({
        t: 'roster.add',
        entry: { deviceId: 'a'.repeat(32), role: 'client', name: 'bad id', signPub: b64.encode(rogue.signPub) },
      });
      // A fresh brain connection (replacing this one) shows the persisted roster.
      const link2 = new DeviceLink({
        relayUrl: relay.url, accountId: brain.accountId, deviceId: brain.deviceId, role: 'brain', identity: brain.identity, peers: {},
      });
      links.push(link2);
      const roster = waitFor<RosterEntry[]>((res) => link2.on('ready', (r) => res(r)), 'ready');
      link2.connect();
      expect((await roster).map((e) => e.deviceId)).toEqual([brain.deviceId]);
    });
  });

  describe('6. offline behaviour', () => {
    it('buffers brain -> client messages and delivers them on connect', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      brain.link.send(client.deviceId, { type: 'host.status', payload: { ready: true, executorOnline: false, workspaces: [] } });
      brain.link.send(client.deviceId, { type: 'session.list.result', payload: { sessions: [] } });

      const seen: string[] = [];
      const both = waitFor<void>((res) => client.link.on('message', (m) => {
        seen.push(m.message.type);
        if (seen.length === 2) res();
      }), 'buffered messages');
      client.link.connect();
      await both;
      expect(seen).toEqual(['host.status', 'session.list.result']);
    });

    it('drains the buffer only once', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      brain.link.send(client.deviceId, { type: 'status.get', payload: {} });
      let count = 0;
      client.link.on('message', () => count++);
      await connect(client);
      await new Promise((r) => setTimeout(r, 100));
      expect(count).toBe(1);
      client.link.close();
      const again = new DeviceLink({
        relayUrl: relay.url, accountId: brain.accountId, deviceId: client.deviceId, role: 'client',
        identity: client.identity, peers: { [brain.deviceId]: b64.encode(brain.identity.encPub) },
      });
      links.push(again);
      let count2 = 0;
      again.on('message', () => count2++);
      const r = ready(again);
      again.connect();
      await r;
      await new Promise((r2) => setTimeout(r2, 100));
      expect(count2).toBe(0);
    });

    it('replies peer_offline when the executor is offline', async () => {
      const brain = await startBrain();
      const executor = await pairDevice(brain, 'executor');
      const err = nextControl(brain.link, (f) => f.t === 'error');
      brain.link.send(executor.deviceId, { type: 'tool.call', payload: { callId: 'c', name: 'bash', args: {} } });
      expect(await err).toMatchObject({ t: 'error', code: 'peer_offline' });
    });

    it('does not buffer messages for an offline executor', async () => {
      const brain = await startBrain();
      const executor = await pairDevice(brain, 'executor');
      brain.link.send(executor.deviceId, { type: 'tool.call', payload: { callId: 'c', name: 'bash', args: {} } });
      let got = 0;
      executor.link.on('message', () => got++);
      await connect(executor);
      await new Promise((r) => setTimeout(r, 100));
      expect(got).toBe(0);
    });
  });

  describe('7. tampered ciphertext', () => {
    it('drops tampered envelopes at the receiver and still accepts valid ones afterwards', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const raw = await rawAuth(brain.accountId, { identity: client.identity, deviceId: client.deviceId, role: 'client' });
      const keys = derivePairKeys(client.identity, client.deviceId, brain.identity.encPub, brain.deviceId);
      const seal = (counter: number, text: string) =>
        sealEnvelope({
          from: client.deviceId, to: brain.deviceId, key: keys.tx, counter,
          body: { type: 'message.send', payload: { sessionId: 's', text } },
        });

      const received: string[] = [];
      brain.link.on('message', (m) => {
        if (m.message.type === 'message.send') received.push(m.message.payload.text);
      });
      const final = nextMessage(brain.link, (m) => m.type === 'message.send' && m.payload.text === 'valid');

      const good = seal(1, 'tampered');
      const ct = b64.decode(good.ct);
      ct[0] = ct[0]! ^ 0xff;
      raw.send({ t: 'msg', env: { ...good, ct: b64.encode(ct) } });
      // Valid ciphertext re-addressed under another id: AAD mismatch.
      raw.send({ t: 'msg', env: { ...seal(2, 'rebound'), id: 'ffffffffffffffff' } });
      raw.send({ t: 'msg', env: seal(3, 'valid') });
      await final;
      expect(received).toEqual(['valid']);
    });

    it('drops replayed envelopes', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const raw = await rawAuth(brain.accountId, { identity: client.identity, deviceId: client.deviceId, role: 'client' });
      const keys = derivePairKeys(client.identity, client.deviceId, brain.identity.encPub, brain.deviceId);
      const env = sealEnvelope({
        from: client.deviceId, to: brain.deviceId, key: keys.tx, counter: 10,
        body: { type: 'message.send', payload: { sessionId: 's', text: 'once' } },
      });
      const env2 = sealEnvelope({
        from: client.deviceId, to: brain.deviceId, key: keys.tx, counter: 11,
        body: { type: 'message.send', payload: { sessionId: 's', text: 'marker' } },
      });
      const texts: string[] = [];
      brain.link.on('message', (m) => {
        if (m.message.type === 'message.send') texts.push(m.message.payload.text);
      });
      const marker = nextMessage(brain.link, (m) => m.type === 'message.send' && m.payload.text === 'marker');
      raw.send({ t: 'msg', env });
      raw.send({ t: 'msg', env });
      raw.send({ t: 'msg', env: env2 });
      await marker;
      expect(texts).toEqual(['once', 'marker']);
    });
  });

  describe('8. ordering', () => {
    it('delivers 200 sequential brain -> client messages in order (online)', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      const N = 200;
      const seen: string[] = [];
      const done = waitFor<void>((res) => client.link.on('message', (m) => {
        if (m.message.type === 'message.send') seen.push(m.message.payload.text);
        if (seen.length === N) res();
      }), `${N} messages`, 15_000);
      await sendPaced(brain.link, client.deviceId, N);
      await done;
      expect(seen).toEqual(Array.from({ length: N }, (_, i) => String(i)));
    });

    it('delivers 200 buffered messages in order after reconnect', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      const N = 200;
      await sendPaced(brain.link, client.deviceId, N);
      const seen: string[] = [];
      const done = waitFor<void>((res) => client.link.on('message', (m) => {
        if (m.message.type === 'message.send') seen.push(m.message.payload.text);
        if (seen.length === N) res();
      }), `${N} buffered messages`, 15_000);
      client.link.connect();
      await done;
      expect(seen).toEqual(Array.from({ length: N }, (_, i) => String(i)));
    });
  });

  describe('rate limiting', () => {
    it('never throttles the brain', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      let delivered = 0;
      const all = new Promise<void>((resolve) =>
        client.link.on('message', () => {
          if (++delivered === 400) resolve();
        }),
      );
      for (let i = 0; i < 400; i++) {
        brain.link.send(client.deviceId, { type: 'message.send', payload: { sessionId: 's', text: String(i) } });
      }
      await all;
      expect(delivered).toBe(400);
    });

    it('answers an over-burst flood from a client with rate_limited and drops the excess', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      let delivered = 0;
      brain.link.on('message', () => delivered++);
      const limited = nextControl(client.link, (f) => f.t === 'error' && f.code === 'rate_limited');
      for (let i = 0; i < 400; i++) {
        client.link.send(brain.deviceId, { type: 'message.send', payload: { sessionId: 's', text: String(i) } });
      }
      await limited;
      await new Promise((r) => setTimeout(r, 300));
      expect(delivered).toBeLessThan(400);
    });
  });

  describe('9. roster.remove', () => {
    it('kicks the removed device and refuses its reconnect', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      const closed = nextDisconnect(client.link);
      const rosterUpdate = waitFor<RosterEntry[]>((res) => brain.link.on('roster', res), 'roster update');
      brain.link.sendControl({ t: 'roster.remove', deviceId: client.deviceId });
      expect(await closed).toContain('4403');
      expect((await rosterUpdate).map((e) => e.deviceId)).toEqual([brain.deviceId]);
      client.link.close();

      const raw = new RawSocket(accountWs(brain.accountId));
      await raw.opened();
      raw.send({ t: 'hello', v: 1, accountId: brain.accountId, deviceId: client.deviceId, role: 'client' });
      expect((await raw.closed).code).toBe(4403);
    });

    it('does not remove the brain', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      await connect(client);
      const rosters: RosterEntry[][] = [];
      client.link.on('roster', (r) => rosters.push(r));
      brain.link.sendControl({ t: 'roster.remove', deviceId: brain.deviceId });
      await new Promise((r) => setTimeout(r, 150));
      expect(rosters).toEqual([]);
      expect(client.link.isReady).toBe(true);
    });

    it('discards the removed device\'s buffered messages', async () => {
      const brain = await startBrain();
      const client = await pairDevice(brain, 'client');
      brain.link.send(client.deviceId, { type: 'status.get', payload: {} });
      const rosterUpdate = waitFor<RosterEntry[]>((res) => brain.link.on('roster', res), 'roster update');
      brain.link.sendControl({ t: 'roster.remove', deviceId: client.deviceId });
      await rosterUpdate;
      // Re-adding the same device must not surface the old buffer.
      brain.link.sendControl({
        t: 'roster.add',
        entry: { deviceId: client.deviceId, role: 'client', name: 'again', signPub: b64.encode(client.identity.signPub) },
      });
      await waitFor<RosterEntry[]>((res) => brain.link.on('roster', res), 'roster re-add');
      let got = 0;
      client.link.on('message', () => got++);
      await connect(client);
      await new Promise((r) => setTimeout(r, 100));
      expect(got).toBe(0);
    });
  });

  it('replaces an older connection of the same device with 4409', async () => {
    const brain = await startBrain();
    const dup = new DeviceLink({
      relayUrl: relay.url, accountId: brain.accountId, deviceId: brain.deviceId, role: 'brain', identity: brain.identity, peers: {},
    });
    links.push(dup);
    const first = nextDisconnect(brain.link);
    dup.connect();
    expect(await first).toContain('4409');
    await ready(dup);
  });

  it('serves /healthz and 404s elsewhere', async () => {
    expect((await fetch(`${relay.url}/healthz`)).status).toBe(200);
    expect((await fetch(`${relay.url}/nope`)).status).toBe(404);
  });
});
