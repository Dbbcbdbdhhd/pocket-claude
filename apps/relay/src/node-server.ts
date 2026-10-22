import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PairingBundle } from '@pocket/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { AccountRoom, MAX_FRAME_BYTES, type Conn, type ConnState, type Storage } from './core.js';

class MapStorage implements Storage {
  private readonly data: Map<string, unknown>;

  constructor(private readonly file?: string) {
    let initial: Record<string, unknown> = {};
    if (file) {
      try {
        initial = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        initial = {};
      }
    }
    this.data = new Map(Object.entries(initial));
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
    this.flush();
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
    this.flush();
  }

  private flush(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data)));
  }
}

class WsConn implements Conn {
  private state: ConnState = { kind: 'device', authed: false, tokens: 0, refill: 0 };
  constructor(readonly ws: WebSocket) {}
  send(text: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(text);
  }
  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
  getState(): ConnState {
    return this.state;
  }
  setState(state: ConnState): void {
    this.state = state;
  }
}

export interface NodeRelay {
  server: Server;
  url: string;
  close(): Promise<void>;
}

/** Self-hosted relay for development, tests, or running on your own box behind a tunnel. */
export async function startNodeRelay(opts: { port?: number; host?: string; dataDir?: string } = {}): Promise<NodeRelay> {
  const rooms = new Map<string, { room: AccountRoom; conns: Set<WsConn> }>();
  const pairings = new Map<string, { accountId: string; bundle: PairingBundle }>();
  if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });

  const roomFor = (accountId: string) => {
    let entry = rooms.get(accountId);
    if (!entry) {
      const conns = new Set<WsConn>();
      const storage = new MapStorage(opts.dataDir ? join(opts.dataDir, `${accountId}.json`) : undefined);
      const room = new AccountRoom(accountId, {
        storage,
        connections: () => [...conns],
        publishPairing: async (pairingId, bundle) => {
          if (bundle) pairings.set(pairingId, { accountId, bundle });
          else pairings.delete(pairingId);
        },
      });
      entry = { room, conns };
      rooms.set(accountId, entry);
    }
    return entry;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    const pairing = url.pathname.match(/^\/v1\/pairings\/([0-9a-f]{24})$/);
    if (req.method === 'GET' && pairing) {
      const p = pairings.get(pairing[1]!);
      if (!p || p.bundle.expiresAt < Date.now()) {
        res.writeHead(404, { 'access-control-allow-origin': '*' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify(p.bundle));
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    const account = url.pathname.match(/^\/v1\/accounts\/([0-9a-f]{32})\/ws$/);
    const pairing = url.pathname.match(/^\/v1\/pairings\/([0-9a-f]{24})\/ws$/);
    let accountId: string | undefined;
    let pairingId: string | undefined;
    if (account) accountId = account[1];
    else if (pairing) {
      pairingId = pairing[1];
      accountId = pairings.get(pairingId!)?.accountId;
      if (!accountId) {
        ws.send(JSON.stringify({ t: 'error', code: 'pairing_expired', message: 'Pairing code not found or expired' }));
        ws.close(4404, 'pairing expired');
        return;
      }
    }
    if (!accountId) {
      ws.close(4404, 'not found');
      return;
    }
    const { room, conns } = roomFor(accountId);
    const conn = new WsConn(ws);
    conns.add(conn);
    const opened = room.onOpen(conn, pairingId);
    ws.on('message', (data) => void opened.then(() => room.onMessage(conn, data.toString())));
    ws.on('close', () => {
      conns.delete(conn);
      void room.onClose(conn);
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 8787;
  return {
    server,
    url: `http://${opts.host ?? '127.0.0.1'}:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  const relay = await startNodeRelay({ port, host, dataDir: process.env.DATA_DIR ?? '.relay-data' });
  console.log(`pocket relay listening on ${relay.url}`);
}
