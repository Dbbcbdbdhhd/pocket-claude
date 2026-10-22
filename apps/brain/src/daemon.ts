import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import {
  b64,
  deriveAccountId,
  deriveDeviceId,
  newPairingCode,
  openPairRequest,
  PAIRING_TTL_MS,
  pairingUri,
  safetyNumber,
  sealPairReply,
  type Identity,
  TOOL_NAMES,
  type InnerMessageBody,
  type ModelInfo,
  type PairingBundle,
  MAC_DEVICE_ID,
  type PairingCode,
  type Project,
  type PayloadOf,
  type PushHint,
  type RelayToDevice,
  type SessionEvent,
  type SessionMeta,
} from '@pocket/protocol';
import { DeviceLink, type IncomingMessage, type WebSocketCtor } from '@pocket/transport';
import { WebSocket as NodeWebSocket } from 'ws';
import { isAllowedByRules, validateRule } from './allowlist.js';
import { toDisplayCall } from './claude-tools.js';
import { ExecutorBridge } from './executor.js';
import { log } from './log.js';
import { PermissionBroker } from './permissions.js';
import { Session } from './session.js';
import { saveState, type BrainState, type PairedDevice, type UsageTotals } from './store.js';

const MAX_LIVE_SESSIONS = 2;

const FALLBACK_MODELS: ModelInfo[] = [
  { value: 'default', displayName: 'Default', description: 'Claude Code default for your plan' },
  { value: 'opus', displayName: 'Opus', description: 'Most capable for complex work', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast and capable for everyday tasks', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
];
const DELTA_FLUSH_MS = 60;
const CLIPBOARD_TIMEOUT_MS = 60_000;

export interface PairingTicket {
  code: string;
  uri: string;
  safetyNumber: string;
  expiresAt: number;
}

export interface BrainStatus {
  accountId: string;
  deviceId: string;
  relayUrl: string;
  relayConnected: boolean;
  claudeVersion: string | null;
  executorOnline: boolean;
  workspaces: string[];
  devices: (Pick<PairedDevice, 'deviceId' | 'role' | 'name'> & { online: boolean })[];
  sessions: SessionMeta[];
}

export class Brain {
  readonly deviceId: string;
  readonly accountId: string;
  private readonly link: DeviceLink;
  private readonly executor: ExecutorBridge;
  private readonly permissions: PermissionBroker;
  private readonly sessions = new Map<string, Session>();
  private readonly pairings = new Map<string, { code: PairingCode; expiresAt: number; onPaired?: (d: PairedDevice) => void }>();
  private readonly pendingDeltas = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>();
  private claudeVersion: string | null = null;
  /** Clipboard requests waiting for a computer: requestId → the client that asked. */
  private readonly clipboardRequests = new Map<string, { client: string; deviceId: string; kind: 'get' | 'set'; timer: ReturnType<typeof setTimeout> }>();
  private models: ModelInfo[] | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly identity: Identity,
    private readonly state: BrainState,
    private readonly opts: { WebSocket?: WebSocketCtor; claudeOptions?: Partial<Options>; persist?: boolean } = {},
  ) {
    this.deviceId = deriveDeviceId(identity.signPub);
    this.accountId = deriveAccountId(identity.signPub);
    this.link = new DeviceLink({
      relayUrl: state.relayUrl,
      accountId: this.accountId,
      deviceId: this.deviceId,
      role: 'brain',
      identity,
      peers: Object.fromEntries(state.devices.map((d) => [d.deviceId, d.encPub])),
      replayState: state.replay,
      WebSocket: opts.WebSocket ?? (NodeWebSocket as unknown as WebSocketCtor),
      log: (m) => log(`link: ${m}`),
    });
    this.executor = new ExecutorBridge({
      executorIds: () => this.executorDevices().map((d) => d.deviceId),
      isOnline: (id) => this.link.isOnline(id),
      send: (to, body) => this.link.send(to, body),
    });
    this.permissions = new PermissionBroker({
      isAllowedAlways: (tool, input) => isAllowedByRules(this.state.allowlist, tool, input),
      request: (p) => this.toClients({ type: 'permission.request', payload: p }, 'permission'),
      resolved: (requestId, decision, by) => this.toClients({ type: 'permission.resolved', payload: { requestId, decision, by } }),
      waiting: (sessionId, waiting) => this.sessions.get(sessionId)?.setState(waiting ? 'waiting_permission' : 'running'),
    });
    for (const meta of state.sessions) {
      const restored = { ...meta, state: meta.state === 'ended' ? 'ended' : 'idle' } as SessionMeta;
      this.sessions.set(meta.sessionId, new Session(restored, this.sessionHost(), true));
    }

    this.link.on('message', (m) => void this.onMessage(m).catch((e) => log(`message handler failed: ${String(e)}`)));
    this.link.on('control', (f) => this.onControl(f));
    this.link.on('ready', (_roster, online) => {
      log(`relay ready; online: ${online.join(', ') || 'nobody'}`);
      this.broadcastStatus();
    });
    this.link.on('presence', (deviceId, online) => {
      const device = this.state.devices.find((d) => d.deviceId === deviceId);
      if (!device) return;
      log(`${device.role} ${device.name} is ${online ? 'online' : 'offline'}`);
      if (online && this.state.publicRelayUrl) this.link.send(deviceId, { type: 'relay.moved', payload: { url: this.state.publicRelayUrl } });
      if (device.role === 'executor') {
        if (!online) this.executor.failAll('The computer went offline.', deviceId);
        this.broadcastStatus(online ? undefined : 'executor_offline');
        this.broadcastComputers();
      } else if (online) {
        this.sendStatus(deviceId);
        for (const p of this.permissions.outstanding()) this.link.send(deviceId, { type: 'permission.request', payload: p });
      }
    });
  }

  start(): void {
    this.link.connect();
    void this.detectClaudeVersion();
  }

  stop(): void {
    for (const s of this.sessions.values()) s.stop();
    this.persistNow();
    this.link.close();
  }

  status(): BrainStatus {
    return {
      accountId: this.accountId,
      deviceId: this.deviceId,
      relayUrl: this.publicRelayUrl,
      relayConnected: this.link.isReady,
      claudeVersion: this.claudeVersion,
      executorOnline: this.executor.online(this.defaultExecutor()),
      workspaces: this.executor.info(this.defaultExecutor())?.workspaces ?? [],
      devices: this.state.devices.map((d) => ({ deviceId: d.deviceId, role: d.role, name: d.name, online: this.link.isOnline(d.deviceId) })),
      sessions: [...this.sessions.values()].map((s) => s.meta),
    };
  }

  /** Issues a one-time code. The phone scans `uri`; the Windows executor types `code` and checks `safetyNumber`. */
  startPairing(onPaired?: (d: PairedDevice) => void): PairingTicket {
    if (!this.link.isReady) throw new Error('Not connected to the relay yet');
    const code = newPairingCode();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    const bundle: PairingBundle = {
      v: 1,
      accountId: this.accountId,
      brainDeviceId: this.deviceId,
      brainSignPub: b64.encode(this.identity.signPub),
      brainEncPub: b64.encode(this.identity.encPub),
      expiresAt,
    };
    this.pairings.set(code.pairingId, { code, expiresAt, onPaired });
    this.link.sendControl({ t: 'pairing.publish', pairingId: code.pairingId, bundle });
    setTimeout(() => this.pairings.delete(code.pairingId), PAIRING_TTL_MS + 5_000);
    return { code: code.display, uri: pairingUri(code, this.publicRelayUrl), safetyNumber: safetyNumber(bundle), expiresAt };
  }

  get publicRelayUrl(): string {
    return this.state.publicRelayUrl ?? this.state.relayUrl;
  }

  /** Tells every device the relay's new public address. Offline devices hear it when they next come online through the old one. */
  movePublicRelay(url: string): string {
    const next = new URL(url).toString().replace(/\/$/, '');
    this.state.publicRelayUrl = next;
    this.persistNow();
    for (const d of this.state.devices) this.link.send(d.deviceId, { type: 'relay.moved', payload: { url: next } });
    log(`public relay is now ${next}`);
    return next;
  }

  removeDevice(deviceId: string): boolean {
    const device = this.state.devices.find((d) => d.deviceId === deviceId);
    if (!device) return false;
    this.state.devices = this.state.devices.filter((d) => d.deviceId !== deviceId);
    this.link.removePeer(deviceId);
    this.link.sendControl({ t: 'roster.remove', deviceId });
    if (device.role === 'executor') {
      this.executor.forget(deviceId);
      if (this.state.activeExecutor === deviceId) delete this.state.activeExecutor;
      this.broadcastComputers();
      this.broadcastStatus();
    }
    this.persistNow();
    return true;
  }

  private executorDevices(): PairedDevice[] {
    return this.state.devices.filter((d) => d.role === 'executor');
  }

  /** Default computer for the clipboard: the one picked last, else the first online one, else any. */
  private defaultExecutor(): string | undefined {
    const all = this.executorDevices();
    if (all.some((d) => d.deviceId === this.state.activeExecutor)) return this.state.activeExecutor;
    const clip = all.filter((d) => this.executor.info(d.deviceId)?.capabilities?.includes('clipboard'));
    const pool = clip.length ? clip : all;
    return (pool.find((d) => this.link.isOnline(d.deviceId)) ?? pool[0])?.deviceId;
  }

  /** Old extensions don't report capabilities; they are tool executors. */
  private hasTools(deviceId: string): boolean {
    const caps = this.executor.info(deviceId)?.capabilities;
    return !caps || caps.includes('tools');
  }

  /** The computer a chat works on, or undefined for the Mac itself (the default). */
  private executorForSession(sessionId: string): string | undefined {
    const chosen = this.sessions.get(sessionId)?.meta.executorId;
    return chosen && this.executorDevices().some((d) => d.deviceId === chosen) && this.hasTools(chosen) ? chosen : undefined;
  }

  private macProjects(): Project[] {
    const used = new Map<string, number>();
    for (const s of this.sessions.values()) {
      if (s.meta.project && !this.executorForSession(s.id)) used.set(s.meta.project, Math.max(used.get(s.meta.project) ?? 0, s.meta.updatedAt));
    }
    const out = new Map<string, Project>();
    const add = (path: string, lastOpened?: number) => {
      if (out.has(path)) return;
      try {
        if (!statSync(path).isDirectory()) return;
      } catch {
        return;
      }
      out.set(path, { path, name: basename(path), open: false, ...(lastOpened ? { lastOpened } : {}) });
    };
    for (const [path, at] of [...used.entries()].sort((a, b) => b[1] - a[1])) add(path, at);
    const docs = join(homedir(), 'Documents');
    try {
      const repos = readdirSync(docs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(docs, e.name, '.git')))
        .map((e) => ({ path: join(docs, e.name), at: statSync(join(docs, e.name)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      for (const r of repos) add(r.path, Math.round(r.at));
    } catch {}
    return [...out.values()].slice(0, 30);
  }

  private computers(): PayloadOf<'computers.result'> {
    return {
      computers: this.executorDevices().map((d) => {
        const info = this.executor.info(d.deviceId);
        return {
          deviceId: d.deviceId,
          name: d.name,
          online: this.link.isOnline(d.deviceId),
          ...(info?.os ? { os: info.os } : {}),
          workspaces: info?.workspaces ?? [],
          ...(info?.projects ? { projects: info.projects } : {}),
          ...(info?.capabilities ? { capabilities: info.capabilities } : {}),
          pairedAt: d.pairedAt,
        };
      }),
      activeId: this.defaultExecutor() ?? null,
      mac: { name: hostname().replace(/\.local$/, ''), projects: this.macProjects() },
    };
  }

  private broadcastComputers(): void {
    this.toClients({ type: 'computers.result', payload: this.computers() }, undefined, true);
  }

  allowlist(): string[] {
    return [...this.state.allowlist];
  }

  addAllowRule(rule: string): string | null {
    const error = validateRule(rule, TOOL_NAMES);
    if (error) return error;
    if (!this.state.allowlist.includes(rule)) this.state.allowlist = [...this.state.allowlist, rule];
    this.persistNow();
    return null;
  }

  removeAllowRule(rule: string): boolean {
    const before = this.state.allowlist.length;
    this.state.allowlist = this.state.allowlist.filter((r) => r !== rule);
    this.persistNow();
    return this.state.allowlist.length !== before;
  }

  kill(): void {
    log('kill switch');
    this.permissions.denyAll();
    this.executor.killAll();
    for (const s of this.sessions.values()) s.stop();
  }

  private onControl(frame: RelayToDevice): void {
    if (frame.t === 'pair.incoming') {
      this.onPairIncoming(frame.pairingId, frame.deviceId, frame.blob);
      return;
    }
    if (frame.t === 'error') log(`relay error ${frame.code}: ${frame.message}`);
  }

  private onPairIncoming(pairingId: string, deviceId: string, blob: string): void {
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.expiresAt < Date.now()) {
      log(`pairing ${pairingId} unknown or expired`);
      return;
    }
    let request;
    try {
      request = openPairRequest({ brain: this.identity, code: pairing.code, blob });
    } catch (e) {
      log(`rejected pairing request: ${String(e)}`);
      return;
    }
    if (request.deviceId !== deviceId) return;
    for (const old of this.state.devices.filter((d) => d.role === request.role && d.name === request.name && d.deviceId !== request.deviceId)) {
      this.removeDevice(old.deviceId);
    }
    const device: PairedDevice = {
      deviceId: request.deviceId,
      role: request.role as PairedDevice['role'],
      name: request.name,
      signPub: request.signPub,
      encPub: request.encPub,
      pairedAt: Date.now(),
    };
    this.state.devices = [...this.state.devices.filter((d) => d.deviceId !== device.deviceId), device];
    this.persistNow();
    this.link.addPeer(device.deviceId, device.encPub);
    this.link.sendControl({ t: 'roster.add', entry: { deviceId: device.deviceId, role: device.role, name: device.name, signPub: device.signPub } });
    const reply = sealPairReply({ ok: true, accountId: this.accountId, brainDeviceId: this.deviceId, roster: [] }, device.encPub);
    this.link.sendControl({ t: 'pair.reply', pairingId, deviceId, blob: reply });
    log(`paired ${device.role} "${device.name}" (${device.deviceId})`);
    if (device.role === 'executor') this.broadcastComputers();
    pairing.onPaired?.(device);
  }

  private async onMessage({ from, message }: IncomingMessage): Promise<void> {
    const device = this.state.devices.find((d) => d.deviceId === from);
    if (!device) return;

    if (device.role === 'executor') {
      switch (message.type) {
        case 'tool.result':
          return this.executor.handleResult(from, message.payload);
        case 'tool.output':
          return this.executor.handleOutput(from, message.payload);
        case 'clipboard.data':
        case 'clipboard.done': {
          const req = this.clipboardRequests.get(message.payload.requestId);
          if (!req || req.deviceId !== from) return;
          clearTimeout(req.timer);
          this.clipboardRequests.delete(message.payload.requestId);
          if (message.type === 'clipboard.data') {
            this.link.send(req.client, {
              type: 'clipboard.result',
              payload: { requestId: message.payload.requestId, deviceId: from, ...(message.payload.items ? { items: message.payload.items } : {}), ...(message.payload.error ? { error: message.payload.error } : {}) },
            });
          } else {
            this.link.send(req.client, { type: 'clipboard.written', payload: { requestId: message.payload.requestId, deviceId: from, ...(message.payload.error ? { error: message.payload.error } : {}) } });
          }
          return;
        }
        case 'executor.status':
          this.executor.setInfo(from, message.payload);
          this.broadcastComputers();
          return this.broadcastStatus();
        default:
          return;
      }
    }

    switch (message.type) {
      case 'status.get':
        return this.sendStatus(from);
      case 'session.list':
        this.link.send(from, { type: 'session.list.result', payload: { sessions: this.sortedSessions() } });
        return;
      case 'session.create': {
        const now = Date.now();
        const meta: SessionMeta = {
          sessionId: randomUUID(),
          title: message.payload.title?.trim() || `Chat ${new Date(now).toLocaleString('ru-RU')}`,
          state: 'idle',
          createdAt: now,
          updatedAt: now,
        };
        this.sessions.set(meta.sessionId, new Session(meta, this.sessionHost(), false));
        this.schedulePersist();
        this.toClients({ type: 'session.created', payload: { session: meta } });
        return;
      }
      case 'session.history': {
        const s = this.sessions.get(message.payload.sessionId);
        if (!s) return this.sendError(from, 'unknown_session', 'Session not found');
        this.link.send(from, { type: 'session.history.result', payload: { sessionId: s.id, events: s.history() } });
        return;
      }
      case 'message.send': {
        const s = this.sessions.get(message.payload.sessionId);
        if (!s) return this.sendError(from, 'unknown_session', 'Session not found');
        this.enforceLiveLimit(s.id);
        try {
          await s.send({ text: message.payload.text, attachments: message.payload.attachments, from });
        } catch (e) {
          log(`send failed: ${String(e)}`);
          this.sendError(from, 'claude_failed', e instanceof Error ? e.message : String(e));
        }
        return;
      }
      case 'session.interrupt':
        return this.sessions.get(message.payload.sessionId)?.interrupt();
      case 'permission.respond':
        this.permissions.respond(message.payload.requestId, message.payload.decision, from);
        return;
      case 'control.kill':
        return this.kill();
      case 'session.configure': {
        const s = this.sessions.get(message.payload.sessionId);
        if (!s) return this.sendError(from, 'unknown_session', 'Session not found');
        const model = message.payload.model === 'default' ? null : message.payload.model;
        await s.configure({ model, effort: message.payload.effort });
        return;
      }
      case 'session.hide':
        this.sessions.get(message.payload.sessionId)?.setHidden(message.payload.hidden);
        return;
      case 'session.delete': {
        const s = this.sessions.get(message.payload.sessionId);
        if (!s) return;
        for (const p of this.permissions.outstanding()) if (p.sessionId === s.id) this.permissions.respond(p.requestId, 'deny', 'deleted');
        s.destroy();
        this.sessions.delete(s.id);
        this.persistNow();
        this.toClients({ type: 'session.deleted', payload: { sessionId: s.id } });
        return;
      }
      case 'session.rename': {
        const s = this.sessions.get(message.payload.sessionId);
        if (!s) return this.sendError(from, 'unknown_session', 'Session not found');
        s.rename(message.payload.title.trim());
        return;
      }
      case 'models.get':
        this.link.send(from, { type: 'models.result', payload: { models: await this.listModels() } });
        return;
      case 'activity.get':
        this.link.send(from, { type: 'activity.result', payload: this.activity() });
        return;
      case 'computers.get':
        this.link.send(from, { type: 'computers.result', payload: this.computers() });
        return;
      case 'computer.select': {
        const { deviceId, sessionId, project } = message.payload;
        if (deviceId === MAC_DEVICE_ID) {
          if (sessionId) this.sessions.get(sessionId)?.setExecutor(undefined, project);
        } else {
          if (!this.executorDevices().some((d) => d.deviceId === deviceId)) return this.sendError(from, 'unknown_computer', 'That computer is not paired');
          if (sessionId && this.hasTools(deviceId)) this.sessions.get(sessionId)?.setExecutor(deviceId, project);
          else this.state.activeExecutor = deviceId;
        }
        this.schedulePersist();
        this.broadcastComputers();
        this.broadcastStatus();
        return;
      }
      case 'computer.open': {
        const { deviceId, path } = message.payload;
        if (!this.executorDevices().some((d) => d.deviceId === deviceId)) return this.sendError(from, 'unknown_computer', 'That computer is not paired');
        if (!this.link.send(deviceId, { type: 'workspace.open', payload: { path } })) this.sendError(from, 'computer_offline', 'The computer is offline');
        return;
      }
      case 'clipboard.get':
      case 'clipboard.set': {
        const { requestId, deviceId } = message.payload;
        const fail = (error: string) =>
          message.type === 'clipboard.get'
            ? this.link.send(from, { type: 'clipboard.result', payload: { requestId, deviceId, error } })
            : this.link.send(from, { type: 'clipboard.written', payload: { requestId, deviceId, error } });
        if (!this.executorDevices().some((d) => d.deviceId === deviceId)) return void fail('That computer is not paired');
        const body: InnerMessageBody =
          message.type === 'clipboard.get' ? { type: 'clipboard.read', payload: { requestId } } : { type: 'clipboard.write', payload: { requestId, item: message.payload.item } };
        if (!this.link.isOnline(deviceId) || !this.link.send(deviceId, body)) return void fail('The computer is offline');
        this.state.activeExecutor = deviceId;
        const timer = setTimeout(() => {
          if (this.clipboardRequests.delete(requestId)) fail('The computer did not answer');
        }, CLIPBOARD_TIMEOUT_MS);
        this.clipboardRequests.set(requestId, { client: from, deviceId, kind: message.type === 'clipboard.get' ? 'get' : 'set', timer });
        return;
      }
      case 'computer.pair': {
        try {
          const ticket = this.startPairing();
          this.link.send(from, { type: 'computer.pairing', payload: { code: ticket.code, safetyNumber: ticket.safetyNumber, expiresAt: ticket.expiresAt } });
        } catch (e) {
          this.sendError(from, 'pairing_failed', e instanceof Error ? e.message : String(e));
        }
        return;
      }
      case 'computer.remove': {
        const target = this.executorDevices().find((d) => d.deviceId === message.payload.deviceId);
        if (!target) return;
        this.removeDevice(target.deviceId);
        const panel = this.state.devices.find((d) => d.role === 'client' && d.name === `${target.name} (VS Code)`);
        if (panel) this.removeDevice(panel.deviceId);
        return;
      }
      default:
        return;
    }
  }

  private async listModels(): Promise<ModelInfo[]> {
    for (const s of this.sessions.values()) {
      if (!s.live) continue;
      try {
        const models = await s.supportedModels();
        if (models?.length) {
          this.models = models;
          break;
        }
      } catch (e) {
        log(`supportedModels failed: ${String(e)}`);
      }
    }
    return this.models ?? FALLBACK_MODELS;
  }

  private activity(): PayloadOf<'activity.result'> {
    const pending = this.permissions.outstanding();
    return {
      at: Date.now(),
      sessions: [...this.sessions.values()]
        .filter((s) => s.live || s.meta.state !== 'idle' || s.busy)
        .map((s) => ({
          sessionId: s.id,
          title: s.meta.title,
          state: s.meta.state,
          live: s.live,
          ...(this.executorForSession(s.id) ? { executorId: this.executorForSession(s.id) } : {}),
          ...(s.meta.project ? { project: s.meta.project } : {}),
          ...(s.meta.model ? { model: s.meta.model } : {}),
          ...(s.meta.effort ? { effort: s.meta.effort } : {}),
          runningTools: s.runningTools(),
          background: s.backgroundTasks(),
          agents: s.subagents(),
          pendingPermissions: pending.filter((p) => p.sessionId === s.id).length,
          ...(s.turnStarted ? { turnStartedAt: s.turnStarted } : {}),
        })),
      executor: {
        online: this.executor.online(this.defaultExecutor()),
        workspaces: this.executor.info(this.defaultExecutor())?.workspaces ?? [],
        ...(this.executor.info(this.defaultExecutor())?.os ? { os: this.executor.info(this.defaultExecutor())!.os } : {}),
      },
      ...(this.claudeVersion ? { claudeVersion: this.claudeVersion } : {}),
    };
  }

  private enforceLiveLimit(keepId: string): void {
    const live = [...this.sessions.values()].filter((s) => s.live && s.id !== keepId);
    while (live.length >= MAX_LIVE_SESSIONS) {
      const idle = live.filter((s) => s.meta.state === 'idle' && !s.busy).sort((a, b) => a.meta.updatedAt - b.meta.updatedAt)[0];
      if (!idle) break;
      idle.stop();
      live.splice(live.indexOf(idle), 1);
    }
  }

  private sessionHost() {
    return {
      executorFor: (sessionId: string) =>
        this.executor.handle(
          () => this.executorForSession(sessionId),
          () => {
            const s = this.sessions.get(sessionId);
            return s?.meta.project && s.meta.executorId === this.executorForSession(sessionId) ? s.meta.project : undefined;
          },
        ),
      emit: (sessionId: string, event: SessionEvent, durable: boolean) => this.emitEvent(sessionId, event, durable),
      metaChanged: (meta: SessionMeta) => {
        this.toClients({ type: 'session.updated', payload: { session: meta } }, undefined, true);
        this.schedulePersist();
      },
      canUseTool: async (sessionId: string, tool: string, input: Record<string, unknown>, signal: AbortSignal) => {
        const shown = toDisplayCall(tool.replace(/^mcp__pocket__/, ''), input);
        const result = await this.permissions.decide(sessionId, shown.name, shown.input as Record<string, unknown>, signal);
        return result.behavior === 'allow' ? { ...result, updatedInput: input } : result;
      },
      claudeOptions: (): Partial<Options> => ({
        ...(this.state.model ? { model: this.state.model } : {}),
        ...(this.state.effort ? { effort: this.state.effort } : {}),
        ...this.opts.claudeOptions,
      }),
      onClaudeVersion: (v: string) => {
        if (v !== this.claudeVersion) {
          this.claudeVersion = v;
          this.broadcastStatus();
        }
      },
    };
  }

  /** Text deltas are coalesced and only sent to clients that are online; everything else is durable and buffered by the relay. */
  private emitEvent(sessionId: string, event: SessionEvent, durable: boolean): void {
    if (event.kind === 'text_delta') {
      const pending = this.pendingDeltas.get(sessionId);
      if (pending) {
        pending.text += event.text;
        return;
      }
      this.pendingDeltas.set(sessionId, {
        text: event.text,
        timer: setTimeout(() => this.flushDeltas(sessionId), DELTA_FLUSH_MS),
      });
      return;
    }
    this.flushDeltas(sessionId);
    if (event.kind === 'result') this.recordUsage(sessionId, event);
    const hint: PushHint | undefined = event.kind === 'result' ? 'completed' : undefined;
    this.toClients({ type: 'session.event', payload: { sessionId, event } }, hint, !durable);
  }

  private recordUsage(sessionId: string, e: Extract<SessionEvent, { kind: 'result' }>): void {
    const day = new Date().toISOString().slice(0, 10);
    const add = (u: UsageTotals | undefined): UsageTotals => ({
      turns: (u?.turns ?? 0) + 1,
      costUsd: (u?.costUsd ?? 0) + (e.costUsd ?? 0),
      inputTokens: (u?.inputTokens ?? 0) + (e.inputTokens ?? 0),
      outputTokens: (u?.outputTokens ?? 0) + (e.outputTokens ?? 0),
      durationMs: (u?.durationMs ?? 0) + (e.durationMs ?? 0),
    });
    const usage = this.state.usage ?? { days: {}, sessions: {} };
    usage.days[day] = add(usage.days[day]);
    usage.sessions[sessionId] = add(usage.sessions[sessionId]);
    this.state.usage = usage;
    this.schedulePersist();
  }

  private flushDeltas(sessionId: string): void {
    const pending = this.pendingDeltas.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingDeltas.delete(sessionId);
    this.toClients({ type: 'session.event', payload: { sessionId, event: { kind: 'text_delta', text: pending.text } } }, undefined, true);
  }

  private toClients(body: InnerMessageBody, pushHint?: PushHint, onlineOnly = false): void {
    for (const d of this.state.devices) {
      if (d.role !== 'client') continue;
      if (onlineOnly && !this.link.isOnline(d.deviceId)) continue;
      this.link.send(d.deviceId, body, pushHint);
    }
  }

  private hostStatus(): InnerMessageBody {
    return {
      type: 'host.status',
      payload: {
        ready: !!this.claudeVersion,
        ...(this.claudeVersion ? {} : { reason: 'Claude Code was not found on the Mac' }),
        ...(this.claudeVersion ? { claudeVersion: this.claudeVersion } : {}),
        executorOnline: this.executor.online(this.defaultExecutor()),
        workspaces: this.executor.info(this.defaultExecutor())?.workspaces ?? [],
      },
    };
  }

  private sendStatus(to: string): void {
    this.link.send(to, this.hostStatus());
    this.link.send(to, { type: 'computers.result', payload: this.computers() });
    this.link.send(to, { type: 'session.list.result', payload: { sessions: this.sortedSessions() } });
  }

  private broadcastStatus(pushHint?: PushHint): void {
    this.toClients(this.hostStatus(), pushHint, !pushHint);
  }

  private sendError(to: string, code: string, message: string): void {
    this.link.send(to, { type: 'error', payload: { code, message } });
  }

  private sortedSessions(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async detectClaudeVersion(): Promise<void> {
    const executable = this.opts.claudeOptions?.pathToClaudeCodeExecutable ?? 'claude';
    try {
      const { stdout } = await promisify(execFile)(executable, ['--version'], { timeout: 15_000 });
      this.claudeVersion = stdout.trim().split(' ')[0] ?? stdout.trim();
    } catch (e) {
      log(`claude --version failed: ${String(e)}`);
    }
    this.broadcastStatus();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.persistNow(), 1_000);
  }

  private persistNow(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.state.sessions = [...this.sessions.values()].map((s) => s.meta);
    this.state.replay = this.link.replayState();
    if (this.opts.persist !== false) saveState(this.state);
  }
}
