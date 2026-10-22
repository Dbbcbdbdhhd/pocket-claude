/**
 * Local demo stack: node relay + brain (real Claude Code) + a fake executor on a temp workspace.
 * Prints a pairing link for the phone / VS Code panel and keeps running.
 *
 *   pnpm tsx tools/scripts/dev-stack.ts [--model haiku] [--port 8787] [--workspace <dir>]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);

const home = mkdtempSync(join(tmpdir(), 'pocket-dev-home-'));
process.env.POCKET_HOME = home;
process.env.POCKET_LOG_DIR = join(home, 'logs');
process.env.POCKET_NO_KEYCHAIN = '1';

const { generateIdentity, parsePairingUri } = await import('../../packages/protocol/src/index.js');
const { DeviceLink, joinAccount } = await import('../../packages/transport/src/index.js');
const { startNodeRelay } = await import('../../apps/relay/src/node-server.js');
const { Brain } = await import('../../apps/brain/src/daemon.js');
const { ensureDirs } = await import('../../apps/brain/src/store.js');
const { logToStderr } = await import('../../apps/brain/src/log.js');
const { ToolDispatcher } = await import('../../apps/executor-extension/src/dispatch.js');
const { createPathGuard } = await import('../../apps/executor-extension/src/path-guard.js');

const workspace = arg('--workspace') ?? mkdtempSync(join(tmpdir(), 'pocket-dev-ws-'));
if (!arg('--workspace')) {
  writeFileSync(join(workspace, 'README.md'), '# Demo project\n');
  writeFileSync(join(workspace, 'main.py'), 'def add(a, b):\n    return a - b\n');
}

ensureDirs();
logToStderr(true);
const relay = await startNodeRelay({ port: Number(arg('--port') ?? 8787), host: '0.0.0.0' });
const relayUrl = `http://127.0.0.1:${new URL(relay.url).port}`;
const claudePath = execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim();
const brain = new Brain(
  generateIdentity(),
  { relayUrl, devices: [], users: [], allowlist: [], sessions: [], replay: {} },
  { persist: false, claudeOptions: { pathToClaudeCodeExecutable: claudePath, ...(arg('--model') ? { model: arg('--model') } : {}) } },
);
brain.start();
await new Promise<void>((resolve) => {
  const t = setInterval(() => brain.status().relayConnected && (clearInterval(t), resolve()), 50);
});

const ticket = brain.startPairing();
const exec = await joinAccount({ relayUrl, code: parsePairingUri(ticket.uri).code, role: 'executor', name: 'demo-executor' });
const link = new DeviceLink({
  relayUrl,
  accountId: exec.bundle.accountId,
  deviceId: exec.deviceId,
  role: 'executor',
  identity: exec.identity,
  peers: { [exec.bundle.brainDeviceId]: exec.bundle.brainEncPub },
});
const dispatcher = new ToolDispatcher({
  brainDeviceId: exec.bundle.brainDeviceId,
  send: (body) => link.send(exec.bundle.brainDeviceId, body),
  createContext: (signal, onOutput) => ({ guard: createPathGuard([workspace]), roots: [workspace], signal, onOutput, platform: process.platform }),
});
link.on('message', (m) => dispatcher.handle(m));
link.on('ready', () =>
  link.send(exec.bundle.brainDeviceId, { type: 'executor.status', payload: { workspaces: [workspace], os: process.platform, shell: 'sh' } }),
);
link.connect();

if (process.argv.includes('--clipboard')) {
  const { ClipboardAgent } = await import('../../apps/clipboard-agent/src/agent.js');
  const { macClipboard } = await import('../../apps/clipboard-agent/src/clipboard.js');
  const { serializeIdentity } = await import('../../packages/protocol/src/index.js');
  const t = brain.startPairing();
  const clip = await joinAccount({ relayUrl, code: parsePairingUri(t.uri).code, role: 'executor', name: 'dev-clipboard' });
  new ClipboardAgent(
    {
      relayUrl,
      accountId: clip.bundle.accountId,
      brainDeviceId: clip.bundle.brainDeviceId,
      brainEncPub: clip.bundle.brainEncPub,
      deviceId: clip.deviceId,
      identity: serializeIdentity(clip.identity),
      replay: {},
    },
    { clipboard: macClipboard, log: (m) => console.log(`clipboard: ${m}`), onRelayMoved: () => {} },
  ).connect();
}

console.log(`\nrelay      ${relayUrl}\nworkspace  ${workspace}\npair link  ${ticket.uri}\ncode       ${ticket.code}  (safety ${ticket.safetyNumber}, valid 5 min)\n`);
process.on('SIGINT', async () => {
  brain.stop();
  link.close();
  await relay.close();
  process.exit(0);
});
