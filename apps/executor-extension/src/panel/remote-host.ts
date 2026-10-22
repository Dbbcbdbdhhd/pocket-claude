import type { PanelState, WebviewToHost } from './protocol.js';

/** What the panel needs from whoever owns the chat connection. */
export interface PanelHost {
  readonly panelState: PanelState;
  onChange(listener: () => void): () => void;
  handle(intent: WebviewToHost): void;
}

/** Panel host in a window that doesn't own the connection: mirrors the leader's state and forwards intents. */
export class RemotePanelHost implements PanelHost {
  private state: PanelState = { paired: false, selected: null, chat: null };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly forward: (intent: WebviewToHost) => boolean,
    private readonly runLocal: (command: string) => void,
  ) {}

  get panelState(): PanelState {
    return this.state;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(state: PanelState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }

  handle(intent: WebviewToHost): void {
    if (intent.type === 'pair') return this.runLocal('pocketClaude.pair');
    if (intent.type === 'unpair') return this.runLocal('pocketClaude.unpair');
    if (intent.type === 'ready') return this.update(this.state);
    this.forward(intent);
  }
}

/** Routes the panel to the local chat host while leading, to the leader otherwise. */
export class SwitchingPanelHost implements PanelHost {
  private current: PanelHost;
  private unsubscribe: () => void;
  private readonly listeners = new Set<() => void>();

  constructor(initial: PanelHost) {
    this.current = initial;
    this.unsubscribe = initial.onChange(() => this.emit());
  }

  use(host: PanelHost): void {
    if (host === this.current) return;
    this.unsubscribe();
    this.current = host;
    this.unsubscribe = host.onChange(() => this.emit());
    this.emit();
  }

  get panelState(): PanelState {
    return this.current.panelState;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  handle(intent: WebviewToHost): void {
    this.current.handle(intent);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
