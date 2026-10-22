import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatResultLine,
  parseInline,
  permissionPreview,
  parseMarkdown,
  shortToolName,
  summarizeTool,
  tail,
  truncate,
} from '../src/panel/webview/format.js';
import { buildHtml } from '../src/panel/html.js';
import { parseIntent } from '../src/panel/protocol.js';

describe('parseMarkdown', () => {
  it('splits paragraphs and inline code', () => {
    expect(parseMarkdown('hello `x` world\n\nsecond')).toEqual([
      { type: 'paragraph', inline: [{ code: false, text: 'hello ' }, { code: true, text: 'x' }, { code: false, text: ' world' }] },
      { type: 'paragraph', inline: [{ code: false, text: 'second' }] },
    ]);
  });

  it('parses fenced code blocks with language', () => {
    expect(parseMarkdown('before\n```ts\nconst a = 1;\n\nb\n```\nafter')).toEqual([
      { type: 'paragraph', inline: [{ code: false, text: 'before' }] },
      { type: 'code', lang: 'ts', text: 'const a = 1;\n\nb' },
      { type: 'paragraph', inline: [{ code: false, text: 'after' }] },
    ]);
  });

  it('treats an unterminated fence as code to the end', () => {
    expect(parseMarkdown('```\nlet x')).toEqual([{ type: 'code', lang: '', text: 'let x' }]);
  });

  it('keeps markup-looking text verbatim', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)> `<b>`');
    expect(blocks).toEqual([
      { type: 'paragraph', inline: [{ code: false, text: '<img src=x onerror=alert(1)> ' }, { code: true, text: '<b>' }] },
    ]);
  });

  it('leaves an unmatched backtick as text', () => {
    expect(parseInline('a ` b')).toEqual([{ code: false, text: 'a ` b' }]);
  });
});

describe('tool summaries', () => {
  it('prefers command, then path-like fields', () => {
    expect(summarizeTool({ command: 'ls -la\nsecond', cwd: '/x' })).toBe('ls -la');
    expect(summarizeTool({ file_path: 'src/a.ts', offset: 1 })).toBe('src/a.ts');
    expect(summarizeTool({ pattern: 'foo', path: 'src' })).toBe('foo in src');
  });

  it('falls back to JSON and truncates', () => {
    expect(summarizeTool({ n: 1 })).toBe('{"n":1}');
    expect(summarizeTool({})).toBe('');
    expect(summarizeTool({ command: 'x'.repeat(200) }, 10)).toBe(`${'x'.repeat(9)}…`);
    expect(summarizeTool(null)).toBe('');
  });

  it('strips the MCP prefix from tool names', () => {
    expect(shortToolName('mcp__pocket__read_file')).toBe('read_file');
    expect(shortToolName('Bash')).toBe('Bash');
  });
});

describe('formatting', () => {
  it('formats duration and result line', () => {
    expect(formatDuration(420)).toBe('420ms');
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatResultLine(1500, 0.0123)).toBe('1.5s · $0.01');
    expect(formatResultLine(undefined, 0.0012)).toBe('$0.0012');
    expect(formatResultLine()).toBe('');
  });

  it('truncates and tails', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(tail('abcdef', 3)).toBe('…def');
    expect(tail('abc', 3)).toBe('abc');
  });
});

describe('parseIntent', () => {
  it('accepts valid intents', () => {
    expect(parseIntent({ type: 'send', sessionId: null, text: 'hi' })).toEqual({ type: 'send', sessionId: null, text: 'hi' });
    expect(parseIntent({ type: 'permission', requestId: 'r', decision: 'allow_session' })).toEqual({
      type: 'permission',
      requestId: 'r',
      decision: 'allow_session',
    });
    expect(parseIntent({ type: 'kill', extra: 1 })).toEqual({ type: 'kill' });
  });

  it('rejects malformed intents', () => {
    expect(parseIntent(null)).toBeUndefined();
    expect(parseIntent({ type: 'nope' })).toBeUndefined();
    expect(parseIntent({ type: 'select' })).toBeUndefined();
    expect(parseIntent({ type: 'send', sessionId: 1, text: 'x' })).toBeUndefined();
    expect(parseIntent({ type: 'permission', requestId: 'r', decision: 'maybe' })).toBeUndefined();
  });
});

describe('buildHtml', () => {
  it('uses a nonce-only CSP and loads the script by uri', () => {
    const html = buildHtml({ scriptUri: 'https://x/webview.js', nonce: 'abc' });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc'");
    expect(html).toContain('<script nonce="abc" src="https://x/webview.js">');
    expect(html).not.toContain('unsafe-inline');
  });
});

describe('permissionPreview', () => {
  it('renders edit_file as removed then added lines', () => {
    expect(permissionPreview('mcp__pocket__edit_file', { path: 'a', old_string: 'x', new_string: 'y\nz' })).toEqual([
      { kind: 'del', text: 'x' },
      { kind: 'add', text: 'y' },
      { kind: 'add', text: 'z' },
    ]);
  });

  it('shows the command for run_command and caps long previews', () => {
    expect(permissionPreview('run_command', { command: 'npm test' })).toEqual([{ kind: 'ctx', text: 'npm test' }]);
    const long = permissionPreview('write_file', { path: 'a', content: Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n') });
    expect(long).toHaveLength(61);
    expect(long.at(-1)?.text).toContain('40 more lines');
  });
});
