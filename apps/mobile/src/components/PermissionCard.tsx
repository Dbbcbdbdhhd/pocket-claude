import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PermissionDecision } from '@pocket/protocol';
import type { PermissionRequest } from '@pocket/client-core';
import { asStrings, bareToolName, prettyJson, toolIcon } from '../format';
import { colors, mono, radius, space } from '../theme';
import { Diff } from './Diff';

function Preview({ tool, input }: { tool: string; input: unknown }) {
  const { command, path, content, oldString, newString } = asStrings(input);
  const name = bareToolName(tool);
  if (name === 'run_command' && command) return <Text selectable style={styles.code}>{`> ${command}`}</Text>;
  if (name === 'write_file' && content !== undefined) {
    return (
      <View style={{ gap: space.sm }}>
        {path && <Text style={styles.path}>{path}</Text>}
        <Diff added={content} />
      </View>
    );
  }
  if (name === 'edit_file' && newString !== undefined) {
    return (
      <View style={{ gap: space.sm }}>
        {path && <Text style={styles.path}>{path}</Text>}
        <Diff removed={oldString} added={newString} />
      </View>
    );
  }
  if (name === 'ExitPlanMode' && typeof (input as { plan?: unknown })?.plan === 'string') {
    return <Text selectable style={[styles.code, styles.plan]}>{(input as { plan: string }).plan}</Text>;
  }
  if (path) return <Text selectable style={styles.code}>{path}</Text>;
  return <Text selectable style={styles.code}>{prettyJson(input)}</Text>;
}

export function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
}) {
  const respond = (decision: PermissionDecision) => {
    void (decision === 'deny'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    onRespond(request.requestId, decision);
  };
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name={toolIcon(request.tool)} size={16} color={colors.warn} />
        <Text style={styles.title}>{bareToolName(request.tool) === 'ExitPlanMode' ? 'Approve the plan?' : `Claude wants to use ${bareToolName(request.tool)}`}</Text>
      </View>
      <Preview tool={request.tool} input={request.input} />
      <View style={styles.actions}>
        <Pressable onPress={() => respond('deny')} style={({ pressed }) => [styles.btn, styles.deny, pressed && styles.pressed]}>
          <Text style={[styles.btnText, { color: colors.danger }]}>Deny</Text>
        </Pressable>
        <Pressable onPress={() => respond('allow_session')} style={({ pressed }) => [styles.btn, styles.session, pressed && styles.pressed]}>
          <Text style={[styles.btnText, { color: colors.text }]}>Allow for chat</Text>
        </Pressable>
        <Pressable onPress={() => respond('allow')} style={({ pressed }) => [styles.btn, styles.allow, pressed && styles.pressed]}>
          <Text style={[styles.btnText, { color: colors.userText }]}>Allow</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderHi,
    padding: space.md,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  path: { color: colors.textDim, fontFamily: mono, fontSize: 12 },
  code: {
    color: colors.text,
    fontFamily: mono,
    fontSize: 12.5,
    lineHeight: 18,
    backgroundColor: colors.bg,
    padding: space.sm,
    borderRadius: radius.sm,
    maxHeight: 180,
    overflow: 'hidden',
  },
  plan: { fontFamily: undefined, maxHeight: 320 },
  actions: { flexDirection: 'row', gap: space.sm },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 36, borderRadius: 8 },
  deny: { backgroundColor: colors.borderHi },
  session: { backgroundColor: colors.borderHi },
  allow: { backgroundColor: colors.accent },
  btnText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
