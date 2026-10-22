import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPathGuard } from '../src/path-guard.js';
import { gitCommit, gitDiff, gitStatus } from '../src/tools/git.js';
import type { ToolContext } from '../src/tools/types.js';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-git-'));
  const run = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  run('add', '.');
  run('commit', '-qm', 'init');
  const ctx: ToolContext = {
    guard: createPathGuard([dir]),
    roots: [dir],
    signal: new AbortController().signal,
    onOutput: () => {},
    platform: process.platform,
  };
  return { dir, ctx, run };
}

describe('git tools', () => {
  it('reports status and diff', async () => {
    const { dir, ctx } = repo();
    expect((await gitStatus({}, ctx)).content).toContain('## main');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    expect((await gitStatus({}, ctx)).content).toContain('M a.txt');
    const diff = await gitDiff({ file: 'a.txt' }, ctx);
    expect(diff.content).toContain('-one');
    expect(diff.content).toContain('+two');
    expect((await gitDiff({ staged: true }, ctx)).content).toBe('Nothing staged.');
  });

  it('stages listed files and commits', async () => {
    const { dir, ctx, run } = repo();
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    const r = await gitCommit({ message: 'add b', files: ['b.txt'] }, ctx);
    expect(r.isError).toBe(false);
    expect(run('log', '--oneline').toString()).toContain('add b');
  });

  it('fails cleanly when there is nothing to commit or the path escapes the workspace', async () => {
    const { ctx } = repo();
    expect((await gitCommit({ message: 'empty' }, ctx)).isError).toBe(true);
    expect((await gitCommit({ message: 'x', files: ['../outside.txt'] }, ctx)).isError).toBe(true);
  });
});
