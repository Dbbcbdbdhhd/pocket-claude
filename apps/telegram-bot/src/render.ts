import { parseInline, parseMarkdown, permissionPreview, shortToolName, summarizeTool, type ChatItem, type Inline } from '@pocket/client-core';

/** Telegram allows 4096 characters per message; leave room for the streaming cursor and rounding. */
export const MESSAGE_LIMIT = 4000;
export const CURSOR = ' ▍';

/** One renderable unit of a reply. Pieces are packed into messages and never split across tags. */
export type Piece =
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'tool'; text: string; failed: boolean }
  | { kind: 'error'; text: string };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function markdownPieces(text: string): Piece[] {
  return parseMarkdown(text).map((b) => (b.type === 'code' ? { kind: 'code', lang: b.lang, text: b.text } : { kind: 'para', inline: b.inline }));
}

/** What a chat item contributes to the reply: tool calls as one line, text as markdown, results nothing. */
export function itemPieces(item: ChatItem): Piece[] {
  switch (item.type) {
    case 'assistant':
      return markdownPieces(item.text);
    case 'tool':
      return [{ kind: 'tool', text: `${shortToolName(item.name)} ${summarizeTool(item.input)}`.trim(), failed: item.result?.isError === true }];
    case 'error':
      return [{ kind: 'error', text: item.message }];
    case 'user':
    case 'result':
      return [];
  }
}

export function visibleText(p: Piece): string {
  switch (p.kind) {
    case 'para':
      return p.inline.map((i) => i.text).join('');
    case 'code':
      return p.text;
    case 'tool':
      return `⚙ ${p.text}${p.failed ? ' ✗' : ''}`;
    case 'error':
      return `⚠ ${p.text}`;
  }
}

export function pieceHtml(p: Piece): string {
  switch (p.kind) {
    case 'para':
      return p.inline.map((i) => (i.code ? `<code>${escapeHtml(i.text)}</code>` : escapeHtml(i.text))).join('');
    case 'code':
      return p.lang ? `<pre><code class="language-${escapeHtml(p.lang)}">${escapeHtml(p.text)}</code></pre>` : `<pre>${escapeHtml(p.text)}</pre>`;
    case 'tool':
      return `<i>${escapeHtml(visibleText(p))}</i>`;
    case 'error':
      return escapeHtml(visibleText(p));
  }
}

/** Breaks a piece that is too long for one message along line boundaries. */
function splitPiece(p: Piece, limit: number): Piece[] {
  const text = p.kind === 'para' ? visibleText(p) : p.kind === 'code' ? p.text : visibleText(p);
  if (text.length <= limit) return [p];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = line;
    while (current.length > limit) {
      parts.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }
  if (current) parts.push(current);
  return parts.map((t) => (p.kind === 'code' ? { kind: 'code', lang: p.lang, text: t } : p.kind === 'para' ? { kind: 'para', inline: parseInline(t) } : { kind: 'error', text: t }));
}

/** Packs pieces into messages of at most `limit` visible characters; each message is self-contained HTML. */
export function packMessages(pieces: Piece[], limit = MESSAGE_LIMIT): string[] {
  const out: string[] = [];
  let html: string[] = [];
  let length = 0;
  const flush = () => {
    if (html.length) out.push(html.join('\n\n'));
    html = [];
    length = 0;
  };
  for (const piece of pieces.flatMap((p) => splitPiece(p, limit))) {
    const size = visibleText(piece).length;
    if (length && length + 2 + size > limit) flush();
    html.push(pieceHtml(piece));
    length += (length ? 2 : 0) + size;
  }
  flush();
  return out;
}

/** The permission prompt: what the tool wants to do, as a diff or a command. */
export function permissionHtml(tool: string, input: unknown): string {
  const lines = permissionPreview(tool, input).map((l) => `${l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : ''}${l.text}`);
  const body = lines.join('\n').slice(0, 3000);
  return `<pre>${escapeHtml(body)}</pre>`;
}
