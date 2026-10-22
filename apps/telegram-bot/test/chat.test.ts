import type { InnerMessage, InnerMessageBody, PairingCode, SessionEvent, SessionMeta } from '@pocket/protocol';
import type { WebSocketCtor } from '@pocket/transport';
import type { Update, UserFromGetMe } from 'grammy/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { b64, deriveAccountId, deriveDeviceId, generateIdentity, newPairingCode, openPairRequest, sealPairReply } from '@pocket/protocol';
import { DeviceLink } from '@pocket/transport';
import { startNodeRelay } from '../../relay/src/node-server.js';
import { PocketBot } from '../src/bot.js';
import { memoryStore } from '../src/store.js';

const WS = WebSocket as unknown as WebSocketCtor;
type Relay = Awaited<ReturnType<typeof startNodeRelay>>;

let relay: Relay;

const until = <T>(what: string, fn: () => T | undefined, ms = 10_000) =>
  new Promise<T>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const v = fn();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error(`timeout waiting for ${what}`));
      setTimeout(tick, 15);
    };
    tick();
  });

/**
 * A scripted Mac: answers pairing and status like the real brain, creates chats, and lets the test
 * play Claude by emitting session events. Everything the bot sends arrives in `received`.
 */
function fakeBrain() {
  const identity = generateIdentity();
  const deviceId = deriveDeviceId(identity.signPub);
  const accountId = deriveAccountId(identity.signPub);
  const link = new DeviceLink({ relayUrl: relay.url, accountId, deviceId, role: 'brain', identity, peers: {}, WebSocket: WS });
  const pairings = new Map<string, PairingCode>();
  const sessions: SessionMeta[] = [];
  const received: { from: string; message: InnerMessage }[] = [];
  const computers = [{ deviceId: 'pc1', name: 'office-pc', online: true, workspaces: [], capabilities: ['clipboard'], pairedAt: 1 }];
  const written: unknown[] = [];
  let reject: string | null = null;

  link.on('control', (f) => {
    if (f.t !== 'pair.incoming') return;
    const code = pairings.get(f.pairingId);
    if (!code) return;
    const req = openPairRequest({ brain: identity, code, blob: f.blob });
    link.addPeer(req.deviceId, req.encPub);
    link.sendControl({ t: 'roster.add', entry: { deviceId: req.deviceId, role: req.role, name: req.name, signPub: req.signPub } });
    link.sendControl({ t: 'pair.reply', pairingId: f.pairingId, deviceId: f.deviceId, blob: sealPairReply({ ok: true, accountId, brainDeviceId: deviceId, roster: [] }, req.encPub) });
  });
  const send = (to: string, body: InnerMessageBody) => link.send(to, body);
  link.on('message', ({ from, message }) => {
    received.push({ from, message });
    switch (message.type) {
      case 'status.get':
        send(from, { type: 'host.status', payload: { ready: true, claudeVersion: '2.0.0', executorOnline: true, workspaces: [], user: { id: 'owner', name: 'Me', owner: true } } });
        send(from, { type: 'computers.result', payload: { computers, activeId: 'pc1' } });
        send(from, { type: 'session.list.result', payload: { sessions } });
        return;
      case 'session.create': {
        const now = Date.now();
        const meta: SessionMeta = { sessionId: `s${sessions.length + 1}`, title: message.payload.title ?? `Chat ${sessions.length + 1}`, state: 'idle', createdAt: now, updatedAt: now, userId: 'owner' };
        sessions.unshift(meta);
        send(from, { type: 'session.created', payload: { session: meta } });
        return;
      }
      case 'session.list':
        send(from, { type: 'session.list.result', payload: { sessions } });
        return;
      case 'session.history':
        send(from, { type: 'session.history.result', payload: { sessionId: message.payload.sessionId, events: [] } });
        return;
      case 'message.send':
        if (reject) send(from, { type: 'error', payload: { code: 'no_computer', message: reject } });
        else send(from, { type: 'session.event', payload: { sessionId: message.payload.sessionId, event: { kind: 'user', text: message.payload.text, from } } });
        return;
      case 'clipboard.set':
        written.push(message.payload.item);
        send(from, { type: 'clipboard.written', payload: { requestId: message.payload.requestId, deviceId: message.payload.deviceId } });
        return;
      default:
        return;
    }
  });
  link.connect();
  return {
    deviceId,
    received,
    written,
    sessions,
    setReject: (reason: string | null) => (reject = reason),
    pairingCode: () => {
      const code = newPairingCode();
      pairings.set(code.pairingId, code);
      link.sendControl({
        t: 'pairing.publish',
        pairingId: code.pairingId,
        bundle: { v: 1, accountId, brainDeviceId: deviceId, brainSignPub: b64.encode(identity.signPub), brainEncPub: b64.encode(identity.encPub), expiresAt: Date.now() + 300_000 },
      });
      return code.display;
    },
    /** Plays Claude: sends one event of a session to every paired device. */
    emit: (sessionId: string, event: SessionEvent) => {
      for (const to of new Set(received.map((r) => r.from))) send(to, { type: 'session.event', payload: { sessionId, event } });
    },
    tell: (body: InnerMessageBody) => {
      for (const to of new Set(received.map((r) => r.from))) send(to, body);
    },
    ready: () => until('brain ready', () => (link.isReady ? true : undefined)),
    close: () => link.close(),
  };
}

const ME: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'Pocket',
  username: 'PocketTestBot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const USER = { id: 77, is_bot: false, first_name: 'Me', username: 'me', language_code: 'en' };
const CHAT = { id: 77, type: 'private' as const, first_name: 'Me' };
let updateId = 0;
let messageId = 0;
const message = (extra: Record<string, unknown>): Update => ({ update_id: ++updateId, message: { message_id: ++messageId, date: 1, chat: CHAT, from: USER, ...extra } as never });
const text = (t: string) => message({ text: t });
const command = (cmd: string, arg?: string) => message({ text: arg ? `/${cmd} ${arg}` : `/${cmd}`, entities: [{ type: 'bot_command', offset: 0, length: cmd.length + 1 }] });
const callback = (data: string, msgId: number, msgText = '') => ({ update_id: ++updateId, callback_query: { id: `cq${updateId}`, from: USER, chat_instance: 'x', data, message: { message_id: msgId, date: 1, chat: CHAT, text: msgText } } }) as never;

function fakeTelegram(bot: PocketBot) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result: unknown =
      method === 'getFile'
        ? { file_id: 'f', file_unique_id: 'u', file_path: 'photos/f.jpg' }
        : method === 'answerCallbackQuery' || method === 'editMessageText' || method === 'editMessageReplyMarkup' || method === 'sendChatAction' || method === 'setMyCommands'
          ? true
          : { message_id: ++messageId, date: 1, chat: CHAT, text: '' };
    return Promise.resolve({ ok: true as const, result: result as never });
  });
  const of = (method: string) => calls.filter((c) => c.method === method);
  return {
    calls,
    of,
    texts: () => of('sendMessage').map((c) => c.payload.text as string),
    lastText: () => of('sendMessage').map((c) => c.payload.text as string).pop(),
    lastEdit: () => of('editMessageText').pop(),
    /** The id Telegram gave the last message the bot sent. */
    lastSentId: () => messageId,
  };
}

beforeAll(async () => {
  relay = await startNodeRelay({ port: 0 });
});

afterAll(async () => {
  await relay.close();
});

describe('chat with Claude from Telegram', () => {
  it('streams a reply, shows tool calls, handles permissions, chats and errors', async () => {
    const brain = fakeBrain();
    await brain.ready();
    const bot = new PocketBot({ token: '1:test', relayUrl: relay.url, store: memoryStore(), log: () => {}, WebSocket: WS, botInfo: ME, editIntervalMs: 0, download: async () => new Uint8Array([1, 2, 3]) });
    const tg = fakeTelegram(bot);
    await bot.bot.handleUpdate(command('start', brain.pairingCode()));
    expect(tg.lastText()).toMatch(/^Linked as Me/);

    // Plain text without a chat is refused with a hint; after /new it goes to Claude.
    await bot.bot.handleUpdate(text('hello?'));
    expect(tg.lastText()).toMatch(/No chat yet/);
    await bot.bot.handleUpdate(command('new', 'Bot chat'));
    expect(tg.lastText()).toBe('New chat: Bot chat. Write to Claude here.');
    expect(brain.sessions[0]?.title).toBe('Bot chat');
    const sessionId = brain.sessions[0]!.sessionId;

    await bot.bot.handleUpdate(text('write code'));
    const sent = await until('message.send', () => brain.received.find((r) => r.message.type === 'message.send'));
    expect(sent.message.type === 'message.send' && sent.message.payload).toMatchObject({ sessionId, text: 'write code' });
    expect(tg.lastText()).toBe('… ▍');
    const replyId = tg.lastSentId();

    brain.emit(sessionId, { kind: 'state', state: 'running' });
    brain.emit(sessionId, { kind: 'text_delta', text: 'Sure, here' });
    await until('first edit', () => (tg.lastEdit()?.payload.text === 'Sure, here ▍' ? true : undefined));
    // The brain streams deltas, then the finished block, then the tool call: like Claude Code does.
    brain.emit(sessionId, { kind: 'text_delta', text: ':\n```py\nprint(1)\n```' });
    brain.emit(sessionId, { kind: 'text', text: 'Sure, here:\n```py\nprint(1)\n```' });
    brain.emit(sessionId, { kind: 'tool_use', id: 't1', name: 'mcp__pocket__run_command', input: { command: 'python a.py' } });
    await until('tool line', () => (/⚙ run_command python a.py/.test(String(tg.lastEdit()?.payload.text)) ? true : undefined));
    expect(tg.lastEdit()?.payload).toMatchObject({ message_id: replyId, parse_mode: 'HTML' });
    expect(tg.lastEdit()?.payload.text).toBe('Sure, here:\n\n<pre><code class="language-py">print(1)</code></pre>\n\n<i>⚙ run_command python a.py</i> ▍');

    // A permission prompt for the chat gets inline buttons; answering goes back to the Mac.
    brain.tell({ type: 'permission.request', payload: { requestId: 'p1', sessionId, tool: 'run_command', input: { command: 'python a.py' }, expiresAt: Date.now() + 60_000 } });
    const prompt = await until('prompt', () => tg.of('sendMessage').find((c) => /Claude wants to run run_command/.test(String(c.payload.text))));
    expect(prompt.payload.text).toBe('🔐 Claude wants to run run_command:\n<pre>python a.py</pre>');
    const buttons = (prompt.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
    expect(buttons.map((row) => row.map((b) => b.callback_data))).toEqual([['perm:p1:allow', 'perm:p1:deny'], ['perm:p1:allow_session']]);
    const promptId = tg.lastSentId();
    await bot.bot.handleUpdate(callback('perm:p1:allow', promptId, 'prompt'));
    const answer = await until('permission.respond', () => brain.received.find((r) => r.message.type === 'permission.respond'));
    expect(answer.message.type === 'permission.respond' && answer.message.payload).toEqual({ requestId: 'p1', decision: 'allow' });
    expect(tg.of('editMessageText').find((c) => c.payload.message_id === promptId)?.payload.text).toBe('prompt\n\n✅ Allowed');

    // One answered on the phone is marked as such.
    brain.tell({ type: 'permission.request', payload: { requestId: 'p2', sessionId, tool: 'write_file', input: { file_path: 'a.py', content: 'x' }, expiresAt: Date.now() + 60_000 } });
    await until('prompt 2', () => tg.of('sendMessage').find((c) => /write_file/.test(String(c.payload.text))));
    brain.tell({ type: 'permission.resolved', payload: { requestId: 'p2', decision: 'deny', by: 'phone' } });
    await until('resolved note', () => (tg.lastText() === 'Answered on another device.' ? true : undefined));

    // The turn ends with the result; the final edit has no cursor.
    brain.emit(sessionId, { kind: 'tool_result', id: 't1', content: 'ok', isError: false });
    brain.emit(sessionId, { kind: 'text_delta', text: 'Done.' });
    brain.emit(sessionId, { kind: 'text', text: 'Done.' });
    brain.emit(sessionId, { kind: 'result', durationMs: 1000, costUsd: 0.01 });
    brain.emit(sessionId, { kind: 'state', state: 'idle' });
    await until('final', () => (tg.lastEdit()?.payload.text === 'Sure, here:\n\n<pre><code class="language-py">print(1)</code></pre>\n\n<i>⚙ run_command python a.py</i>\n\nDone.' ? true : undefined));

    // Photos go to Claude as pictures when a chat is active, to the clipboard after the button.
    await bot.bot.handleUpdate(message({ photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }], caption: 'what is this?' }));
    const withPhoto = await until('photo send', () => brain.received.filter((r) => r.message.type === 'message.send')[1]);
    expect(withPhoto.message.type === 'message.send' && withPhoto.message.payload).toMatchObject({ text: 'what is this?', attachments: [{ mime: 'image/jpeg', dataBase64: Buffer.from([1, 2, 3]).toString('base64') }] });
    await bot.bot.handleUpdate(text('🖼 Photo → clipboard'));
    await bot.bot.handleUpdate(message({ photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }] }));
    expect(brain.written).toEqual([{ kind: 'image', mime: 'image/jpeg', dataBase64: Buffer.from([1, 2, 3]).toString('base64') }]);
    expect(tg.lastText()).toBe('Copied to office-pc.');
    await bot.bot.handleUpdate(text('📥 Text → clipboard'));
    await bot.bot.handleUpdate(text('for the clipboard'));
    expect(brain.written[1]).toEqual({ kind: 'text', text: 'for the clipboard' });
    expect(brain.received.filter((r) => r.message.type === 'message.send')).toHaveLength(2);

    // /chats lists chats with the active one ticked; picking one switches, /stop interrupts.
    await bot.bot.handleUpdate(command('new'));
    await bot.bot.handleUpdate(text('💬 Chats'));
    const list = (tg.of('sendMessage').pop()?.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
    expect(list.map((row) => row[0]?.text)).toEqual(['✓ Chat 2', 'Bot chat', '➕ New chat']);
    await bot.bot.handleUpdate(callback(`chat:${sessionId}`, tg.lastSentId()));
    expect(tg.lastEdit()?.payload.text).toBe('Chat: Bot chat');
    await bot.bot.handleUpdate(command('stop'));
    expect(tg.lastText()).toBe('Nothing is running.');
    brain.emit(sessionId, { kind: 'state', state: 'running' });
    await new Promise((r) => setTimeout(r, 150));
    await bot.bot.handleUpdate(command('stop'));
    expect(tg.lastText()).toBe('Stopped.');
    await until('session.interrupt', () => brain.received.find((r) => r.message.type === 'session.interrupt'));

    // The Mac refusing a message shows up in place of the reply.
    brain.setReject('Add a computer first');
    await bot.bot.handleUpdate(text('anyone there?'));
    await until('refusal', () => (tg.lastEdit()?.payload.text === '⚠ Add a computer first' ? true : undefined));

    await bot.stop();
    brain.close();
  });
});
