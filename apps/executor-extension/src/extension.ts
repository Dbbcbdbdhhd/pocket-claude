import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { isRelayUrl } from '@pocket/client-core';
import { deserializeIdentity, parsePairingCode, serializeIdentity, type Project } from '@pocket/protocol';
import { DeviceLink, joinAccount, type WebSocketCtor } from '@pocket/transport';
import { Coordinator, defaultPipePath, type Follower, type WindowMessage } from './coordinator.js';
import { ToolDispatcher } from './dispatch.js';
import { ChatHost } from './panel/chat-host.js';
import { PanelController } from './panel/panel.js';
import { parseIntent, type PanelState } from './panel/protocol.js';
import { RemotePanelHost, SwitchingPanelHost } from './panel/remote-host.js';
import { createPathGuard } from './path-guard.js';
import { listProjects, projectKey, resolveRoot, updateHistory } from './projects.js';
import { clearState, loadState, saveState, type PairingState } from './state.js';
import { killAllBackground } from './tools/index.js';
import { shellName } from './tools/workspace-info.js';

const WS = WebSocket as unknown as WebSocketCtor;
const REPLAY_SAVE_INTERVAL_MS = 30_000;
const DEFAULT_RELAY = 'https://macbook-pro-dmitrij.taild47d20.ts.net:10000';
const HISTORY_KEY = 'pocketClaude.projectHistory';

function findRipgrep(): string | undefined {
  const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const root = vscode.env.appRoot;
  const candidates = [
    path.join(root, 'node_modules', '@vscode', 'ripgrep', 'bin', bin),
    path.join(root, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', bin),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

let channel: vscode.LogOutputChannel | undefined;

function log(msg: string): void {
  channel ??= vscode.window.createOutputChannel('Pocket Claude', { log: true });
  channel.info(msg);
}

const localFolders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

async function recentFolders(): Promise<string[]> {
  try {
    const r = await vscode.commands.executeCommand<{ workspaces?: { folderUri?: vscode.Uri }[] }>('_workbench.getRecentlyOpened');
    return (r?.workspaces ?? []).flatMap((w) => (w.folderUri?.scheme === 'file' ? [w.folderUri.fsPath] : [])).slice(0, 20);
  } catch {
    return [];
  }
}

/** Owns the relay links for this computer. Runs only in the leader window. */
class Executor {
  private link: DeviceLink | undefined;
  private dispatcher: ToolDispatcher | undefined;
  private replayTimer: ReturnType<typeof setTimeout> | undefined;
  private state: PairingState | undefined;
  private projects: Project[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly chat: ChatHost,
    /** Folders open in every VS Code window of this computer, this window's first. */
    private readonly openFolders: () => string[],
  ) {}

  get running(): boolean {
    return this.link !== undefined;
  }

  start(state: PairingState): void {
    this.stop();
    this.state = state;
    const identity = deserializeIdentity(state.executor.identity);
    const link = new DeviceLink({
      relayUrl: state.relayUrl,
      accountId: state.accountId,
      deviceId: state.executor.deviceId,
      role: 'executor',
      identity,
      peers: { [state.brainDeviceId]: state.brainEncPub },
      WebSocket: WS,
      replayState: state.replay,
      log,
    });
    const rgPath = findRipgrep();
    const dispatcher = new ToolDispatcher({
      brainDeviceId: state.brainDeviceId,
      send: (body) => {
        link.send(state.brainDeviceId, body);
      },
      createContext: (signal, onOutput, root) => {
        let roots = this.openFolders();
        if (root) {
          const allowed = resolveRoot(root, this.projects);
          if (!allowed) throw new Error(`The project ${root} is not available on this computer. Open it in VS Code once, or pick another project on the phone.`);
          roots = [allowed];
        }
        return { guard: createPathGuard(roots), roots, signal, onOutput, rgPath, platform: process.platform };
      },
    });

    link.on('message', (m) => {
      if (m.from !== state.brainDeviceId) return;
      if (m.message.type === 'relay.moved') void this.moveRelay(m.message.payload.url);
      else if (m.message.type === 'workspace.open') this.openProject(m.message.payload.path);
      else dispatcher.handle(m);
    });
    link.on('ready', (_roster, online) => {
      if (online.includes(state.brainDeviceId)) void this.sendStatus();
    });
    link.on('presence', (id, online) => {
      if (online && id === state.brainDeviceId) void this.sendStatus();
    });
    link.on('disconnected', () => dispatcher.killAll());

    this.replayTimer = setInterval(() => void this.persistReplay(), REPLAY_SAVE_INTERVAL_MS);
    this.link = link;
    this.dispatcher = dispatcher;
    link.connect();
    void this.sendStatus();
  }

  /** Called whenever the set of open folders on this computer changes. */
  async sendStatus(): Promise<void> {
    const open = this.openFolders();
    const history = updateHistory(this.context.globalState.get<Record<string, number>>(HISTORY_KEY) ?? {}, open);
    await this.context.globalState.update(HISTORY_KEY, history);
    this.projects = listProjects(open, history, await recentFolders());
    const state = this.state;
    if (!state || !this.link) return;
    this.link.send(state.brainDeviceId, {
      type: 'executor.status',
      payload: { workspaces: open, os: `${os.platform()} ${os.release()}`, shell: shellName(process.platform), projects: this.projects, capabilities: ['tools'] },
    });
  }

  private openProject(target: string): void {
    const project = resolveRoot(target, this.projects);
    if (!project) return log(`refusing to open unknown project ${target}`);
    if (this.openFolders().some((f) => projectKey(f) === projectKey(project))) {
      log(`${project} is already open`);
      return;
    }
    void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project), { forceNewWindow: true });
  }

  /** Both the executor link and the chat link follow the brain to the relay's new address. */
  async moveRelay(url: string): Promise<void> {
    const state = this.state;
    if (!state || !isRelayUrl(url) || state.relayUrl === url) return;
    log(`relay moved to ${url}`);
    state.relayUrl = url;
    this.link?.setRelayUrl(url);
    await saveState(this.context.secrets, state);
  }

  private async persistReplay(): Promise<void> {
    const state = this.state;
    if (!state || !this.link) return;
    state.replay = this.link.replayState();
    state.client.replay = this.chat.replayState() ?? state.client.replay;
    await saveState(this.context.secrets, state);
  }

  kill(): void {
    this.dispatcher?.killAll();
    killAllBackground();
  }

  stop(): void {
    if (this.replayTimer) clearInterval(this.replayTimer);
    this.replayTimer = undefined;
    this.dispatcher?.killAll();
    this.link?.close();
    this.link = undefined;
    this.dispatcher = undefined;
    this.state = undefined;
  }

  /** Persists replay counters before another window takes over. */
  async handOver(): Promise<void> {
    await this.persistReplay();
    killAllBackground();
    this.stop();
  }
}

async function pair(context: vscode.ExtensionContext): Promise<PairingState | undefined> {
  const defaultUrl = vscode.workspace.getConfiguration('pocketClaude').get<string>('relayUrl') ?? DEFAULT_RELAY;
  const relayUrl = await vscode.window.showInputBox({ title: 'Pocket Claude: relay address (press Enter)', value: defaultUrl, ignoreFocusOut: true });
  if (!relayUrl) return undefined;
  const codeInput = await vscode.window.showInputBox({
    title: 'Pocket Claude: pairing code',
    prompt: 'Phone: chat → ☎ → Add a computer',
    placeHolder: 'XXXX-XXXX-XXXX-XXXX',
    ignoreFocusOut: true,
  });
  if (!codeInput) return undefined;
  try {
    const code = parsePairingCode(codeInput);
    const joined = await joinAccount({
      relayUrl,
      code,
      role: 'executor',
      name: os.hostname(),
      WebSocket: WS,
      confirmSafetyNumber: async (n) =>
        (await vscode.window.showWarningMessage(`Compare this safety number with the one shown on the phone:\n\n${n}`, { modal: true }, 'Matches')) ===
        'Matches',
    });
    const clientJoined = await joinAccount({ relayUrl, code, role: 'client', name: `${os.hostname()} (VS Code)`, WebSocket: WS });
    const state: PairingState = {
      relayUrl,
      accountId: joined.reply.accountId,
      brainDeviceId: joined.reply.brainDeviceId,
      brainEncPub: joined.bundle.brainEncPub,
      executor: { deviceId: joined.deviceId, identity: serializeIdentity(joined.identity) },
      client: { deviceId: clientJoined.deviceId, identity: serializeIdentity(clientJoined.identity), replay: {} },
      replay: {},
    };
    await saveState(context.secrets, state);
    void vscode.window.showInformationMessage('Pocket Claude: paired. This computer now shows up on the phone in every VS Code window.');
    return state;
  } catch (e) {
    log(`pairing failed: ${e instanceof Error ? e.message : String(e)}`);
    void vscode.window.showErrorMessage(`Pocket Claude: pairing failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** Identity of a pairing; replay counters change every 30 s and must not trigger a restart. */
const pairingKey = (s: PairingState | undefined) => (s ? `${s.accountId}/${s.executor.deviceId}/${s.client.deviceId}` : '');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let coordinator: Coordinator | undefined;
  const followerFolders = () => coordinator?.allFollowers().flatMap((f) => f.folders) ?? [];
  const openFolders = () => {
    const seen = new Set<string>();
    return [...localFolders(), ...followerFolders()].filter((f) => !seen.has(projectKey(f)) && seen.add(projectKey(f)));
  };

  let executor: Executor | undefined;
  const chat = new ChatHost(
    WS,
    log,
    (command) => void vscode.commands.executeCommand(command),
    (url) => void executor?.moveRelay(url),
  );
  executor = new Executor(context, chat, openFolders);

  const remote = new RemotePanelHost(
    (intent) => coordinator?.send({ t: 'intent', intent }) ?? false,
    (command) => void vscode.commands.executeCommand(command),
  );
  const panelHost = new SwitchingPanelHost(chat);
  const panel = new PanelController(context.extensionUri, panelHost);

  let runningKey = '';
  const startLeader = async () => {
    const state = await loadState(context.secrets);
    runningKey = pairingKey(state);
    if (state) {
      executor.start(state);
      chat.start(state);
    } else {
      executor.stop();
      chat.stop();
    }
  };

  let statePosted: ReturnType<typeof setTimeout> | undefined;
  const postStateToFollowers = () => {
    if (statePosted) return;
    statePosted = setTimeout(() => {
      statePosted = undefined;
      coordinator?.broadcast({ t: 'state', state: chat.panelState });
    }, 50);
  };
  const unsubscribeChat = chat.onChange(() => {
    if (coordinator?.role === 'leader') postStateToFollowers();
  });

  coordinator = new Coordinator({
    pipePath: defaultPipePath(),
    tokenFile: path.join(context.globalStorageUri.fsPath, 'window.token'),
    folders: localFolders,
    log,
    events: {
      becameLeader: () => {
        panelHost.use(chat);
        void startLeader();
      },
      becameFollower: () => {
        void executor.handOver();
        chat.stop();
        panelHost.use(remote);
      },
      followersChanged: () => {
        if (executor.running) void executor.sendStatus();
        postStateToFollowers();
      },
      followerMessage: (_from: Follower, msg: WindowMessage) => {
        if (msg.t === 'kill') return executor.kill();
        if (msg.t === 'intent') {
          const intent = parseIntent(msg.intent);
          if (intent) chat.handle(intent);
        }
      },
      leaderMessage: (msg) => {
        if (msg.t === 'state') remote.update(msg.state as PanelState);
      },
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('pocketClaude.pair', async () => {
      const state = await pair(context);
      if (state && coordinator?.role === 'leader') void startLeader();
    }),
    vscode.commands.registerCommand('pocketClaude.unpair', async () => {
      await clearState(context.secrets);
      if (coordinator?.role === 'leader') void startLeader();
    }),
    vscode.commands.registerCommand('pocketClaude.kill', () => {
      if (coordinator?.role === 'follower') coordinator.send({ t: 'kill' });
      else executor.kill();
    }),
    vscode.commands.registerCommand('pocketClaude.togglePanel', () => panel.toggle()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => coordinator?.foldersChanged()),
    context.secrets.onDidChange((e) => {
      if (e.key !== 'pocketClaude.state' || coordinator?.role !== 'leader') return;
      void loadState(context.secrets).then((s) => {
        if (pairingKey(s) !== runningKey) void startLeader();
      });
    }),
    panel,
    { dispose: unsubscribeChat },
    { dispose: () => coordinator?.dispose() },
    { dispose: () => executor.stop() },
    { dispose: killAllBackground },
    { dispose: () => chat.stop() },
  );

  coordinator.start();
}

export function deactivate(): void {}
