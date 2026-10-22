import { Ionicons } from '@expo/vector-icons';
import type { ChatItem } from '@pocket/client-core';
import type { PermissionDecision } from '@pocket/protocol';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/Avatar';
import { ChatRow } from '../../src/components/ChatRow';
import { ClaudeAvatar } from '../../src/components/ClaudeAvatar';
import { ClaudeComposer, type ComposerActions } from '../../src/components/ClaudeComposer';
import { Composer } from '../../src/components/Composer';
import { PermissionCard } from '../../src/components/PermissionCard';
import { TypingBubble } from '../../src/components/TypingBubble';
import { makeConversations, type FakeConversation } from '../../src/content/fake';
import { isActiveNow } from '../../src/direct';
import { PERSONA } from '../../src/persona';
import { useChatState, useSession } from '../../src/session';
import { markOpened } from '../../src/state/unread';
import { colors, ownBubble, radius } from '../../src/theme';

const EMPTY: ChatItem[] = [];

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function ThreadHeader({
  avatar,
  title,
  subtitle,
  subtitleColor,
  onCall,
  onVideo,
}: {
  avatar: ReactNode;
  title: string;
  subtitle: string;
  subtitleColor?: string;
  onCall?: () => void;
  onVideo?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.header, { paddingTop: insets.top, height: 56 + insets.top }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={26} color={colors.text} />
      </Pressable>
      {avatar}
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, subtitleColor ? { color: subtitleColor } : null]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Pressable onPress={onCall} disabled={!onCall} hitSlop={10} accessibilityLabel="Computers">
        <Ionicons name="call-outline" size={24} color={colors.text} />
      </Pressable>
      <Pressable onPress={onVideo} disabled={!onVideo} hitSlop={10} accessibilityLabel="Activity">
        <Ionicons name="videocam-outline" size={27} color={colors.text} />
      </Pressable>
    </View>
  );
}

function ClaudeThread({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { client } = useSession();
  const state = useChatState();
  const keyboardVisible = useKeyboardVisible();

  const session = state.sessions.find((s) => s.sessionId === id);
  const thread = state.threads[id] ?? EMPTY;
  const loaded = state.loaded[id] === true;
  const permissions = useMemo(() => state.permissions.filter((p) => p.sessionId === id), [state.permissions, id]);
  const data = useMemo(() => [...thread].reverse(), [thread]);
  const running = session?.state === 'running' || session?.state === 'waiting_permission';
  const updatedAt = session?.updatedAt ?? 0;

  useEffect(() => {
    markOpened(id);
    return () => markOpened(id);
  }, [id]);

  useEffect(() => {
    if (updatedAt > 0) markOpened(id);
  }, [id, updatedAt]);

  useEffect(() => {
    if (client && !loaded && state.connection === 'online') client.loadHistory(id);
  }, [client, id, loaded, state.connection]);

  useEffect(() => {
    if (client && state.connection === 'online' && state.brainOnline && state.models.length === 0) client.loadModels();
  }, [client, state.connection, state.brainOnline, state.models.length]);

  const actions = useMemo<ComposerActions>(
    () => ({
      send: (text, attachments) => client?.send(id, text, attachments.map(({ mime, dataBase64, name }) => ({ mime, dataBase64, ...(name ? { name } : {}) }))) ?? false,
      stop: () => void client?.interrupt(id),
      configure: (patch) => void client?.configure(id, patch),
      newChat: () => {
        client
          ?.createSession()
          .then((next) => router.replace({ pathname: '/direct/[id]', params: { id: next } }))
          .catch(() => {});
      },
      agents: () => router.push('/direct/activity'),
      kill: () => void client?.kill(),
    }),
    [client, id, router],
  );

  const respond = useCallback(
    (requestId: string, decision: PermissionDecision) => {
      client?.respondPermission(requestId, decision);
    },
    [client],
  );

  const last = thread[thread.length - 1];
  const working = session?.state === 'running' && !(last?.type === 'assistant' && last.streaming);
  const computer = useMemo(
    () => state.computers.find((c) => c.deviceId === session?.executorId && (!c.capabilities || c.capabilities.includes('tools'))),
    [session?.executorId, state.computers],
  );
  const macOnline = state.connection === 'online' && state.brainOnline;
  const projectName = session?.project?.split(/[\\/]/).filter(Boolean).pop();
  const active = macOnline && (computer ? computer.online : true);
  const status = !session
    ? ''
    : session.state === 'running'
      ? 'Typing…'
      : session.state === 'waiting_permission'
        ? 'Waiting for approval'
        : !macOnline
          ? 'Mac offline'
          : !computer
            ? `Active now · Mac${projectName ? ` · ${projectName}` : ''}`
            : computer.online
              ? `Active now · ${computer.name}${projectName ? ` · ${projectName}` : ''}`
              : `${computer.name} offline`;

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <ThreadHeader
        avatar={<ClaudeAvatar size={36} active={active} />}
        title={PERSONA.name}
        subtitle={status}
        subtitleColor={session?.state === 'waiting_permission' ? colors.warn : undefined}
        onCall={() => router.push({ pathname: '/direct/computers', params: { sessionId: id } })}
        onVideo={actions.agents}
      />

      <FlatList
        data={data}
        inverted
        keyExtractor={(it) => it.key}
        renderItem={({ item }) => <ChatRow item={item} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListHeaderComponent={working ? <TypingBubble /> : undefined}
        ListEmptyComponent={
          loaded ? (
            <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
              <ClaudeAvatar size={72} />
              <Text style={styles.emptyName}>{PERSONA.name}</Text>
              <Text style={styles.emptyText}>Type / to pick a model, reasoning level and more.</Text>
            </View>
          ) : (
            <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
              <ActivityIndicator color={colors.text} />
            </View>
          )
        }
      />

      <View style={[styles.bottom, { paddingBottom: keyboardVisible ? 8 : insets.bottom + 8 }]}>
        {permissions.map((p) => (
          <PermissionCard key={p.requestId} request={p} onRespond={respond} />
        ))}
        <ClaudeComposer running={running} session={session} models={state.models} actions={actions} />
      </View>
    </KeyboardAvoidingView>
  );
}

function FakeThread({ conversation }: { conversation: FakeConversation }) {
  const insets = useSafeAreaInsets();
  const data = useMemo(() => [...conversation.messages].reverse(), [conversation]);
  return (
    <View style={styles.root}>
      <ThreadHeader
        avatar={<Avatar uri={conversation.person.avatar} size={36} />}
        title={conversation.person.username}
        subtitle={conversation.active ? 'Active now' : conversation.name}
      />
      <FlatList
        data={data}
        inverted
        keyExtractor={(m) => m.id}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        renderItem={({ item }) =>
          item.mine ? (
            <View style={styles.mineWrap}>
              <LinearGradient colors={ownBubble} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bubble}>
                <Text style={styles.mineText}>{item.text}</Text>
              </LinearGradient>
            </View>
          ) : (
            <View style={styles.theirsWrap}>
              <Avatar uri={conversation.person.avatar} size={28} />
              <View style={[styles.bubble, styles.theirsBubble]}>
                <Text style={styles.mineText}>{item.text}</Text>
              </View>
            </View>
          )
        }
      />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
        <Composer readOnly />
      </View>
    </View>
  );
}

export default function DirectThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversation = useMemo(() => (id.startsWith('fake-') ? makeConversations().find((c) => c.id === id) : undefined), [id]);
  return conversation ? <FakeThread conversation={conversation} /> : <ClaudeThread id={id} />;
}

function Separator() {
  return <View style={{ height: 6 }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 },
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  list: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyName: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 4 },
  emptyText: { color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  bottom: { paddingHorizontal: 12, paddingTop: 6, gap: 8 },
  mineWrap: { alignItems: 'flex-end', paddingLeft: 64 },
  theirsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingRight: 64 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  theirsBubble: { backgroundColor: colors.bubble, flexShrink: 1 },
  mineText: { color: colors.userText, fontSize: 15, lineHeight: 21 },
});
