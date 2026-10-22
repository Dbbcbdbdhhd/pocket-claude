import {
  b64,
  challengeMessage,
  deriveAccountId,
  deriveDeviceId,
  deviceToRelaySchema,
  pairingClientFrameSchema,
  randomBytes,
  utf8,
  verify,
  type DeviceToRelay,
  type PairingBundle,
  type PairingServerFrame,
  type PushHint,
  type RelayToDevice,
  type RosterEntry,
  type WireEnvelope,
} from '@pocket/protocol';

/** One frame carries a whole clipboard item or photo, so leave room for ~20 MB of payload after base64. */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;
/** Large frames are delivered live only; the offline buffer keeps chat-sized messages. */
export const MAX_BUFFERED_ENVELOPE_CHARS = 256 * 1024;
export const BUFFER_LIMIT = 500;
export const BUFFER_TTL_MS = 24 * 60 * 60_000;
const RATE_PER_SEC = 50;
const RATE_BURST = 200;

export type ConnState =
  | { kind: 'device'; authed: boolean; deviceId?: string; role?: RosterEntry['role']; nonce?: string; tokens: number; refill: number }
  | { kind: 'pairing'; pairingId: string; deviceId?: string };

/** A live socket. Its state must survive Durable Object hibernation, so it is kept on the connection itself. */
export interface Conn {
  send(text: string): void;
  close(code: number, reason: string): void;
  getState(): ConnState;
  setState(state: ConnState): void;
}

export interface AccountRecord {
  accountId: string;
  roster: RosterEntry[];
  fcmTokens: Record<string, string>;
  pairings: Record<string, PairingBundle>;
}

interface Buffered {
  at: number;
  env: WireEnvelope;
}

export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RoomHost {
  storage: Storage;
  connections(): Conn[];
  /** Makes a pairing id resolvable globally (GET /pairings/:id → bundle, pairing socket → this room). */
  publishPairing(pairingId: string, bundle: PairingBundle | null): Promise<void>;
  push?(fcmToken: string, hint: PushHint): Promise<void>;
  now?(): number;
}

/** All relay logic for one account. Stateless between calls apart from `host.storage` and per-connection state. */
export class AccountRoom {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly accountId: string,
    private readonly host: RoomHost,
  ) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private async load(): Promise<AccountRecord | undefined> {
    return this.host.storage.get<AccountRecord>('account');
  }

  private async save(record: AccountRecord): Promise<void> {
    await this.host.storage.put('account', record);
  }

  /** Events are processed strictly in arrival order so streamed messages are never reordered. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  onOpen(conn: Conn, pairingId?: string): Promise<void> {
    return this.serial(() => this.handleOpen(conn, pairingId));
  }

  onMessage(conn: Conn, raw: string): Promise<void> {
    return this.serial(() => this.handleMessage(conn, raw));
  }

  onClose(conn: Conn): Promise<void> {
    return this.serial(() => this.handleClose(conn));
  }

  private async handleOpen(conn: Conn, pairingId?: string): Promise<void> {
    if (pairingId) {
      const record = await this.load();
      const bundle = record?.pairings[pairingId];
      if (!bundle || bundle.expiresAt < this.now()) {
        sendPairing(conn, { t: 'error', code: 'pairing_expired', message: 'Pairing code not found or expired' });
        conn.close(4404, 'pairing expired');
        return;
      }
      conn.setState({ kind: 'pairing', pairingId });
      return;
    }
    conn.setState({ kind: 'device', authed: false, tokens: RATE_BURST, refill: this.now() });
  }

  private async handleMessage(conn: Conn, raw: string): Promise<void> {
    if (raw.length > MAX_FRAME_BYTES) {
      conn.close(1009, 'frame too large');
      return;
    }
    const state = conn.getState();
    if (state.kind === 'pairing') return this.onPairingFrame(conn, state, raw);

    if (state.role !== 'brain' && !this.takeToken(conn, state)) {
      send(conn, { t: 'error', code: 'rate_limited', message: 'Too many messages' });
      return;
    }
    let frame: DeviceToRelay;
    try {
      frame = deviceToRelaySchema.parse(JSON.parse(raw));
    } catch {
      send(conn, { t: 'error', code: 'bad_frame', message: 'Malformed frame' });
      return;
    }

    if (frame.t === 'hello') return this.onHello(conn, state, frame);
    if (frame.t === 'auth') return this.onAuth(conn, state, frame.sig);
    if (frame.t === 'ping') return send(conn, { t: 'pong' });
    if (!state.authed || !state.deviceId) {
      conn.close(4401, 'not authenticated');
      return;
    }
    const me = { deviceId: state.deviceId, role: state.role! };

    switch (frame.t) {
      case 'msg':
        return this.route(conn, me, frame.env);
      case 'push.register': {
        const record = await this.load();
        if (!record || me.role !== 'client') return;
        record.fcmTokens[me.deviceId] = frame.fcmToken;
        return this.save(record);
      }
      default:
        if (me.role !== 'brain') {
          send(conn, { t: 'error', code: 'forbidden', message: `${frame.t} is brain-only` });
          return;
        }
        return this.onBrainControl(frame);
    }
  }

  private async handleClose(conn: Conn): Promise<void> {
    const state = conn.getState();
    if (state.kind !== 'device' || !state.authed || !state.deviceId) return;
    const stillOnline = this.authedConns().some((c) => c !== conn && deviceOf(c) === state.deviceId);
    if (!stillOnline) this.broadcast({ t: 'presence', deviceId: state.deviceId, online: false }, conn);
  }

  private async onHello(conn: Conn, state: Extract<ConnState, { kind: 'device' }>, hello: Extract<DeviceToRelay, { t: 'hello' }>) {
    if (state.authed || hello.accountId !== this.accountId) {
      conn.close(4400, 'bad hello');
      return;
    }
    let record = await this.load();
    if (!record) {
      // The account is created by its brain: ids must be derived from the key it presents.
      if (hello.role !== 'brain' || !hello.signPub) {
        conn.close(4404, 'unknown account');
        return;
      }
      const signPub = b64.decode(hello.signPub);
      if (deriveAccountId(signPub) !== this.accountId || deriveDeviceId(signPub) !== hello.deviceId) {
        conn.close(4403, 'ids do not match key');
        return;
      }
      record = {
        accountId: this.accountId,
        roster: [{ deviceId: hello.deviceId, role: 'brain', name: 'brain', signPub: hello.signPub }],
        fcmTokens: {},
        pairings: {},
      };
      await this.save(record);
    }
    const entry = record.roster.find((e) => e.deviceId === hello.deviceId);
    if (!entry || entry.role !== hello.role) {
      conn.close(4403, 'device not paired');
      return;
    }
    const nonce = b64.encode(randomBytes(32));
    conn.setState({ ...state, deviceId: hello.deviceId, role: hello.role, nonce });
    send(conn, { t: 'challenge', nonce });
  }

  private async onAuth(conn: Conn, state: Extract<ConnState, { kind: 'device' }>, sig: string) {
    const record = await this.load();
    const entry = record?.roster.find((e) => e.deviceId === state.deviceId);
    if (!record || !entry || !state.nonce || state.authed) {
      conn.close(4401, 'unexpected auth');
      return;
    }
    const ok = verify(b64.decode(sig), utf8(challengeMessage(state.nonce, entry.deviceId)), b64.decode(entry.signPub));
    if (!ok) {
      conn.close(4401, 'bad signature');
      return;
    }
    for (const other of this.authedConns()) {
      if (deviceOf(other) === entry.deviceId) other.close(4409, 'replaced by newer connection');
    }
    conn.setState({ ...state, authed: true, nonce: undefined });
    const online = [...new Set(this.authedConns().map(deviceOf).filter((d): d is string => !!d && d !== entry.deviceId))];
    send(conn, { t: 'ready', roster: record.roster, online });
    this.broadcast({ t: 'presence', deviceId: entry.deviceId, online: true }, conn);
    await this.drainBuffer(conn, entry.deviceId);
  }

  private async route(conn: Conn, me: { deviceId: string; role: RosterEntry['role'] }, env: WireEnvelope) {
    if (env.from !== me.deviceId) {
      send(conn, { t: 'error', code: 'spoofed_from', message: 'from does not match connection' });
      return;
    }
    const record = await this.load();
    const target = record?.roster.find((e) => e.deviceId === env.to);
    if (!record || !target) {
      send(conn, { t: 'error', code: 'unknown_peer', message: `Unknown device ${env.to}` });
      return;
    }
    // Only the brain talks to everyone; executors and clients talk to the brain only.
    if (me.role !== 'brain' && target.role !== 'brain') {
      send(conn, { t: 'error', code: 'forbidden', message: 'Only the brain may be addressed' });
      return;
    }
    const delivered = this.authedConns().filter((c) => deviceOf(c) === env.to);
    for (const c of delivered) send(c, { t: 'msg', env });
    if (delivered.length > 0) return;

    if (target.role === 'client') {
      if (env.ct.length > MAX_BUFFERED_ENVELOPE_CHARS) {
        send(conn, { t: 'error', code: 'peer_offline', message: 'The device is offline; large items are not queued' });
        return;
      }
      await this.buffer(env.to, env);
      const token = record.fcmTokens[env.to];
      if (token && env.pushHint && this.host.push) await this.host.push(token, env.pushHint);
      return;
    }
    send(conn, { t: 'error', code: 'peer_offline', message: `${target.role} is offline` });
  }

  private async onBrainControl(frame: Exclude<DeviceToRelay, { t: 'hello' | 'auth' | 'msg' | 'ping' | 'push.register' }>) {
    const record = await this.load();
    if (!record) return;
    switch (frame.t) {
      case 'pairing.publish': {
        const brain = record.roster.find((e) => e.role === 'brain');
        if (frame.bundle.accountId !== this.accountId || frame.bundle.brainDeviceId !== brain?.deviceId) return;
        for (const [id, b] of Object.entries(record.pairings)) if (b.expiresAt < this.now()) delete record.pairings[id];
        record.pairings[frame.pairingId] = frame.bundle;
        await this.save(record);
        await this.host.publishPairing(frame.pairingId, frame.bundle);
        return;
      }
      case 'pairing.revoke':
        delete record.pairings[frame.pairingId];
        await this.save(record);
        await this.host.publishPairing(frame.pairingId, null);
        return;
      case 'roster.add': {
        if (frame.entry.role === 'brain' || deriveDeviceId(b64.decode(frame.entry.signPub)) !== frame.entry.deviceId) return;
        record.roster = [...record.roster.filter((e) => e.deviceId !== frame.entry.deviceId), frame.entry];
        await this.save(record);
        this.broadcast({ t: 'roster', roster: record.roster });
        return;
      }
      case 'roster.remove': {
        const removed = record.roster.find((e) => e.deviceId === frame.deviceId);
        if (!removed || removed.role === 'brain') return;
        record.roster = record.roster.filter((e) => e.deviceId !== frame.deviceId);
        delete record.fcmTokens[frame.deviceId];
        await this.save(record);
        await this.host.storage.delete(bufferKey(frame.deviceId));
        for (const c of this.authedConns()) if (deviceOf(c) === frame.deviceId) c.close(4403, 'device removed');
        this.broadcast({ t: 'roster', roster: record.roster });
        return;
      }
      case 'pair.reply':
        for (const c of this.host.connections()) {
          const s = c.getState();
          if (s.kind === 'pairing' && s.pairingId === frame.pairingId && s.deviceId === frame.deviceId) {
            sendPairing(c, { t: 'pair.reply', blob: frame.blob });
            c.close(1000, 'paired');
          }
        }
        return;
    }
  }

  private async onPairingFrame(conn: Conn, state: Extract<ConnState, { kind: 'pairing' }>, raw: string) {
    if (state.deviceId) return;
    let frame;
    try {
      frame = pairingClientFrameSchema.parse(JSON.parse(raw));
    } catch {
      conn.close(4400, 'bad pairing frame');
      return;
    }
    const record = await this.load();
    const bundle = record?.pairings[state.pairingId];
    if (!bundle || bundle.expiresAt < this.now()) {
      sendPairing(conn, { t: 'error', code: 'pairing_expired', message: 'Pairing code expired' });
      conn.close(4404, 'pairing expired');
      return;
    }
    const brain = this.authedConns().find((c) => deviceOf(c) === bundle.brainDeviceId);
    if (!brain) {
      sendPairing(conn, { t: 'error', code: 'brain_offline', message: 'The Mac is offline' });
      conn.close(4503, 'brain offline');
      return;
    }
    conn.setState({ ...state, deviceId: frame.deviceId });
    send(brain, { t: 'pair.incoming', pairingId: state.pairingId, deviceId: frame.deviceId, blob: frame.blob });
  }

  private async buffer(deviceId: string, env: WireEnvelope): Promise<void> {
    const cutoff = this.now() - BUFFER_TTL_MS;
    const items = ((await this.host.storage.get<Buffered[]>(bufferKey(deviceId))) ?? []).filter((b) => b.at >= cutoff);
    items.push({ at: this.now(), env });
    await this.host.storage.put(bufferKey(deviceId), items.slice(-BUFFER_LIMIT));
  }

  private async drainBuffer(conn: Conn, deviceId: string): Promise<void> {
    const items = await this.host.storage.get<Buffered[]>(bufferKey(deviceId));
    if (!items?.length) return;
    await this.host.storage.delete(bufferKey(deviceId));
    const cutoff = this.now() - BUFFER_TTL_MS;
    for (const b of items) if (b.at >= cutoff) send(conn, { t: 'msg', env: b.env });
  }

  private authedConns(): Conn[] {
    return this.host.connections().filter((c) => {
      const s = c.getState();
      return s.kind === 'device' && s.authed;
    });
  }

  private broadcast(frame: RelayToDevice, except?: Conn): void {
    for (const c of this.authedConns()) if (c !== except) send(c, frame);
  }

  private takeToken(conn: Conn, state: Extract<ConnState, { kind: 'device' }>): boolean {
    const now = this.now();
    const tokens = Math.min(RATE_BURST, state.tokens + ((now - state.refill) / 1000) * RATE_PER_SEC);
    if (tokens < 1) return false;
    conn.setState({ ...state, tokens: tokens - 1, refill: now });
    return true;
  }
}

const bufferKey = (deviceId: string) => `buffer:${deviceId}`;

function deviceOf(conn: Conn): string | undefined {
  const s = conn.getState();
  return s.kind === 'device' ? s.deviceId : undefined;
}

function send(conn: Conn, frame: RelayToDevice): void {
  try {
    conn.send(JSON.stringify(frame));
  } catch {
    // socket already closed
  }
}

function sendPairing(conn: Conn, frame: PairingServerFrame): void {
  try {
    conn.send(JSON.stringify(frame));
  } catch {
    // socket already closed
  }
}
