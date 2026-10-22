export type Inline = { code: boolean; text: string };
export type Block = { type: 'paragraph'; inline: Inline[] } | { type: 'code'; lang: string; text: string };

const FENCE = /^ {0,3}```\s*([^\s`]*)\s*$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) });
    out.push({ code: true, text: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out;
}

/** Light markdown: paragraphs, inline code, fenced code blocks. An unterminated fence runs to the end (streaming). */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let code: { lang: string; lines: string[] } | undefined;

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', inline: parseInline(para.join('\n')) });
    para = [];
  };

  for (const line of text.split('\n')) {
    if (code) {
      if (FENCE.test(line) && FENCE.exec(line)?.[1] === '') {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = undefined;
      } else code.lines.push(line);
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      code = { lang: fence[1] ?? '', lines: [] };
    } else if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  return blocks;
}

const SUMMARY_KEYS = ['command', 'file_path', 'pattern', 'path', 'glob', 'query', 'url', 'description'] as const;

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function shortToolName(name: string): string {
  const i = name.lastIndexOf('__');
  return i >= 0 && i + 2 < name.length ? name.slice(i + 2) : name;
}

/** One-line description of a tool call: its path, command or pattern. */
export function summarizeTool(input: unknown, max = 100): string {
  if (typeof input === 'string') return truncate(input.split('\n')[0] ?? '', max);
  if (typeof input !== 'object' || input === null) return '';
  const obj = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      const extra = key === 'pattern' && typeof obj.path === 'string' ? ` in ${obj.path}` : '';
      return truncate(`${v.trim().split('\n')[0] ?? ''}${extra}`, max);
    }
  }
  const json = JSON.stringify(input);
  return json === '{}' ? '' : truncate(json, max);
}

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
