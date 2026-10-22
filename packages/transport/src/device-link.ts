import {
  b64,
  challengeMessage,
  CounterSource,
  derivePairKeys,
  deviceToRelaySchema,
  openEnvelope,
  relayPaths,
  relayToDeviceSchema,
  ReplayGuard,
  sealEnvelope,
  sign,
  type DeviceToRelay,
  type Identity,
  type InnerMessage,
  type InnerMessageBody,
  type PairKeys,
  type PushHint,
  type RelayToDevice,
  type Role,
  type RosterEntry,
} from '@pocket/protocol';

export type WebSocketCtor = new (url: string) => WebSocket;

export interface DeviceLinkOptions {
  relayUrl: string;
  accountId: string;
  deviceId: string;
  role: Role;
  identity: Identity;
  /** Known peers and their X25519 public keys (base64). Messages from anyone else are dropped. */
  peers: Record<string, string>;
  WebSocket?: WebSocketCtor;
  replayState?: Record<string, number>;
  log?: (msg: string) => void;
}

export interface IncomingMessage {
  from: string;
  message: InnerMessage;
}

type Events = {
  message: (m: IncomingMessage) => void;
  presence: (deviceId: string, online: boolean) => void;
  roster: (roster: RosterEntry[]) => void;
  ready: (roster: RosterEntry[], online: string[]) => void;
  control: (frame: RelayToDevice) => void;
  disconnected: (reason: string) => void;
};

export function toWsUrl(relayUrl: string, path: string): string {
  const url = new URL(path, relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
  return url.toString();
}

/**
 * One authenticated, auto-reconnecting connection from a device to the relay,
 * with end-to-end encryption to each known peer.
 */
export class DeviceLink {
  private ws: WebSocket | null = null;
  private readonly keys = new Map<string, PairKeys>();
  private readonly counters = new CounterSource();
  private readonly replay = new ReplayGuard();
  private readonly listeners: { [K in keyof Events]: Set<Events[K]> } = {
    message: new Set(),
    presence: new Set(),
    roster: new Set(),
    ready: new Set(),
    control: new Set(),
    disconnected: new Set(),
  };
  private readonly onlinePeers = new Set<string>();
  private authed = false;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private relayUrl: string;

  constructor(private readonly opts: DeviceLinkOptions) {
    this.relayUrl = opts.relayUrl;
    for (const [deviceId, encPub] of Object.entries(opts.peers)) this.addPeer(deviceId, encPub);
    if (opts.replayState) this.replay.restore(opts.replayState);
  }

  get isReady(): boolean {
    return this.authed;
  }

  isOnline(deviceId: string): boolean {
    return this.onlinePeers.has(deviceId);
  }

  replayState(): Record<string, number> {
    return this.replay.snapshot();
  }

  addPeer(deviceId: string, encPub: string): void {
    this.keys.set(deviceId, derivePairKeys(this.opts.identity, this.opts.deviceId, b64.decode(encPub), deviceId));
  }

  removePeer(deviceId: string): void {
    this.keys.delete(deviceId);
  }

  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const fn of this.listeners[event]) (fn as (...a: Parameters<Events[K]>) => void)(...args);
  }

  get currentRelayUrl(): string {
    return this.relayUrl;
  }

  /** Switches to another relay address; an open connection is dropped and re-established there. */
  setRelayUrl(url: string): void {
    if (url === this.relayUrl) return;
    this.relayUrl = url;
    if (!this.closed && this.ws) this.ws.close(1000, 'relay moved');
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close(1000, 'closing');
    this.ws = null;
    this.authed = false;
  }

  /** Encrypts `body` for `to` and sends it. Returns false if the link is down or the peer is unknown. */
  send(to: string, body: InnerMessageBody, pushHint?: PushHint): boolean {
    const key = this.keys.get(to)?.tx;
    if (!key || !this.authed) return false;
    const env = sealEnvelope({ from: this.opts.deviceId, to, key, body, counter: this.counters.next(), pushHint });
    return this.sendFrame({ t: 'msg', env });
  }

  sendControl(frame: Exclude<DeviceToRelay, { t: 'hello' | 'auth' | 'msg' }>): boolean {
    return this.authed ? this.sendFrame(frame) : false;
  }

  private sendFrame(frame: DeviceToRelay): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(deviceToRelaySchema.parse(frame)));
    return true;
  }

  private open(): void {
    const Ctor = this.opts.WebSocket ?? (globalThis.WebSocket as WebSocketCtor | undefined);
    if (!Ctor) throw new Error('No WebSocket implementation available');
    const ws = new Ctor(toWsUrl(this.relayUrl, relayPaths.device(this.opts.accountId)));
    this.ws = ws;

    ws.onopen = () => {
      this.sendFrame({
        t: 'hello',
        v: 1,
        accountId: this.opts.accountId,
        deviceId: this.opts.deviceId,
        role: this.opts.role,
        ...(this.opts.role === 'brain' ? { signPub: b64.encode(this.opts.identity.signPub) } : {}),
      });
    };
    ws.onmessage = (ev) => this.handleFrame(String(ev.data));
    ws.onclose = (ev) => this.handleClose(`closed ${ev.code} ${ev.reason}`);
    ws.onerror = () => this.opts.log?.('relay socket error');
  }

  private handleClose(reason: string): void {
    const wasAuthed = this.authed;
    this.authed = false;
    this.ws = null;
    this.stopPing();
    this.onlinePeers.clear();
    if (wasAuthed) this.emit('disconnected', reason);
    if (this.closed) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.opts.log?.(`relay ${reason}; reconnecting in ${Math.round(delay)}ms`);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private handleFrame(raw: string): void {
    let frame: RelayToDevice;
    try {
      frame = relayToDeviceSchema.parse(JSON.parse(raw));
    } catch {
      this.opts.log?.('dropping malformed relay frame');
      return;
    }
    switch (frame.t) {
      case 'challenge': {
        const sig = sign(new TextEncoder().encode(challengeMessage(frame.nonce, this.opts.deviceId)), this.opts.identity.signSk);
        this.sendFrame({ t: 'auth', sig: b64.encode(sig) });
        return;
      }
      case 'ready':
        this.authed = true;
        this.attempt = 0;
        this.onlinePeers.clear();
        for (const id of frame.online) this.onlinePeers.add(id);
        this.startPing();
        this.emit('ready', frame.roster, frame.online);
        return;
      case 'presence':
        if (frame.online) this.onlinePeers.add(frame.deviceId);
        else this.onlinePeers.delete(frame.deviceId);
        this.emit('presence', frame.deviceId, frame.online);
        return;
      case 'roster':
        this.emit('roster', frame.roster);
        return;
      case 'msg':
        this.handleEnvelope(frame);
        return;
      case 'pong':
        return;
      default:
        this.emit('control', frame);
    }
  }

  private handleEnvelope(frame: Extract<RelayToDevice, { t: 'msg' }>): void {
    const { env } = frame;
    const key = this.keys.get(env.from)?.rx;
    if (!key || env.to !== this.opts.deviceId) {
      this.opts.log?.(`dropping message from unknown peer ${env.from}`);
      return;
    }
    let message: InnerMessage;
    try {
      message = openEnvelope(env, key);
    } catch {
      this.opts.log?.(`dropping undecryptable message from ${env.from}`);
      return;
    }
    if (!this.replay.accept(env.from, env.id, message.counter)) {
      this.opts.log?.(`dropping replayed message from ${env.from}`);
      return;
    }
    this.emit('message', { from: env.from, message });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendFrame({ t: 'ping' }), 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
