import * as os from 'node:os';
import * as path from 'node:path';
import { toolArgs } from '@pocket/protocol';
import { guarded } from './types.js';

export function shellName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'powershell' : path.basename(process.env.SHELL ?? 'sh');
}

export const workspaceInfo = guarded(async (raw, ctx) => {
  toolArgs.workspace_info.parse(raw);
  const lines = [
    `Workspace roots:\n${ctx.roots.map((r) => `  ${r}`).join('\n')}`,
    `OS: ${os.platform()} ${os.release()}`,
    `Shell: ${shellName(ctx.platform)}`,
    `Node: ${process.version}`,
  ];
  return { content: lines.join('\n') };
});
