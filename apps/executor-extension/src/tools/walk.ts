import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const SKIP_DIRS = new Set(['node_modules', '.git']);

export async function* walkFiles(root: string, signal?: AbortSignal): AsyncGenerator<string> {
  const stack = [root];
  while (stack.length) {
    if (signal?.aborted) return;
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const subdirs: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) subdirs.push(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]!);
  }
}

export const toPosix = (p: string) => p.split(path.sep).join('/');

function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
      } else {
        re += `(?:${pattern
          .slice(i + 1, close)
          .split(',')
          .map((alt) => globToRegExp(alt).source.slice(1, -1))
          .join('|')})`;
        i = close;
      }
    } else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
      } else {
        const body = pattern.slice(i + 1, close);
        re += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
        i = close;
      }
    } else {
      re += c.replace(/[.+^$()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Matches a forward-slash relative path. Patterns without a slash match the basename at any depth. */
export function createGlobMatcher(pattern: string): (relPosix: string) => boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const re = globToRegExp(normalized.includes('/') ? normalized : `**/${normalized}`);
  return (rel) => re.test(rel);
}
