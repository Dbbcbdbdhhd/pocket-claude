import * as fs from 'node:fs/promises';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';

const CAP = 1000;

export const listDir = guarded(async (raw, ctx) => {
  const args = toolArgs.list_dir.parse(raw);
  const dir = await ctx.guard.resolve(args.path ?? '.');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, CAP);
  if (names.length > CAP) shown.push(`[${names.length - CAP} more entries not shown]`);
  return { content: shown.join('\n') };
});
