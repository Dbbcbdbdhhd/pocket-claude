import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPathGuard } from '../src/path-guard.js';

let tmp: string;
let root: string;
let outside: string;

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard-')));
  root = path.join(tmp, 'ws');
  outside = path.join(tmp, 'outside');
  await fs.mkdir(path.join(root, 'sub'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'a.txt'), 'a');
  await fs.writeFile(path.join(outside, 'secret.txt'), 's');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('path guard', () => {
  it('resolves relative and absolute paths inside the root', async () => {
    const g = createPathGuard([root]);
    expect(await g.resolve('a.txt')).toBe(path.join(root, 'a.txt'));
    expect(await g.resolve(path.join(root, 'sub'))).toBe(path.join(root, 'sub'));
    expect(await g.resolve('.')).toBe(root);
  });

  it('rejects .. escapes', async () => {
    const g = createPathGuard([root]);
    await expect(g.resolve('../outside/secret.txt')).rejects.toThrow(/outside the workspace/);
    await expect(g.resolve('sub/../../outside')).rejects.toThrow(/outside the workspace/);
  });

  it('rejects absolute paths outside the root and sibling prefixes', async () => {
    const g = createPathGuard([root]);
    await expect(g.resolve(path.join(outside, 'secret.txt'))).rejects.toThrow(/outside the workspace/);
    await fs.mkdir(`${root}-evil`);
    await expect(g.resolve(`${root}-evil`)).rejects.toThrow(/outside the workspace/);
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks pointing outside', async () => {
    await fs.symlink(outside, path.join(root, 'link'));
    const g = createPathGuard([root]);
    await expect(g.resolve('link/secret.txt')).rejects.toThrow(/outside the workspace/);
    await expect(g.resolve('link/new.txt')).rejects.toThrow(/outside the workspace/);
  });

  it('accepts non-existent files inside the root', async () => {
    const g = createPathGuard([root]);
    expect(await g.resolve('sub/deep/new.txt')).toBe(path.join(root, 'sub', 'deep', 'new.txt'));
  });

  it('allows any of several roots', async () => {
    const g = createPathGuard([root, outside]);
    expect(await g.resolve(path.join(outside, 'secret.txt'))).toBe(path.join(outside, 'secret.txt'));
  });
});
