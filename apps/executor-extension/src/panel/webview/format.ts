// Markdown and tool summaries live in client-core so the phone, the panel and the Windows overlay agree.
import { shortToolName } from '@pocket/client-core/src/format.js';

export { parseInline, parseMarkdown, shortToolName, summarizeTool, truncate, type Block, type Inline } from '@pocket/client-core/src/format.js';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

export function formatResultLine(durationMs?: number, costUsd?: number): string {
  const parts: string[] = [];
  if (durationMs !== undefined) parts.push(formatDuration(durationMs));
  if (costUsd !== undefined) parts.push(formatCost(costUsd));
  return parts.join(' · ');
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

export type PreviewLine = { kind: 'add' | 'del' | 'ctx'; text: string };

const MAX_PREVIEW_LINES = 60;

/** What the user needs to see to approve a tool call: the command, or the change as a diff. */
export function permissionPreview(tool: string, input: unknown): PreviewLine[] {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const lines = (s: unknown) => (typeof s === 'string' ? s.split('\n') : []);
  let out: PreviewLine[];
  switch (shortToolName(tool)) {
    case 'run_command':
      out = lines(args.command).map((text) => ({ kind: 'ctx', text }));
      break;
    case 'edit_file':
      out = [...lines(args.old_string).map((text) => ({ kind: 'del' as const, text })), ...lines(args.new_string).map((text) => ({ kind: 'add' as const, text }))];
      break;
    case 'write_file':
      out = lines(args.content).map((text) => ({ kind: 'add', text }));
      break;
    default:
      out = prettyJson(input).split('\n').map((text) => ({ kind: 'ctx', text }));
  }
  if (out.length <= MAX_PREVIEW_LINES) return out;
  return [...out.slice(0, MAX_PREVIEW_LINES), { kind: 'ctx', text: `… ${out.length - MAX_PREVIEW_LINES} more lines` }];
}
