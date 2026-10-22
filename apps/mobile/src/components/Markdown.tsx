import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CopyToPc } from '../pc-clipboard';
import { colors, mono, radius, space } from '../theme';

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; marker: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] as string)) body.push(lines[i++] as string);
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: (heading[1] as string).length, text: heading[2] as string });
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const marker = /\d/.test(bullet[1] as string) ? (bullet[1] as string) : '•';
      blocks.push({ kind: 'bullet', marker, text: bullet[2] as string });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: 'quote', text: quote[1] as string });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (m[1]) out.push(<Text key={n++} style={styles.inlineCode}>{tok.slice(1, -1)}</Text>);
    else if (m[2]) out.push(<Text key={n++} style={styles.bold}>{tok.slice(2, -2)}</Text>);
    else if (m[3]) out.push(<Text key={n++} style={styles.italic}>{tok.slice(1, -1)}</Text>);
    else {
      const label = tok.slice(1, tok.indexOf(']'));
      out.push(<Text key={n++} style={styles.link}>{label}</Text>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MarkdownImpl({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        const tail = caret && isLast ? <Text style={styles.caret}> ▍</Text> : null;
        switch (b.kind) {
          case 'code':
            return (
              <View key={i} style={styles.codeBlock}>
                <View style={styles.codeHead}>
                  <Text style={styles.codeLang}>{b.lang}</Text>
                  {caret && isLast ? null : <CopyToPc text={b.text} compact />}
                </View>
                <Text selectable style={styles.codeText}>
                  {b.text}
                  {tail}
                </Text>
              </View>
            );
          case 'heading':
            return (
              <Text key={i} selectable style={[styles.body, styles.heading, { fontSize: 20 - b.level * 1.5 }]}>
                {renderInline(b.text)}
                {tail}
              </Text>
            );
          case 'bullet':
            return (
              <View key={i} style={styles.bulletRow}>
                <Text style={[styles.body, styles.marker]}>{b.marker}</Text>
                <Text selectable style={[styles.body, { flex: 1 }]}>
                  {renderInline(b.text)}
                  {tail}
                </Text>
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Text selectable style={[styles.body, { color: colors.textDim }]}>
                  {renderInline(b.text)}
                  {tail}
                </Text>
              </View>
            );
          case 'para':
            return (
              <Text key={i} selectable style={styles.body}>
                {renderInline(b.text)}
                {tail}
              </Text>
            );
        }
      })}
      {caret && blocks.length === 0 ? <Text style={styles.caret}>▍</Text> : null}
    </View>
  );
}

export const Markdown = memo(MarkdownImpl);

const styles = StyleSheet.create({
  root: { gap: space.sm },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  heading: { fontWeight: '700', marginTop: space.xs },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { color: '#7CC4FF', textDecorationLine: 'underline' },
  inlineCode: { fontFamily: mono, fontSize: 13.5, backgroundColor: colors.borderHi, color: colors.text },
  codeBlock: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHi,
    padding: space.md,
    gap: space.xs,
  },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 14 },
  codeLang: { color: colors.textMuted, fontSize: 11, fontFamily: mono, textTransform: 'uppercase' },
  codeText: { color: colors.text, fontFamily: mono, fontSize: 12.5, lineHeight: 18 },
  bulletRow: { flexDirection: 'row', gap: space.sm },
  marker: { color: colors.textMuted, minWidth: 16 },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.borderHi, paddingLeft: space.md },
  caret: { color: colors.textMuted },
});
