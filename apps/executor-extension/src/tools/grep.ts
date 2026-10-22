import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toolArgs } from '@pocket/protocol';
import { guarded, type ToolContext } from './types.js';
import { createGlobMatcher, toPosix, walkFiles } from './walk.js';

const DEFAULT_MAX = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LINE = 500;

const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}...` : s);

function runRipgrep(rg: string, argv: string[], cwd: string, max: number, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(rg, argv, { cwd, windowsHide: true, shell: false, signal });
    const lines: string[] = [];
    let pending = '';
    let stderr = '';
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(lines);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      pending += d;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop()!;
      for (const p of parts) {
        if (lines.length >= max) break;
        if (p) lines.push(clip(p));
      }
      if (lines.length >= max) {
        child.kill();
        finish();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => (stderr += d));
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (pending && lines.length < max) lines.push(clip(pending));
      if (code === 0 || code === 1 || lines.length >= max) finish();
      else finish(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
    });
  });
}

async function nodeGrep(re: RegExp, base: string, globPattern: string | undefined, max: number, ctx: ToolContext): Promise<string[]> {
  const match = globPattern ? createGlobMatcher(globPattern) : undefined;
  const out: string[] = [];
  const target = await fs.stat(base);
  const files = target.isFile() ? (async function* () { yield base; })() : walkFiles(base, ctx.signal);
  const rootDir = target.isFile() ? path.dirname(base) : base;
  for await (const file of files) {
    const rel = toPosix(path.relative(rootDir, file));
    if (match && !match(rel)) continue;
    let buf: Buffer;
    try {
      if ((await fs.stat(file)).size > MAX_FILE_BYTES) continue;
      buf = await fs.readFile(file);
    } catch {
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        out.push(`${rel}:${i + 1}:${clip(lines[i]!)}`);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

export const grep = guarded(async (raw, ctx) => {
  const args = toolArgs.grep.parse(raw);
  const base = await ctx.guard.resolve(args.path ?? '.');
  const max = args.max_results ?? DEFAULT_MAX;

  let results: string[];
  if (ctx.rgPath) {
    const argv = ['--line-number', '--no-heading', '--color', 'never'];
    if (args.ignore_case) argv.push('-i');
    if (args.glob) argv.push('--glob', args.glob);
    argv.push('-e', args.pattern, '--', '.');
    const isFile = (await fs.stat(base)).isFile();
    const cwd = isFile ? path.dirname(base) : base;
    if (isFile) argv[argv.length - 1] = path.basename(base);
    results = await runRipgrep(ctx.rgPath, argv, cwd, max, ctx.signal);
  } else {
    results = await nodeGrep(new RegExp(args.pattern, args.ignore_case ? 'i' : ''), base, args.glob, max, ctx);
  }
  if (ctx.signal.aborted) throw new Error('Aborted');
  if (results.length === 0) return { content: 'No matches found' };
  if (results.length >= max) results.push(`[results capped at ${max}]`);
  return { content: results.join('\n') };
});
