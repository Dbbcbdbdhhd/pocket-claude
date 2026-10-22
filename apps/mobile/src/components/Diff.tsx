import { StyleSheet, Text, View } from 'react-native';
import { colors, mono, radius, space } from '../theme';

const MAX_LINES = 40;

interface DiffLine {
  sign: '+' | '-';
  text: string;
}

function toLines(sign: '+' | '-', text: string): DiffLine[] {
  return text.split('\n').map((t) => ({ sign, text: t }));
}

export function Diff({ removed, added }: { removed?: string; added?: string }) {
  const lines = [...(removed ? toLines('-', removed) : []), ...(added ? toLines('+', added) : [])];
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;
  return (
    <View style={styles.box}>
      {shown.map((l, i) => (
        <View key={i} style={[styles.line, { backgroundColor: l.sign === '+' ? colors.diffAdd : colors.diffDel }]}>
          <Text style={[styles.sign, { color: l.sign === '+' ? colors.ok : colors.danger }]}>{l.sign}</Text>
          <Text style={styles.text}>{l.text}</Text>
        </View>
      ))}
      {hidden > 0 && <Text style={styles.more}>+{hidden} more lines</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.sm, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderHi },
  line: { flexDirection: 'row', paddingHorizontal: space.sm, paddingVertical: 1, gap: space.sm },
  sign: { fontFamily: mono, fontSize: 12, width: 10 },
  text: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 12, lineHeight: 17 },
  more: { color: colors.textMuted, fontSize: 11, padding: space.sm, backgroundColor: colors.surface },
});
