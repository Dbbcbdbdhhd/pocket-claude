// The transport sources target DOM-style WebSockets and do not typecheck under the relay's
// workers-types globals, so tests see only this declaration of the surface they use.
// Runtime resolution goes to the real @pocket/transport workspace package.
import type {
  DeviceToRelay,
  Identity,
  InnerMessage,
  InnerMessageBody,
  PairingBundle,
  PairingCode,
  PairReply,
  PushHint,
  RelayToDevice,
  Role,
  RosterEntry,
} from '@pocket/protocol';

export interface DeviceLinkOptions {
  relayUrl: string;
  accountId: string;
  deviceId: string;
  role: Role;
  identity: Identity;
  peers: Record<string, string>;
  replayState?: Record<string, number>;
  log?: (msg: string) => void;
}

export interface IncomingMessage {
  from: string;
  message: InnerMessage;
}

interface Events {
  message: (m: IncomingMessage) => void;
  presence: (deviceId: string, online: boolean) => void;
  roster: (roster: RosterEntry[]) => void;
  ready: (roster: RosterEntry[], online: string[]) => void;
  control: (frame: RelayToDevice) => void;
  disconnected: (reason: string) => void;
}

export class DeviceLink {
  constructor(opts: DeviceLinkOptions);
  readonly isReady: boolean;
  isOnline(deviceId: string): boolean;
  replayState(): Record<string, number>;
  addPeer(deviceId: string, encPub: string): void;
  removePeer(deviceId: string): void;
  on<K extends keyof Events>(event: K, fn: Events[K]): () => void;
  connect(): void;
  close(): void;
  send(to: string, body: InnerMessageBody, pushHint?: PushHint): boolean;
  sendControl(frame: Exclude<DeviceToRelay, { t: 'hello' | 'auth' | 'msg' }>): boolean;
}

export interface JoinedDevice {
  identity: Identity;
  deviceId: string;
  bundle: PairingBundle;
  reply: PairReply;
}

export function joinAccount(args: {
  relayUrl: string;
  code: PairingCode;
  role: Exclude<Role, 'brain'>;
  name: string;
  identity?: Identity;
  confirmSafetyNumber?: (safetyNumber: string) => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<JoinedDevice>;
