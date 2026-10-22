import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPathGuard } from '../src/path-guard.js';
import { tools, type ToolContext } from '../src/tools/index.js';

let root: string;

function ctx(over: Partial<ToolContext> = {}): ToolContext & { out: { chunk: string; stream: string }[] } {
  const out: { chunk: string; stream: string }[] = [];
  return {
    guard: createPathGuard([root]),
    roots: [root],
    signal: new AbortController().signal,
    onOutput: (chunk, stream) => out.push({ chunk, stream }),
    platform: process.platform,
    ...over,
    out,
  };
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tools-')));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('read_file', () => {
  it('numbers lines, honours offset and limit', async () => {
    await fs.writeFile(path.join(root, 'f.txt'), 'one\ntwo\nthree\nfour\n');
    const all = await tools.read_file({ path: 'f.txt' }, ctx());
    expect(all.content).toBe('     1\tone\n     2\ttwo\n     3\tthree\n     4\tfour');
    const part = await tools.read_file({ path: 'f.txt', offset: 2, limit: 2 }, ctx());
    expect(part.content).toContain('     2\ttwo\n     3\tthree');
    expect(part.content).not.toContain('one');
  });

  it('truncates long lines', async () => {
    await fs.writeFile(path.join(root, 'long.txt'), 'x'.repeat(5000));
    const r = await tools.read_file({ path: 'long.txt' }, ctx());
    expect(r.content.length).toBeLessThan(2100);
    expect(r.content).toContain('[truncated]');
  });

  it('refuses binary and oversized files, and paths outside', async () => {
    await fs.writeFile(path.join(root, 'bin'), Buffer.from([1, 2, 0, 3]));
    expect((await tools.read_file({ path: 'bin' }, ctx())).isError).toBe(true);
    await fs.writeFile(path.join(root, 'big'), Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    const big = await tools.read_file({ path: 'big' }, ctx());
    expect(big.isError).toBe(true);
    expect(big.content).toMatch(/too large/);
    const out = await tools.read_file({ path: '../nope' }, ctx());
    expect(out.isError).toBe(true);
  });

  it('rejects invalid args', async () => {
    expect((await tools.read_file({ path: 1 }, ctx())).isError).toBe(true);
  });
});

describe('write_file / edit_file', () => {
  it('creates parents and reports bytes', async () => {
    const r = await tools.write_file({ path: 'a/b/c.txt', content: 'héllo' }, ctx());
    expect(r.isError).toBeUndefined();
    expect(r.content).toContain('6 bytes');
    expect(await fs.readFile(path.join(root, 'a/b/c.txt'), 'utf8')).toBe('héllo');
  });

  it('blocks writes outside the root', async () => {
    const r = await tools.write_file({ path: '../escape.txt', content: 'x' }, ctx());
    expect(r.isError).toBe(true);
  });

  it('edits exactly once, errors on ambiguity, supports replace_all', async () => {
    const f = path.join(root, 'e.txt');
    await fs.writeFile(f, 'foo bar foo');
    const amb = await tools.edit_file({ path: 'e.txt', old_string: 'foo', new_string: 'baz' }, ctx());
    expect(amb.isError).toBe(true);
    expect(amb.content).toContain('2 times');
    const all = await tools.edit_file({ path: 'e.txt', old_string: 'foo', new_string: 'baz', replace_all: true }, ctx());
    expect(all.content).toContain('2 occurrences');
    expect(await fs.readFile(f, 'utf8')).toBe('baz bar baz');
    const one = await tools.edit_file({ path: 'e.txt', old_string: 'bar', new_string: '$&' }, ctx());
    expect(one.content).toContain('1 occurrence');
    expect(await fs.readFile(f, 'utf8')).toBe('baz $& baz');
  });

  it('errors when not found or identical', async () => {
    await fs.writeFile(path.join(root, 'e.txt'), 'abc');
    expect((await tools.edit_file({ path: 'e.txt', old_string: 'zzz', new_string: 'y' }, ctx())).content).toMatch(/not found/);
    expect((await tools.edit_file({ path: 'e.txt', old_string: 'a', new_string: 'a' }, ctx())).isError).toBe(true);
  });
});

describe('list_dir / glob / grep', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(root, 'src/deep'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/a.ts'), 'const Alpha = 1;\nconst beta = 2;\n');
    await fs.writeFile(path.join(root, 'src/deep/b.ts'), 'alpha();\n');
    await fs.writeFile(path.join(root, 'src/c.md'), 'alpha\n');
    await fs.writeFile(path.join(root, 'node_modules/pkg/x.ts'), 'alpha\n');
    await fs.writeFile(path.join(root, 'z.txt'), '');
  });

  it('lists sorted with dir suffix', async () => {
    const r = await tools.list_dir({}, ctx());
    expect(r.content.split('\n')).toEqual(['node_modules/', 'src/', 'z.txt']);
  });

  it('globs recursively, skips node_modules, uses forward slashes', async () => {
    const r = await tools.glob({ pattern: 'src/**/*.ts' }, ctx());
    expect(r.content.split('\n').sort()).toEqual(['src/a.ts', 'src/deep/b.ts']);
    const base = await tools.glob({ pattern: '*.md', path: 'src' }, ctx());
    expect(base.content).toBe('c.md');
    expect((await tools.glob({ pattern: '*.nope' }, ctx())).content).toBe('No files matched');
  });

  it('greps with the node fallback', async () => {
    const r = await tools.grep({ pattern: 'alpha', ignore_case: true, glob: '*.ts' }, ctx());
    const lines = r.content.split('\n').sort();
    expect(lines).toEqual(['src/a.ts:1:const Alpha = 1;', 'src/deep/b.ts:1:alpha();']);
    const capped = await tools.grep({ pattern: 'alpha', ignore_case: true, max_results: 1 }, ctx());
    expect(capped.content).toContain('[results capped at 1]');
    expect((await tools.grep({ pattern: 'nomatch' }, ctx())).content).toBe('No matches found');
  });
});

describe('run_command', () => {
  const node = (code: string) => `"${process.execPath}" -e "${code}"`;
  const win = process.platform === 'win32';

  it.skipIf(win)('streams stdout and stderr and reports exit code 0', async () => {
    const c = ctx();
    const r = await tools.run_command({ command: node("console.log('out');console.error('err')") }, c);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('out');
    expect(r.content).toContain('err');
    expect(r.content).toMatch(/exit code 0$/);
    expect(c.out.some((o) => o.stream === 'stdout' && o.chunk.includes('out'))).toBe(true);
    expect(c.out.some((o) => o.stream === 'stderr' && o.chunk.includes('err'))).toBe(true);
  });

  it.skipIf(win)('flags non-zero exit', async () => {
    const r = await tools.run_command({ command: node('process.exit(3)') }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/exit code 3$/);
  });

  it.skipIf(win)('uses cwd inside the root and rejects cwd outside', async () => {
    await fs.mkdir(path.join(root, 'd'));
    const r = await tools.run_command({ command: 'pwd', cwd: 'd' }, ctx());
    expect(r.content).toContain(path.join(root, 'd'));
    expect((await tools.run_command({ command: 'pwd', cwd: '/' }, ctx())).isError).toBe(true);
  });

  it.skipIf(win)('times out and kills the process tree', async () => {
    const start = Date.now();
    const r = await tools.run_command({ command: 'sleep 30 & sleep 30', timeout_ms: 1000 }, ctx());
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('timed out');
  });

  it.skipIf(win)('aborts on signal', async () => {
    const ac = new AbortController();
    const p = tools.run_command({ command: 'sleep 30' }, ctx({ signal: ac.signal }));
    setTimeout(() => ac.abort(), 200);
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.content).toContain('aborted');
  });

  it.skipIf(win)('keeps only the tail of huge output', async () => {
    const r = await tools.run_command({ command: node("process.stdout.write('x'.repeat(100000)+'END')") }, ctx());
    expect(r.content).toContain('[output truncated]');
    expect(r.content.length).toBeLessThan(30_100);
    expect(r.content).toContain('END');
  });
});

describe('workspace_info', () => {
  it('reports roots, os, shell, node', async () => {
    const r = await tools.workspace_info({}, ctx());
    expect(r.content).toContain(root);
    expect(r.content).toContain(os.platform());
    expect(r.content).toContain(process.version);
    expect(r.content).toMatch(/Shell: /);
  });
});

describe('background commands', () => {
  const node = (code: string) => `"${process.execPath}" -e "${code}"`;
  const idOf = (content: string) => /with id (\S+?)\./.exec(content)![1]!;

  it('starts, streams output incrementally and reports exit', async () => {
    const started = await tools.run_command({ command: node("console.log('a');setTimeout(()=>console.log('b'),300)"), background: true }, ctx());
    expect(started.isError).toBeFalsy();
    const id = idOf(started.content);
    const first = await tools.command_output({ id, wait_ms: 2000 }, ctx());
    expect(first.content).toContain('a');
    let last = first.content;
    for (let i = 0; i < 20 && !last.includes('exited'); i++) last = (await tools.command_output({ id, wait_ms: 500 }, ctx())).content;
    expect(last).toContain('exited with code 0');
    expect(last).not.toMatch(/^a$/m);
  });

  it('kills a running command', async () => {
    const id = idOf((await tools.run_command({ command: 'sleep 30', background: true }, ctx())).content);
    expect((await tools.command_kill({ id }, ctx())).content).toContain('Stopping');
    let out = '';
    for (let i = 0; i < 20 && !out.includes('exited'); i++) out = (await tools.command_output({ id, wait_ms: 250 }, ctx())).content;
    expect(out).toContain('exited');
    expect((await tools.command_output({ id: 'nope' }, ctx())).isError).toBe(true);
  });
});
