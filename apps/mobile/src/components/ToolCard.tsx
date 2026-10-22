import { Ionicons } from '@expo/vector-icons';
import { memo, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatItem } from '@pocket/client-core';
import { bareToolName, prettyJson, tail, toolIcon, toolSummary } from '../format';
import { colors, mono, radius, space } from '../theme';

type ToolItem = Extract<ChatItem, { type: 'tool' }>;

function ToolCardImpl({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const isError = item.result?.isError === true;
  const done = item.result !== undefined;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={[styles.card, isError && styles.cardError]}>
      <Pressable onPress={toggle} style={styles.head} android_ripple={{ color: colors.borderHi }}>
        <Ionicons name={toolIcon(item.name)} size={14} color={isError ? colors.danger : colors.textMuted} />
        <Text style={styles.name}>{bareToolName(item.name)}</Text>
        <Text style={styles.summary} numberOfLines={1}>
          {toolSummary(item.name, item.input)}
        </Text>
        {!done ? (
          <ActivityIndicator size="small" color={colors.textMuted} style={styles.spinner} />
        ) : (
          <Ionicons name={isError ? 'close-circle' : 'checkmark-circle'} size={15} color={isError ? colors.danger : colors.ok} />
        )}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
      </Pressable>
      {!open && item.output.length > 0 && !done && (
        <Text style={styles.peek} numberOfLines={2}>
          {tail(item.output, 2)}
        </Text>
      )}
      {open && (
        <View style={styles.body}>
          <Section title="Input" text={prettyJson(item.input)} />
          {item.output.length > 0 && <Section title="Output" text={tail(item.output, 40)} />}
          {item.result && <Section title={isError ? 'Error' : 'Result'} text={tail(item.result.content, 40) || '(empty)'} error={isError} />}
        </View>
      )}
    </View>
  );
}

function Section({ title, text, error }: { title: string; text: string; error?: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, error && { color: colors.danger }]}>{title}</Text>
      <Text selectable style={[styles.mono, error && { color: '#F2A5A1' }]}>
        {text}
      </Text>
    </View>
  );
}

export const ToolCard = memo(ToolCardImpl);

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHi,
    overflow: 'hidden',
  },
  cardError: { borderColor: 'rgba(237,73,86,0.5)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  name: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  summary: { flexShrink: 1, color: colors.textMuted, fontSize: 11.5, fontFamily: mono },
  spinner: { transform: [{ scale: 0.7 }] },
  peek: { color: colors.textMuted, fontFamily: mono, fontSize: 11, paddingHorizontal: 10, paddingBottom: 8 },
  body: { paddingHorizontal: 10, paddingBottom: 10, gap: space.sm },
  section: { gap: space.xs },
  sectionTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  mono: {
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 11.5,
    lineHeight: 16,
    backgroundColor: colors.bg,
    padding: space.sm,
    borderRadius: radius.sm,
  },
});
