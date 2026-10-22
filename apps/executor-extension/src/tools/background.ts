import { toolArgs } from '@pocket/protocol';
import { killTree, spawnShell } from './run-command.js';
import { guarded } from './types.js';

const MAX_BUFFER = 200_000;
const MAX_CHUNK = 30_000;
const MAX_FINISHED = 20;

interface BackgroundCommand {
  id: string;
  command: string;
  platform: NodeJS.Platform;
  child: ReturnType<typeof spawnShell>;
  output: string;
  /** Absolute offset into the full output stream that the next read starts from. */
  readFrom: number;
  /** Absolute offset of `output[0]`; grows as old output is dropped. */
  base: number;
  exitCode: number | null | undefined;
  waiters: Set<() => void>;
}

const commands = new Map<string, BackgroundCommand>();
let seq = 0;

function notify(cmd: BackgroundCommand): void {
  for (const w of cmd.waiters) w();
  cmd.waiters.clear();
}

function pruneFinished(): void {
  const finished = [...commands.values()].filter((c) => c.exitCode !== undefined);
  for (const c of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) commands.delete(c.id);
}

export function startBackground(command: string, cwd: string, platform: NodeJS.Platform): string {
  pruneFinished();
  const id = `bg${++seq}`;
  const child = spawnShell(command, cwd, platform);
  const cmd: BackgroundCommand = { id, command, platform, child, output: '', readFrom: 0, base: 0, exitCode: undefined, waiters: new Set() };
  const append = (d: Buffer) => {
    cmd.output += d.toString('utf8');
    if (cmd.output.length > MAX_BUFFER) {
      const drop = cmd.output.length - MAX_BUFFER;
      cmd.output = cmd.output.slice(drop);
      cmd.base += drop;
    }
    notify(cmd);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (e) => {
    cmd.output += `${e.message}\n`;
    cmd.exitCode ??= null;
    notify(cmd);
  });
  child.on('close', (code) => {
    cmd.exitCode = code;
    notify(cmd);
  });
  commands.set(id, cmd);
  return id;
}

export function killAllBackground(): void {
  for (const c of commands.values()) if (c.exitCode === undefined) killTree(c.child, c.platform);
}

function status(cmd: BackgroundCommand): string {
  if (cmd.exitCode === undefined) return 'still running';
  return cmd.exitCode === null ? 'exited (killed)' : `exited with code ${cmd.exitCode}`;
}

export const commandOutput = guarded(async (raw, ctx) => {
  const args = toolArgs.command_output.parse(raw);
  const cmd = commands.get(args.id);
  if (!cmd) throw new Error(`No background command with id ${args.id}`);
  const hasNew = () => cmd.base + cmd.output.length > cmd.readFrom || cmd.exitCode !== undefined;
  if (!hasNew() && args.wait_ms) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', done);
        cmd.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, args.wait_ms);
      ctx.signal.addEventListener('abort', done, { once: true });
      cmd.waiters.add(done);
    });
  }
  const start = Math.max(cmd.readFrom, cmd.base);
  const skipped = start - cmd.readFrom;
  let text = cmd.output.slice(start - cmd.base);
  if (text.length > MAX_CHUNK) text = `[${text.length - MAX_CHUNK} characters skipped]\n${text.slice(-MAX_CHUNK)}`;
  cmd.readFrom = cmd.base + cmd.output.length;
  const head = skipped > 0 ? `[${skipped} older characters dropped]\n` : '';
  return { content: `${head}${text}${text && !text.endsWith('\n') ? '\n' : ''}[${args.id}: ${status(cmd)}]` };
});

export const commandKill = guarded(async (raw) => {
  const args = toolArgs.command_kill.parse(raw);
  const cmd = commands.get(args.id);
  if (!cmd) throw new Error(`No background command with id ${args.id}`);
  if (cmd.exitCode !== undefined) return { content: `${args.id} already ${status(cmd)}` };
  killTree(cmd.child, cmd.platform);
  return { content: `Stopping ${args.id}` };
});
