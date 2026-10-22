import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Every VS Code window runs its own copy of the extension, but the relay accepts one connection per device.
 * One window becomes the leader and owns the relay links; the others attach to it over a local pipe,
 * report their open folders and drive the chat panel through it. When the leader closes, another window takes over.
 */
export type WindowMessage =
  | { t: 'hello'; token: string; folders: string[] }
  | { t: 'folders'; folders: string[] }
  | { t: 'intent'; intent: unknown }
  | { t: 'kill' };

export type LeaderMessage = { t: 'state'; state: unknown } | { t: 'welcome' };

export interface Follower {
  readonly id: number;
  folders: string[];
  send(msg: LeaderMessage): void;
}

export interface CoordinatorEvents {
  becameLeader(): void;
  becameFollower(): void;
  followersChanged(): void;
  followerMessage(from: Follower, msg: WindowMessage): void;
  leaderMessage(msg: LeaderMessage): void;
}

export function defaultPipePath(): string {
  const user = (os.userInfo().username || 'user').replace(/[^\w.-]/g, '_');
  return process.platform === 'win32' ? `\\\\.\\pipe\\pocket-claude-${user}` : path.join(os.tmpdir(), `pocket-claude-${user}.sock`);
}

function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
    if (buf.length > 4 * 1024 * 1024) buf = '';
  };
}

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class Coordinator {
  role: 'starting' | 'leader' | 'follower' = 'starting';
  private server: net.Server | undefined;
  private socket: net.Socket | undefined;
  private readonly followers = new Map<net.Socket, Follower>();
  private nextId = 1;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly opts: {
      pipePath: string;
      /** Shared secret in the user's private storage so other local accounts can't attach. */
      tokenFile: string;
      folders: () => string[];
      events: CoordinatorEvents;
      log: (m: string) => void;
    },
  ) {}

  start(): void {
    this.elect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const s of this.followers.keys()) s.destroy();
    this.followers.clear();
    this.server?.close();
    this.socket?.destroy();
  }

  allFollowers(): Follower[] {
    return [...this.followers.values()];
  }

  broadcast(msg: LeaderMessage): void {
    for (const f of this.followers.values()) f.send(msg);
  }

  /** Follower → leader. */
  send(msg: WindowMessage): boolean {
    if (this.role !== 'follower' || !this.socket || this.socket.destroyed) return false;
    this.socket.write(`${JSON.stringify(msg)}\n`);
    return true;
  }

  foldersChanged(): void {
    if (this.role === 'follower') this.send({ t: 'folders', folders: this.opts.folders() });
    else if (this.role === 'leader') this.opts.events.followersChanged();
  }

  private token(create: boolean): string | undefined {
    try {
      return readFileSync(this.opts.tokenFile, 'utf8').trim() || undefined;
    } catch {
      if (!create) return undefined;
      const token = randomBytes(24).toString('base64url');
      mkdirSync(path.dirname(this.opts.tokenFile), { recursive: true });
      writeFileSync(this.opts.tokenFile, token, { mode: 0o600 });
      return token;
    }
  }

  private elect(): void {
    if (this.disposed) return;
    const server = net.createServer((socket) => this.accept(socket));
    server.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EADDRINUSE') {
        this.opts.log(`coordinator: ${e.message}`);
        return this.retry();
      }
      this.follow(true);
    });
    server.listen(this.opts.pipePath, () => {
      this.server = server;
      this.token(true);
      this.role = 'leader';
      this.opts.log('this window owns the connection');
      this.opts.events.becameLeader();
    });
  }

  private follow(staleCheck: boolean): void {
    const socket = net.createConnection(this.opts.pipePath);
    let reelected = false;
    socket.once('connect', () => {
      const token = this.token(false);
      if (!token) {
        socket.destroy();
        return this.retry();
      }
      this.socket = socket;
      this.role = 'follower';
      socket.write(`${JSON.stringify({ t: 'hello', token, folders: this.opts.folders() } satisfies WindowMessage)}\n`);
      this.opts.log('another window owns the connection; attached to it');
      this.opts.events.becameFollower();
    });
    socket.on(
      'data',
      lineReader((line) => {
        try {
          this.opts.events.leaderMessage(JSON.parse(line) as LeaderMessage);
        } catch {}
      }),
    );
    socket.once('error', (e: NodeJS.ErrnoException) => {
      if (staleCheck && process.platform !== 'win32' && (e.code === 'ECONNREFUSED' || e.code === 'ENOENT')) {
        try {
          unlinkSync(this.opts.pipePath);
        } catch {}
        reelected = true;
        return this.elect();
      }
    });
    socket.once('close', () => {
      if (reelected) return;
      if (this.socket !== socket) return this.retry();
      this.socket = undefined;
      this.opts.log('leader window went away');
      this.retry();
    });
  }

  private retry(): void {
    if (this.disposed || this.retryTimer) return;
    this.role = 'starting';
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.elect();
    }, 150 + Math.floor(Math.random() * 500));
  }

  private accept(socket: net.Socket): void {
    let follower: Follower | undefined;
    socket.on(
      'data',
      lineReader((line) => {
        let msg: WindowMessage;
        try {
          msg = JSON.parse(line) as WindowMessage;
        } catch {
          return;
        }
        if (!follower) {
          const token = this.token(false);
          if (msg.t !== 'hello' || typeof msg.token !== 'string' || !token || !sameToken(msg.token, token)) {
            socket.destroy();
            return;
          }
          follower = {
            id: this.nextId++,
            folders: Array.isArray(msg.folders) ? msg.folders.filter((f): f is string => typeof f === 'string') : [],
            send: (m) => {
              if (!socket.destroyed) socket.write(`${JSON.stringify(m)}\n`);
            },
          };
          this.followers.set(socket, follower);
          follower.send({ t: 'welcome' });
          this.opts.events.followersChanged();
          return;
        }
        if (msg.t === 'folders' && Array.isArray(msg.folders)) {
          follower.folders = msg.folders.filter((f): f is string => typeof f === 'string');
          this.opts.events.followersChanged();
          return;
        }
        this.opts.events.followerMessage(follower, msg);
      }),
    );
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (this.followers.delete(socket)) this.opts.events.followersChanged();
    });
  }
}
