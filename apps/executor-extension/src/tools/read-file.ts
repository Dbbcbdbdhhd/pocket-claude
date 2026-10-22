import * as fs from 'node:fs/promises';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_LINE = 2000;
const DEFAULT_LIMIT = 2000;

export const readFile = guarded(async (raw, ctx) => {
  const args = toolArgs.read_file.parse(raw);
  const file = await ctx.guard.resolve(args.path);
  const stat = await fs.stat(file);
  if (stat.isDirectory()) throw new Error(`${args.path} is a directory`);
  if (stat.size > MAX_BYTES) throw new Error(`File is too large (${stat.size} bytes, limit ${MAX_BYTES})`);
  const buf = await fs.readFile(file);
  if (buf.subarray(0, 8192).includes(0)) throw new Error('Refusing to read a binary file');

  const lines = buf.toString('utf8').split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const start = (args.offset ?? 1) - 1;
  const end = Math.min(lines.length, start + (args.limit ?? DEFAULT_LIMIT));
  if (start >= lines.length && lines.length > 0) throw new Error(`Offset ${args.offset} is past the end of the file (${lines.length} lines)`);

  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    const text = line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}... [truncated]` : line;
    out.push(`${String(i + 1).padStart(6)}\t${text}`);
  }
  if (end < lines.length) out.push(`[${lines.length - end} more lines not shown; use offset ${end + 1}]`);
  return { content: out.join('\n') };
});
