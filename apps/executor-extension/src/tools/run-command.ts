import { spawn, type ChildProcess } from 'node:child_process';
import { toolArgs } from '@pocket/protocol';
import { startBackground } from './background.js';
import { guarded } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 30_000;

export function killTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (child.pid === undefined) return;
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function spawnShell(command: string, cwd: string, platform: NodeJS.Platform): ChildProcess & { stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> } {
  const win = platform === 'win32';
  const [file, argv] = win ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]] : ['/bin/sh', ['-c', command]];
  return spawn(file, argv, { cwd, windowsHide: true, shell: false, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] }) as ReturnType<typeof spawnShell>;
}

export const runCommand = guarded(async (raw, ctx) => {
  const args = toolArgs.run_command.parse(raw);
  const cwd = await ctx.guard.resolve(args.cwd ?? '.');
  if (args.background) {
    const id = startBackground(args.command, cwd, ctx.platform);
    return { content: `Started in the background with id ${id}. Read its output with command_output, stop it with command_kill.` };
  }
  const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawnShell(args.command, cwd, ctx.platform);
    let combined = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const append = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
      const chunk = d.toString('utf8');
      combined += chunk;
      if (combined.length > MAX_OUTPUT * 4) combined = combined.slice(-MAX_OUTPUT * 2);
      ctx.onOutput(chunk, stream);
    };
    child.stdout.on('data', append('stdout'));
    child.stderr.on('data', append('stderr'));

    const stop = () => killTree(child, ctx.platform);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    const finish = (code: number | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
      let text = combined.length > MAX_OUTPUT ? `[output truncated]\n${combined.slice(-MAX_OUTPUT)}` : combined;
      if (spawnError) text += `${text && !text.endsWith('\n') ? '\n' : ''}${spawnError.message}`;
      const suffix = timedOut ? `timed out after ${timeoutMs}ms` : aborted ? 'aborted' : `exit code ${code ?? -1}`;
      resolve({
        content: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${suffix}`,
        isError: spawnError !== undefined || timedOut || aborted || code !== 0,
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
});
