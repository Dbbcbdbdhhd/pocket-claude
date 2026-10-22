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
