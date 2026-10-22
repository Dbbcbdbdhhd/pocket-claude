import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

export function Composer({
  running = false,
  readOnly = false,
  onSend,
  onStop,
}: {
  running?: boolean;
  readOnly?: boolean;
  onSend?: (text: string) => boolean;
  onStop?: () => void;
}) {
  const [text, setText] = useState('');
  const canSend = !readOnly && text.trim().length > 0;

  const send = () => {
    if (!canSend || !onSend) return;
    if (onSend(text.trim())) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setText('');
    }
  };

  const stop = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStop?.();
  };

  return (
    <View style={styles.pill}>
      <View style={styles.camera}>
        <Ionicons name="camera" size={18} color="#FFFFFF" />
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        editable={!readOnly}
        placeholder="Message…"
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={20000}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
      />
      {canSend ? (
        <Pressable onPress={send} hitSlop={8} accessibilityLabel="Send" style={styles.sendBtn}>
          <Text style={styles.send}>Send</Text>
        </Pressable>
      ) : running ? (
        <Pressable onPress={stop} hitSlop={8} accessibilityLabel="Stop" style={styles.sendBtn}>
          <Ionicons name="stop-circle" size={28} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.icons}>
          <Ionicons name="mic-outline" size={24} color={colors.text} />
          <Ionicons name="image-outline" size={24} color={colors.text} />
          <Ionicons name="happy-outline" size={24} color={colors.text} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'flex-end', minHeight: 44, borderRadius: 24, backgroundColor: colors.surfaceHi, paddingHorizontal: 6, paddingVertical: 6, gap: 8 },
  camera: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 120, minHeight: 32, paddingVertical: 5, paddingHorizontal: 0, color: colors.text, fontSize: 15 },
  icons: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 32, paddingRight: 8 },
  sendBtn: { height: 32, justifyContent: 'center', paddingHorizontal: 8 },
  send: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
