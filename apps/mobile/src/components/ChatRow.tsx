import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatItem } from '@pocket/client-core';
import { formatResult } from '../format';
import { CopyToPc } from '../pc-clipboard';
import { colors, ownBubble, radius } from '../theme';
import { ClaudeAvatar } from './ClaudeAvatar';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';

const AVATAR = 28;
const INDENT = AVATAR + 8;

function ChatRowImpl({ item }: { item: ChatItem }) {
  switch (item.type) {
    case 'user':
      return (
        <View style={styles.userWrap}>
          <LinearGradient colors={ownBubble} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userBubble}>
            {item.images ? (
              <View style={styles.photos}>
                <Ionicons name="image" size={14} color={colors.userText} />
                <Text style={styles.photosText}>{item.images === 1 ? 'Photo' : `${item.images} photos`}</Text>
              </View>
            ) : null}
            {item.files?.map((f) => (
              <View key={f} style={styles.photos}>
                <Ionicons name="document-attach" size={14} color={colors.userText} />
                <Text style={styles.photosText} numberOfLines={1}>
                  {f}
                </Text>
              </View>
            ))}
            <Text selectable style={styles.userText}>
              {item.text}
            </Text>
          </LinearGradient>
        </View>
      );
    case 'assistant':
      return (
        <View>
          <View style={styles.assistantWrap}>
            <ClaudeAvatar size={AVATAR} />
            <View style={styles.assistantBubble}>
              <Markdown text={item.text} caret={item.streaming} />
            </View>
          </View>
          {item.streaming ? null : (
            <View style={styles.replyActions}>
              <CopyToPc text={item.text} />
            </View>
          )}
        </View>
      );
    case 'tool':
      return (
        <View style={styles.toolWrap}>
          <ToolCard item={item} />
        </View>
      );
    case 'result':
      return <Text style={styles.result}>{formatResult(item.durationMs, item.costUsd)}</Text>;
    case 'error':
      return (
        <View style={styles.error}>
          <Text selectable style={styles.errorText}>
            {item.message}
          </Text>
        </View>
      );
  }
}

export const ChatRow = memo(ChatRowImpl);

const styles = StyleSheet.create({
  userWrap: { alignItems: 'flex-end', paddingLeft: 64 },
  userBubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  userText: { color: colors.userText, fontSize: 15, lineHeight: 21 },
  photos: { flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.85, marginBottom: 2 },
  photosText: { color: colors.userText, fontSize: 12.5, fontWeight: '600' },
  assistantWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingRight: 40 },
  assistantBubble: {
    flexShrink: 1,
    backgroundColor: colors.bubble,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  replyActions: { flexDirection: 'row', gap: 8, paddingLeft: INDENT, paddingTop: 4 },
  toolWrap: { paddingLeft: INDENT, paddingRight: 24 },
  result: { color: colors.textMuted, fontSize: 11, textAlign: 'center', opacity: 0.8 },
  error: {
    marginLeft: INDENT,
    backgroundColor: colors.dangerSoft,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(237,73,86,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { color: '#F6A5AC', fontSize: 14, lineHeight: 20 },
});
