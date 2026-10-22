import * as fs from 'node:fs/promises';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';

export const editFile = guarded(async (raw, ctx) => {
  const args = toolArgs.edit_file.parse(raw);
  if (args.old_string === args.new_string) throw new Error('old_string and new_string are identical');
  if (args.old_string === '') throw new Error('old_string must not be empty');
  const file = await ctx.guard.resolve(args.path);
  const text = await fs.readFile(file, 'utf8');

  let count = 0;
  for (let i = text.indexOf(args.old_string); i !== -1; i = text.indexOf(args.old_string, i + args.old_string.length)) count++;
  if (count === 0) throw new Error('old_string not found in file');
  if (count > 1 && !args.replace_all) {
    throw new Error(`old_string occurs ${count} times; add more context or set replace_all`);
  }

  const updated = args.replace_all
    ? text.split(args.old_string).join(args.new_string)
    : text.replace(args.old_string, () => args.new_string);
  await fs.writeFile(file, updated, 'utf8');
  return { content: `Replaced ${count} occurrence${count === 1 ? '' : 's'} in ${args.path}` };
});
