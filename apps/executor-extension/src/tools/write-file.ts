import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';

export const writeFile = guarded(async (raw, ctx) => {
  const args = toolArgs.write_file.parse(raw);
  const file = await ctx.guard.resolve(args.path);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, args.content, 'utf8');
  return { content: `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${args.path}` };
});
