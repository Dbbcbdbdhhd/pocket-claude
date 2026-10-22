import { DurableObject } from 'cloudflare:workers';
import type { PairingBundle } from '@pocket/protocol';
import { AccountRoom, MAX_FRAME_BYTES, type Conn, type ConnState, type Storage } from './core.js';

export interface Env {
  ACCOUNTS: DurableObjectNamespace<AccountDO>;
  PAIRINGS: DurableObjectNamespace<PairingDO>;
}

const ACCOUNT_WS = /^\/v1\/accounts\/([0-9a-f]{32})\/ws$/;
const PAIRING = /^\/v1\/pairings\/([0-9a-f]{24})$/;
const PAIRING_WS = /^\/v1\/pairings\/([0-9a-f]{24})\/ws$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';

    const account = url.pathname.match(ACCOUNT_WS);
    if (account && isUpgrade) return env.ACCOUNTS.getByName(account[1]!).fetch(withHeader(request, 'x-pocket-account', account[1]!));

    const pairingWs = url.pathname.match(PAIRING_WS);
    if (pairingWs && isUpgrade) {
      const bundle = await env.PAIRINGS.getByName(pairingWs[1]!).get();
      if (!bundle) return new Response('pairing expired', { status: 404 });
      const forwarded = withHeader(withHeader(request, 'x-pocket-pairing', pairingWs[1]!), 'x-pocket-account', bundle.accountId);
      return env.ACCOUNTS.getByName(bundle.accountId).fetch(forwarded);
    }

    const pairing = url.pathname.match(PAIRING);
    if (pairing && request.method === 'GET') {
      const bundle = await env.PAIRINGS.getByName(pairing[1]!).get();
      const cors = { 'access-control-allow-origin': '*' };
      return bundle ? Response.json(bundle, { headers: cors }) : new Response('not found', { status: 404, headers: cors });
    }

    if (url.pathname === '/healthz') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function withHeader(request: Request, name: string, value: string): Request {
  const headers = new Headers(request.headers);
  headers.set(name, value);
  return new Request(request, { headers });
}

class HibernatingConn implements Conn {
  constructor(readonly ws: WebSocket) {}
  send(text: string): void {
    this.ws.send(text);
  }
  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
  getState(): ConnState {
    return this.ws.deserializeAttachment() as ConnState;
  }
  setState(state: ConnState): void {
    this.ws.serializeAttachment(state);
  }
}

export class AccountDO extends DurableObject<Env> {
  private room: AccountRoom | null = null;
  private readonly conns = new WeakMap<WebSocket, HibernatingConn>();

  /** The account id is not recoverable from the object id, so it is persisted on first contact. */
  private async getRoom(accountIdHint?: string | null): Promise<AccountRoom> {
    if (this.room) return this.room;
    let accountId = await this.ctx.storage.get<string>('accountId');
    if (!accountId && accountIdHint) {
      accountId = accountIdHint;
      await this.ctx.storage.put('accountId', accountId);
    }
    if (!accountId) throw new Error('account id unknown');
    const ctx = this.ctx;
    const env = this.env;
    const storage: Storage = {
      get: (key) => ctx.storage.get(key),
      put: (key, value) => ctx.storage.put(key, value),
      delete: async (key) => {
        await ctx.storage.delete(key);
      },
    };
    this.room = new AccountRoom(accountId, {
      storage,
      connections: () => ctx.getWebSockets().map((ws) => this.conn(ws)),
      publishPairing: async (pairingId, bundle) => {
        await env.PAIRINGS.getByName(pairingId).set(bundle);
      },
    });
    return this.room;
  }

  private conn(ws: WebSocket): HibernatingConn {
    let c = this.conns.get(ws);
    if (!c) {
      c = new HibernatingConn(ws);
      this.conns.set(ws, c);
    }
    return c;
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const conn = this.conn(server);
    conn.setState({ kind: 'device', authed: false, tokens: 0, refill: 0 });
    const room = await this.getRoom(request.headers.get('x-pocket-account'));
    await room.onOpen(conn, request.headers.get('x-pocket-pairing') ?? undefined);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (text.length > MAX_FRAME_BYTES) {
      ws.close(1009, 'frame too large');
      return;
    }
    await (await this.getRoom()).onMessage(this.conn(ws), text);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await (await this.getRoom()).onClose(this.conn(ws));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await (await this.getRoom()).onClose(this.conn(ws));
  }
}

export class PairingDO extends DurableObject<Env> {
  async get(): Promise<PairingBundle | null> {
    const bundle = await this.ctx.storage.get<PairingBundle>('bundle');
    if (!bundle) return null;
    if (bundle.expiresAt < Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return bundle;
  }

  async set(bundle: PairingBundle | null): Promise<void> {
    if (!bundle) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.put('bundle', bundle);
    await this.ctx.storage.setAlarm(bundle.expiresAt + 60_000);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
