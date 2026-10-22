import * as os from 'node:os';
import { deserializeIdentity, type InnerMessageBody, type SerializedIdentity } from '@pocket/protocol';
import { DeviceLink, type IncomingMessage, type WebSocketCtor } from '@pocket/transport';
import type { ClipboardBackend } from './clipboard.js';

export interface AgentState {
  relayUrl: string;
  accountId: string;
  brainDeviceId: string;
  brainEncPub: string;
  deviceId: string;
  identity: SerializedIdentity;
  replay: Record<string, number>;
}

/** Shares this computer's clipboard with the paired Mac and nothing else: no files, no commands. */
export class ClipboardAgent {
  private readonly link: DeviceLink;

  constructor(
    private readonly state: AgentState,
    private readonly opts: {
      clipboard: ClipboardBackend;
      WebSocket?: WebSocketCtor;
      log: (m: string) => void;
      /** The relay moved; the caller persists the new address. */
      onRelayMoved: (url: string) => void;
    },
  ) {
    this.link = new DeviceLink({
      relayUrl: state.relayUrl,
      accountId: state.accountId,
      deviceId: state.deviceId,
      role: 'executor',
      identity: deserializeIdentity(state.identity),
      peers: { [state.brainDeviceId]: state.brainEncPub },
      WebSocket: opts.WebSocket,
      replayState: state.replay,
      log: opts.log,
    });
    this.link.on('message', (m) => void this.onMessage(m));
    this.link.on('ready', (_r, online) => online.includes(state.brainDeviceId) && this.sendStatus());
    this.link.on('presence', (id, online) => online && id === state.brainDeviceId && this.sendStatus());
  }

  connect(): void {
    this.link.connect();
  }

  close(): void {
    this.link.close();
  }

  replayState(): Record<string, number> {
    return this.link.replayState();
  }

  private send(body: InnerMessageBody): void {
    this.link.send(this.state.brainDeviceId, body);
  }

  private sendStatus(): void {
    this.send({ type: 'executor.status', payload: { workspaces: [], os: `${os.platform()} ${os.release()}`, shell: 'none', capabilities: ['clipboard'] } });
  }

  private async onMessage({ from, message }: IncomingMessage): Promise<void> {
    if (from !== this.state.brainDeviceId) return;
    switch (message.type) {
      case 'clipboard.read': {
        const { requestId } = message.payload;
        try {
          const items = await this.opts.clipboard.read();
          this.opts.log(`clipboard read: ${items.map((i) => i.kind).join(', ') || 'empty'}`);
          this.send({ type: 'clipboard.data', payload: { requestId, items } });
        } catch (e) {
          this.send({ type: 'clipboard.data', payload: { requestId, error: e instanceof Error ? e.message : String(e) } });
        }
        return;
      }
      case 'clipboard.write': {
        const { requestId, item } = message.payload;
        try {
          await this.opts.clipboard.write(item);
          this.opts.log(`clipboard written: ${item.kind}`);
          this.send({ type: 'clipboard.done', payload: { requestId } });
        } catch (e) {
          this.send({ type: 'clipboard.done', payload: { requestId, error: e instanceof Error ? e.message : String(e) } });
        }
        return;
      }
      case 'tool.call':
        this.send({ type: 'tool.result', payload: { callId: message.payload.callId, content: 'This computer only shares its clipboard.', isError: true } });
        return;
      case 'relay.moved':
        if (/^https?:\/\//.test(message.payload.url) && message.payload.url !== this.link.currentRelayUrl) {
          this.link.setRelayUrl(message.payload.url);
          this.opts.onRelayMoved(message.payload.url);
        }
        return;
      default:
        return;
    }
  }
}
