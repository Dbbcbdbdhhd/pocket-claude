import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection, createServer, type Socket } from 'node:net';
import qrcode from 'qrcode-terminal';
import { Brain, type BrainStatus, type PairingTicket } from './daemon.js';
import { log, logToStderr } from './log.js';
import { ensureDirs, loadOrCreateIdentity, loadState, paths, saveState } from './store.js';

type Request =
  | { cmd: 'status' }
  | { cmd: 'pair' }
  | { cmd: 'remove'; deviceId: string }
  | { cmd: 'kill' }
  | { cmd: 'allow.list' }
  | { cmd: 'allow.add'; rule: string }
  | { cmd: 'allow.remove'; rule: string }
  | { cmd: 'relay.move'; url: string }
  | { cmd: 'stop' };

type Response = { ok: true; data?: unknown } | { ok: false; error: string };

function resolveClaude(): string | undefined {
  if (process.env.POCKET_CLAUDE_PATH) return process.env.POCKET_CLAUDE_PATH;
  try {
    return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function runDaemon(): Promise<void> {
  ensureDirs();
  logToStderr(process.stderr.isTTY ?? false);
  const state = loadState();
  if (process.env.POCKET_RELAY_URL) state.relayUrl = process.env.POCKET_RELAY_URL;
  const identity = await loadOrCreateIdentity();
  const claudePath = resolveClaude();
  const brain = new Brain(identity, state, { claudeOptions: claudePath ? { pathToClaudeCodeExecutable: claudePath } : {} });
  log(`brain ${brain.deviceId} account ${brain.accountId} relay ${state.relayUrl} claude ${claudePath ?? 'bundled'}`);

  if (existsSync(paths.socket)) unlinkSync(paths.socket);
  const server = createServer((socket) => handleControl(socket, brain, () => shutdown()));
  server.listen(paths.socket);

  const shutdown = () => {
    log('shutting down');
    server.close();
    brain.stop();
    if (existsSync(paths.socket)) unlinkSync(paths.socket);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  brain.start();
}

function handleControl(socket: Socket, brain: Brain, shutdown: () => void): void {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    const reply = (r: Response) => socket.end(`${JSON.stringify(r)}\n`);
    try {
      const req = JSON.parse(buf.slice(0, nl)) as Request;
      switch (req.cmd) {
        case 'status':
          return reply({ ok: true, data: brain.status() });
        case 'pair':
          return reply({ ok: true, data: brain.startPairing() });
        case 'remove':
          return reply(brain.removeDevice(req.deviceId) ? { ok: true } : { ok: false, error: 'No such device' });
        case 'kill':
          brain.kill();
          return reply({ ok: true });
        case 'relay.move':
          return reply({ ok: true, data: brain.movePublicRelay(req.url) });
        case 'allow.list':
          return reply({ ok: true, data: brain.allowlist() });
        case 'allow.add': {
          const error = brain.addAllowRule(req.rule);
          return reply(error ? { ok: false, error } : { ok: true, data: brain.allowlist() });
        }
        case 'allow.remove':
          return reply(brain.removeAllowRule(req.rule) ? { ok: true, data: brain.allowlist() } : { ok: false, error: 'No such rule' });
        case 'stop':
          reply({ ok: true });
          setTimeout(shutdown, 50);
          return;
      }
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

function request(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(paths.socket);
    let buf = '';
    socket.on('connect', () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on('data', (d) => (buf += d.toString()));
    socket.on('end', () => resolve(JSON.parse(buf) as Response));
    socket.on('error', () => reject(new Error('The pocket-claude daemon is not running. Start it with: pocket-claude daemon')));
  });
}

async function call<T>(req: Request): Promise<T> {
  const res = await request(req);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

function printStatus(s: BrainStatus): void {
  const dot = (b: boolean) => (b ? '●' : '○');
  console.log(`Relay      ${dot(s.relayConnected)} ${s.relayUrl}`);
  console.log(`Claude     ${s.claudeVersion ?? 'not found'}`);
  console.log(`Windows    ${dot(s.executorOnline)} ${s.workspaces.join(', ') || '(no workspace)'}`);
  console.log(`Account    ${s.accountId}`);
  console.log('Devices');
  if (!s.devices.length) console.log('  (none — run: pocket-claude pair)');
  for (const d of s.devices) console.log(`  ${dot(d.online)} ${d.role.padEnd(8)} ${d.name}  ${d.deviceId}`);
  console.log(`Sessions   ${s.sessions.length}`);
}

function printTicket(t: PairingTicket): void {
  console.log('Phone: scan this QR code in the Pocket Claude app\n');
  qrcode.generate(t.uri, { small: true });
  console.log(`\nWindows (VS Code → "Pocket Claude: Pair with Mac"):\n  code           ${t.code}\n  safety number  ${t.safetyNumber}`);
  console.log(`\nValid until ${new Date(t.expiresAt).toLocaleTimeString()}. The code works for one phone and one Windows laptop.`);
}

function printUsage(days: number): void {
  const state = loadState();
  const usage = state.usage ?? { days: {}, sessions: {} };
  const money = (n: number) => `$${n.toFixed(2)}`;
  const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  const recent = Object.entries(usage.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, days);
  if (!recent.length) return console.log('No usage recorded yet.');
  console.log('Day          turns   cost      in        out');
  for (const [day, u] of recent) {
    console.log(`${day}   ${String(u.turns).padStart(5)}   ${money(u.costUsd).padStart(7)}   ${tokens(u.inputTokens).padStart(7)}   ${tokens(u.outputTokens).padStart(7)}`);
  }
  const titles = new Map(state.sessions.map((s) => [s.sessionId, s.title]));
  const top = Object.entries(usage.sessions).sort(([, a], [, b]) => b.costUsd - a.costUsd).slice(0, 5);
  console.log('\nTop chats by cost');
  for (const [id, u] of top) console.log(`  ${money(u.costUsd).padStart(7)}  ${u.turns} turns  ${titles.get(id) ?? id}`);
  console.log('\nCosts are what Claude Code reports; on a subscription they show usage, not money charged.');
}

function searchHistory(query: string): void {
  const needle = query.toLowerCase();
  const state = loadState();
  let hits = 0;
  for (const meta of [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    let lines: string[];
    try {
      lines = readFileSync(join(paths.sessionsDir, `${meta.sessionId}.jsonl`), 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line) continue;
      const e = JSON.parse(line) as { kind: string; text?: string };
      if ((e.kind !== 'user' && e.kind !== 'text') || !e.text) continue;
      const at = e.text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const start = Math.max(0, at - 60);
      const snippet = e.text.slice(start, at + needle.length + 60).replace(/\s+/g, ' ');
      console.log(`${new Date(meta.updatedAt).toLocaleDateString()}  ${meta.title}  ${e.kind === 'user' ? 'you' : 'claude'}: …${snippet}…`);
      if (++hits >= 50) return;
    }
  }
  if (!hits) console.log('Nothing found.');
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'daemon':
      return runDaemon();
    case 'status':
      return printStatus(await call<BrainStatus>({ cmd: 'status' }));
    case 'pair':
      return printTicket(await call<PairingTicket>({ cmd: 'pair' }));
    case 'remove':
      if (!arg) throw new Error('Usage: pocket-claude remove <deviceId>');
      await call({ cmd: 'remove', deviceId: arg });
      return console.log('Removed.');
    case 'kill':
      await call({ cmd: 'kill' });
      return console.log('Stopped all Claude sessions and Windows commands.');
    case 'stop':
      await call({ cmd: 'stop' });
      return console.log('Daemon stopped.');
    case 'allow': {
      const [, sub, ...rest] = process.argv.slice(2);
      const rule = rest.join(' ');
      let rules: string[];
      if (sub === 'add' && rule) rules = await call<string[]>({ cmd: 'allow.add', rule });
      else if (sub === 'remove' && rule) rules = await call<string[]>({ cmd: 'allow.remove', rule });
      else if (!sub || sub === 'list') rules = await call<string[]>({ cmd: 'allow.list' });
      else throw new Error('Usage: pocket-claude allow [list | add <rule> | remove <rule>]\n  rule: write_file | run_command:<command prefix>');
      return console.log(rules.length ? rules.map((r) => `  ${r}`).join('\n') : '  (empty — every write and command asks for approval)');
    }
    case 'usage':
      return printUsage(Number(arg ?? 14));
    case 'search':
      if (!arg) throw new Error('Usage: pocket-claude search <text>');
      return searchHistory(process.argv.slice(3).join(' '));
    case 'relay': {
      if (!arg) throw new Error('Usage: pocket-claude relay <public url>');
      const url = new URL(arg).toString();
      try {
        const next = await call<string>({ cmd: 'relay.move', url });
        return console.log(`Public relay set to ${next}. Paired devices are switching over.`);
      } catch {
        ensureDirs();
        const state = loadState();
        state.publicRelayUrl = url.replace(/\/$/, '');
        saveState(state);
        return console.log(`Daemon not running; public relay set to ${state.publicRelayUrl}. Devices switch when it starts.`);
      }
    }
    default:
      console.log('Usage: pocket-claude <daemon|status|pair|remove <deviceId>|kill|stop|relay <url>|allow ...|usage [days]|search <text>>');
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
