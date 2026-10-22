import { ChatClient } from '@pocket/client-core';
import { deserializeIdentity } from '@pocket/protocol';
import type { WebSocketCtor } from '@pocket/transport';
import type { PairingState } from '../state.js';
import type { PanelState, WebviewToHost } from './protocol.js';

/** Owns the ChatClient for the whole extension lifetime and tracks the selected session. */
export class ChatHost {
  private client: ChatClient | undefined;
  private unsubscribe: (() => void) | undefined;
  private selected: string | null = null;
  private readonly historyRequested = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly WebSocket: WebSocketCtor,
    private readonly log: (m: string) => void,
    private readonly runCommand: (command: string) => void,
    private readonly onRelayMoved: (url: string) => void,
  ) {}

  get panelState(): PanelState {
    return this.client ? { paired: true, selected: this.selected, chat: this.client.getState() } : { paired: false, selected: null, chat: null };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replayState(): Record<string, number> | undefined {
    return this.client?.replayState();
  }

  start(state: PairingState): void {
    this.stop();
    const client = new ChatClient({
      relayUrl: state.relayUrl,
      accountId: state.accountId,
      deviceId: state.client.deviceId,
      identity: deserializeIdentity(state.client.identity),
      brainDeviceId: state.brainDeviceId,
      brainEncPub: state.brainEncPub,
      WebSocket: this.WebSocket,
      replayState: state.client.replay,
      log: this.log,
      onRelayMoved: this.onRelayMoved,
    });
    this.client = client;
    this.unsubscribe = client.subscribe(() => {
      this.ensureHistory();
      this.emit();
    });
    client.connect();
    this.emit();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client?.close();
    this.client = undefined;
    this.selected = null;
    this.historyRequested.clear();
    this.emit();
  }

  handle(intent: WebviewToHost): void {
    const client = this.client;
    if (!client) {
      if (intent.type === 'pair') this.runCommand('pocketClaude.pair');
      return;
    }
    switch (intent.type) {
      case 'create':
        void this.create();
        return;
      case 'select':
        this.select(intent.sessionId);
        return;
      case 'send':
        void this.send(intent.sessionId, intent.text);
        return;
      case 'interrupt':
        client.interrupt(intent.sessionId);
        return;
      case 'permission':
        client.respondPermission(intent.requestId, intent.decision);
        return;
      case 'kill':
        client.kill();
        return;
      case 'refresh':
        this.historyRequested.clear();
        client.refresh();
        this.ensureHistory();
        return;
      case 'unpair':
        this.runCommand('pocketClaude.unpair');
        return;
      case 'clearError':
        client.clearError();
        return;
      case 'ready':
      case 'pair':
        this.emit();
        return;
    }
  }

  private select(sessionId: string): void {
    this.selected = sessionId;
    this.ensureHistory();
    this.emit();
  }

  private async create(): Promise<string | undefined> {
    try {
      const id = await this.client?.createSession();
      if (id) this.select(id);
      return id;
    } catch {
      return undefined;
    }
  }

  private async send(sessionId: string | null, text: string): Promise<void> {
    const body = text.trim();
    if (!body || !this.client) return;
    const id = sessionId ?? (await this.create());
    if (id) this.client.send(id, body);
  }

  private ensureHistory(): void {
    const client = this.client;
    if (!client) return;
    const s = client.getState();
    if (!s.brainOnline) {
      this.historyRequested.clear();
      return;
    }
    if (this.selected === null && s.sessions[0]) this.selected = s.sessions[0].sessionId;
    const id = this.selected;
    if (id && !s.loaded[id] && !this.historyRequested.has(id)) {
      this.historyRequested.add(id);
      client.loadHistory(id);
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
