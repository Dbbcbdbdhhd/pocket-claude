import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface PathGuard {
  roots: string[];
  /** Resolves `input` (absolute, or relative to the first root) to a real path inside the roots, or throws. */
  resolve(input: string): Promise<string>;
}

const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

function isInside(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

async function realpathNearest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export function createPathGuard(roots: string[]): PathGuard {
  if (roots.length === 0) throw new Error('No workspace folder is open');
  const absRoots = roots.map((r) => path.resolve(r));
  const realRoots = Promise.all(absRoots.map(realpathNearest));
  realRoots.catch(() => undefined);

  return {
    roots: absRoots,
    async resolve(input: string): Promise<string> {
      if (input.includes('\0')) throw new Error('Invalid path');
      const real = await realpathNearest(path.resolve(absRoots[0]!, input));
      if (!(await realRoots).some((r) => isInside(r, real))) {
        throw new Error(`Path is outside the workspace: ${input}`);
      }
      return real;
    },
  };
}
