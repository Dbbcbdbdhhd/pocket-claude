import { ChatClient, type ChatState } from '@pocket/client-core';
import { deserializeIdentity, parsePairingCode, serializeIdentity, type ClipboardItem, type Computer } from '@pocket/protocol';
import { joinAccount, type WebSocketCtor } from '@pocket/transport';
import { Bot, InputFile, Keyboard, InlineKeyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { buttonFor, stringsFor, type Strings } from './strings.js';
import type { BotState, BotStore, Link } from './store.js';

export interface PocketBotOptions {
  token: string;
  /** Relay the bot's client devices connect through; the Mac's own relay address when the bot runs on the Mac. */
  relayUrl: string;
  store: BotStore;
  log: (m: string) => void;
  WebSocket?: WebSocketCtor;
  /** Fetches a file Telegram holds for the bot (`file_path` from getFile). */
  download?: (filePath: string) => Promise<Uint8Array>;
  /** Skips getMe on start; tests pass this. */
  botInfo?: UserFromGetMe;
}

interface Linked {
  link: Link;
  client: ChatClient;
}

const TEXT_MESSAGE_LIMIT = 4000;
const PHOTO_LIMIT = 10 * 1024 * 1024;
const READY_TIMEOUT_MS = 8_000;

/**
 * Telegram front for the clipboard of the paired computers. Every Telegram account that links through
 * `/start <code>` becomes a client device of the person who made the code on their phone, so it sees
 * exactly what that phone sees and nothing else.
 */
export class PocketBot {
  readonly bot: Bot;
  private readonly linked = new Map<string, Linked>();
  private state: BotState;
  private persistTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: PocketBotOptions) {
    this.state = opts.store.load();
    this.bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : {});
    this.bot.catch((e) => opts.log(`telegram: handler failed: ${e.message}`));
    this.register();
    for (const [id, link] of Object.entries(this.state.links)) this.connect(id, link);
  }

  /** Long polling; returns when the bot stops. */
  async start(): Promise<void> {
    this.persistTimer = setInterval(() => this.persist(), 30_000);
    await this.bot.start({ onStart: (me) => this.opts.log(`telegram: @${me.username} polling, ${this.linked.size} linked`) });
  }

  async stop(): Promise<void> {
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.persist();
    for (const l of this.linked.values()) l.client.close();
    this.linked.clear();
    await this.bot.stop();
  }

  get links(): number {
    return this.linked.size;
  }

  private persist(): void {
    for (const [id, l] of this.linked) {
      const link = this.state.links[id];
      if (link) link.replay = l.client.replayState();
    }
    this.opts.store.save(this.state);
  }

  private connect(id: string, link: Link): Linked {
    const client = new ChatClient({
      ...link.credentials,
      identity: deserializeIdentity(link.credentials.identity),
      WebSocket: this.opts.WebSocket,
      replayState: link.replay,
      log: (m) => this.opts.log(`telegram[${id}]: ${m}`),
      onRelayMoved: (relayUrl) => {
        link.credentials.relayUrl = relayUrl;
        this.persist();
      },
    });
    client.connect();
    const entry = { link, client };
    this.linked.set(id, entry);
    return entry;
  }

  private register(): void {
    const bot = this.bot;
    // Private chats only: the bot shows personal clipboards.
    bot.use((ctx, next) => (ctx.chat?.type === 'private' ? next() : Promise.resolve()));

    bot.command('start', (ctx) => this.onStart(ctx, ctx.match));
    bot.command('unlink', (ctx) => this.onUnlink(ctx));
    bot.command('status', (ctx) => this.withLinked(ctx, (l, t) => this.sendStatus(ctx, l, t)));
    bot.command('pc', (ctx) => this.withLinked(ctx, (l, t) => this.pickComputer(ctx, l, t)));
    bot.command('help', (ctx) => ctx.reply(this.t(ctx).help, { reply_markup: this.keyboard(this.t(ctx)) }));
    bot.callbackQuery(/^pc:(.+)$/, (ctx) =>
      this.withLinked(ctx, async (l, t) => {
        const id = ctx.match[1] ?? '';
        const pc = l.client.getState().computers.find((c) => c.deviceId === id);
        await ctx.answerCallbackQuery();
        if (!pc) return;
        l.client.selectComputer(pc.deviceId);
        await ctx.editMessageText(t.pcSet(pc.name)).catch(() => {});
      }),
    );
    bot.on('message:text', (ctx) =>
      this.withLinked(ctx, async (l, t) => {
        switch (buttonFor(ctx.message.text)) {
          case 'read':
            return this.readClipboard(ctx, l, t);
          case 'text':
            return void (await ctx.reply(t.sendText, { reply_markup: { force_reply: true, input_field_placeholder: t.buttons.text } }));
          case 'photo':
            return void (await ctx.reply(t.sendPhoto, { reply_markup: { force_reply: true, input_field_placeholder: t.buttons.photo } }));
          case 'pc':
            return this.pickComputer(ctx, l, t);
          case 'status':
            return this.sendStatus(ctx, l, t);
          default:
            return this.writeClipboard(ctx, l, t, { kind: 'text', text: ctx.message.text });
        }
      }),
    );
    bot.on('message:photo', (ctx) =>
      this.withLinked(ctx, async (l, t) => {
        const best = ctx.message.photo[ctx.message.photo.length - 1];
        if (!best) return;
        const data = await this.fetchFile(best.file_id);
        await this.writeClipboard(ctx, l, t, { kind: 'image', mime: 'image/jpeg', dataBase64: Buffer.from(data).toString('base64') });
      }),
    );
    bot.on('message:document', (ctx) =>
      this.withLinked(ctx, async (l, t) => {
        const doc = ctx.message.document;
        if (!doc.mime_type?.startsWith('image/')) return void (await ctx.reply(t.onlyImages));
        const data = await this.fetchFile(doc.file_id);
        await this.writeClipboard(ctx, l, t, { kind: 'image', mime: doc.mime_type, dataBase64: Buffer.from(data).toString('base64') });
      }),
    );
  }

  private t(ctx: Context): Strings {
    return stringsFor(this.linked.get(String(ctx.from?.id))?.link.languageCode ?? ctx.from?.language_code);
  }

  private keyboard(t: Strings): Keyboard {
    return new Keyboard().text(t.buttons.read).row().text(t.buttons.text).text(t.buttons.photo).row().text(t.buttons.pc).text(t.buttons.status).resized().persistent();
  }

  private async withLinked(ctx: Context, fn: (l: Linked, t: Strings) => Promise<void> | void): Promise<void> {
    const t = this.t(ctx);
    const l = this.linked.get(String(ctx.from?.id));
    if (!l) {
      await ctx.reply(t.notLinked);
      return;
    }
    try {
      await fn(l, t);
    } catch (e) {
      await ctx.reply(t.failed(e instanceof Error ? e.message : String(e)));
    }
  }

  private async onStart(ctx: Context, payload: string): Promise<void> {
    const t = this.t(ctx);
    const id = String(ctx.from?.id);
    const code = payload.trim();
    if (!code) {
      const l = this.linked.get(id);
      if (!l) return void (await ctx.reply(t.notLinked));
      const name = l.client.getState().host?.user?.name ?? '…';
      return void (await ctx.reply(t.linked(name, this.target(l)?.name), { reply_markup: this.keyboard(t) }));
    }
    let parsed;
    try {
      parsed = parsePairingCode(code);
    } catch {
      return void (await ctx.reply(t.badCode));
    }
    await ctx.reply(t.linking);
    try {
      const joined = await joinAccount({
        relayUrl: this.opts.relayUrl,
        code: parsed,
        role: 'client',
        name: `Telegram ${ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name ?? id)}`,
        WebSocket: this.opts.WebSocket,
        timeoutMs: 20_000,
      });
      this.linked.get(id)?.client.close();
      const link: Link = {
        chatId: ctx.chat?.id ?? Number(id),
        ...(ctx.from?.username ? { username: ctx.from.username } : {}),
        ...(ctx.from?.language_code ? { languageCode: ctx.from.language_code } : {}),
        credentials: {
          relayUrl: this.opts.relayUrl,
          accountId: joined.reply.accountId,
          deviceId: joined.deviceId,
          identity: serializeIdentity(joined.identity),
          brainDeviceId: joined.reply.brainDeviceId,
          brainEncPub: joined.bundle.brainEncPub,
        },
        replay: {},
      };
      this.state.links[id] = link;
      const l = this.connect(id, link);
      this.persist();
      const state = await this.ready(l);
      this.opts.log(`telegram: linked ${id} as ${state.host?.user?.name ?? 'unknown'} (${joined.deviceId})`);
      await ctx.reply(t.linked(state.host?.user?.name ?? '…', this.target(l)?.name), { reply_markup: this.keyboard(t) });
    } catch (e) {
      await ctx.reply(t.linkFailed(e instanceof Error ? e.message : String(e)));
    }
  }

  private async onUnlink(ctx: Context): Promise<void> {
    const t = this.t(ctx);
    const id = String(ctx.from?.id);
    const l = this.linked.get(id);
    if (!l) return void (await ctx.reply(t.notLinked));
    l.client.unpairDevice();
    // Give the message a moment to leave before the socket closes.
    await new Promise((r) => setTimeout(r, 300));
    l.client.close();
    this.linked.delete(id);
    delete this.state.links[id];
    this.persist();
    await ctx.reply(t.unlinked, { reply_markup: { remove_keyboard: true } });
  }

  /** Waits for the Mac to answer the first status request so computers and the person are known. */
  private ready(l: Linked): Promise<ChatState> {
    return new Promise((resolve) => {
      const isReady = (s: ChatState) => s.brainOnline && s.host !== null;
      const done = (s: ChatState) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(s);
      };
      const timer = setTimeout(() => done(l.client.getState()), READY_TIMEOUT_MS);
      const unsubscribe = l.client.subscribe((s) => isReady(s) && done(s));
      const now = l.client.getState();
      if (isReady(now)) done(now);
    });
  }

  /** The computer whose clipboard is used: the phone's pick, else the first online one that shares it. */
  private target(l: Linked): Computer | undefined {
    const list = l.client.clipboardComputers();
    return list.find((c) => c.online) ?? list[0];
  }

  private async readClipboard(ctx: Context, l: Linked, t: Strings): Promise<void> {
    const state = await this.ready(l);
    if (!state.brainOnline) return void (await ctx.reply(t.macOffline));
    const pc = this.target(l);
    if (!pc) return void (await ctx.reply(t.noComputer));
    if (!pc.online) return void (await ctx.reply(t.pcOffline(pc.name)));
    await ctx.replyWithChatAction('typing');
    const items = await l.client.readClipboard(pc.deviceId);
    if (!items.length) return void (await ctx.reply(t.empty(pc.name)));
    for (const item of items) await this.sendItem(ctx, item, pc.name);
  }

  private async sendItem(ctx: Context, item: ClipboardItem, pcName: string): Promise<void> {
    switch (item.kind) {
      case 'text':
        if (item.text.length <= TEXT_MESSAGE_LIMIT) await ctx.reply(item.text, { entities: [], link_preview_options: { is_disabled: true } });
        else await ctx.replyWithDocument(new InputFile(Buffer.from(item.text, 'utf8'), 'clipboard.txt'), { caption: pcName });
        return;
      case 'image': {
        const data = Buffer.from(item.dataBase64, 'base64');
        const file = new InputFile(data, item.mime === 'image/jpeg' ? 'clipboard.jpg' : 'clipboard.png');
        if (data.length <= PHOTO_LIMIT) await ctx.replyWithPhoto(file, { caption: pcName });
        else await ctx.replyWithDocument(file, { caption: pcName });
        return;
      }
      case 'file':
        await ctx.replyWithDocument(new InputFile(Buffer.from(item.dataBase64, 'base64'), item.name), { caption: pcName });
        return;
    }
  }

  private async writeClipboard(ctx: Context, l: Linked, t: Strings, item: ClipboardItem): Promise<void> {
    const state = await this.ready(l);
    if (!state.brainOnline) return void (await ctx.reply(t.macOffline));
    const pc = this.target(l);
    if (!pc) return void (await ctx.reply(t.noComputer));
    if (!pc.online) return void (await ctx.reply(t.pcOffline(pc.name)));
    await l.client.writeClipboard(pc.deviceId, item);
    await ctx.reply(t.copied(pc.name));
  }

  private async pickComputer(ctx: Context, l: Linked, t: Strings): Promise<void> {
    await this.ready(l);
    const list = l.client.clipboardComputers();
    if (!list.length) return void (await ctx.reply(t.noComputer));
    const current = this.target(l);
    const kb = new InlineKeyboard();
    for (const c of list) kb.text(`${c.online ? '●' : '○'} ${c.name}${c.deviceId === current?.deviceId ? ' ✓' : ''}`, `pc:${c.deviceId}`).row();
    await ctx.reply(t.pickPc, { reply_markup: kb });
  }

  private async sendStatus(ctx: Context, l: Linked, t: Strings): Promise<void> {
    const s = await this.ready(l);
    const current = this.target(l);
    await ctx.reply(
      t.status({
        user: s.host?.user?.name ?? '…',
        owner: s.host?.user?.owner ?? false,
        macOnline: s.brainOnline,
        claude: s.host?.claudeVersion,
        computers: s.computers.map((c) => ({ name: c.name, online: c.online, current: c.deviceId === current?.deviceId, clipboard: c.capabilities?.includes('clipboard') ?? false })),
      }),
      { reply_markup: this.keyboard(t) },
    );
  }

  private async fetchFile(fileId: string): Promise<Uint8Array> {
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram did not return the file');
    const download = this.opts.download ?? ((path: string) => defaultDownload(this.opts.token, path));
    return download(file.file_path);
  }
}

async function defaultDownload(token: string, filePath: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
