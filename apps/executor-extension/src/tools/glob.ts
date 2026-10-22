import * as path from 'node:path';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';
import { createGlobMatcher, toPosix, walkFiles } from './walk.js';

const CAP = 1000;

export const glob = guarded(async (raw, ctx) => {
  const args = toolArgs.glob.parse(raw);
  const base = await ctx.guard.resolve(args.path ?? '.');
  const match = createGlobMatcher(args.pattern);
  const results: string[] = [];
  let truncated = false;
  for await (const file of walkFiles(base, ctx.signal)) {
    if (!match(toPosix(path.relative(base, file)))) continue;
    if (results.length >= CAP) {
      truncated = true;
      break;
    }
    results.push(toPosix(path.relative(base, file)));
  }
  if (ctx.signal.aborted) throw new Error('Aborted');
  if (truncated) results.push(`[results truncated at ${CAP}]`);
  return { content: results.length ? results.join('\n') : 'No files matched' };
});
