import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { toolArgs } from '@pocket/protocol';
import { guarded, type ToolContext } from './types.js';

const MAX_OUTPUT = 30_000;

function git(args: string[], cwd: string, ctx: ToolContext): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, signal: ctx.signal, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('git is not installed or not on PATH'));
          return;
        }
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

const cap = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n[output truncated, ${s.length - MAX_OUTPUT} more characters]` : s);

function result(r: { stdout: string; stderr: string; code: number }, empty: string) {
  const text = [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join('\n');
  return { content: cap(text || empty), isError: r.code !== 0 };
}

export const gitStatus = guarded(async (raw, ctx) => {
  const args = toolArgs.git_status.parse(raw);
  const cwd = await ctx.guard.resolve(args.path ?? '.');
  return result(await git(['status', '--short', '--branch'], cwd, ctx), 'Clean working tree.');
});

export const gitDiff = guarded(async (raw, ctx) => {
  const args = toolArgs.git_diff.parse(raw);
  const cwd = await ctx.guard.resolve(args.path ?? '.');
  const cmd = ['diff', '--no-color', '--no-ext-diff'];
  if (args.staged) cmd.push('--staged');
  if (args.file) cmd.push('--', path.relative(cwd, await ctx.guard.resolve(args.file)));
  return result(await git(cmd, cwd, ctx), args.staged ? 'Nothing staged.' : 'No unstaged changes.');
});

export const gitCommit = guarded(async (raw, ctx) => {
  const args = toolArgs.git_commit.parse(raw);
  const cwd = await ctx.guard.resolve(args.path ?? '.');
  if (args.files?.length) {
    const files = await Promise.all(args.files.map(async (f) => path.relative(cwd, await ctx.guard.resolve(f))));
    const add = await git(['add', '--', ...files], cwd, ctx);
    if (add.code !== 0) return result(add, 'git add failed');
  }
  return result(await git(['commit', '-m', args.message], cwd, ctx), 'Committed.');
});
