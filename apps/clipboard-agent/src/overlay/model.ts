import { applyEvent, buildThread, parseMarkdown, shortToolName, summarizeTool, type Block, type ChatItem } from '@pocket/client-core';
import type { InnerMessageBody, SessionMeta } from '@pocket/protocol';

export type OverlayRole = 'user' | 'assistant' | 'tool' | 'error';

/** One entry of the transcript the way the window draws it. */
export interface OverlayMessage {
  id: string;
  role: OverlayRole;
  /** Raw text: what "copy reply" puts on the clipboard. */
  text: string;
  blocks: Block[];
  streaming: boolean;
  /** Short note under the text, e.g. attachments or "failed". */
  note?: string;
}

export type WindowOp =
  | { op: 'reset'; title: string; messages: OverlayMessage[] }
  | { op: 'upsert'; message: OverlayMessage }
  | { op: 'title'; title: string }
  | { op: 'status'; text: string }
  | { op: 'quit' };

export interface OverlayModelDeps {
  window: (op: WindowOp) => void;
  /** Read-only requests to the brain: session.list and session.history. */
  request: (body: InnerMessageBody) => void;
}

const NO_CHAT = 'No chats yet';

/** Follows the chat the phone is using and turns its events into drawing ops for the window. */
export class OverlayModel {
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly threads = new Map<string, ChatItem[]>();
  private readonly loaded = new Set<string>();
  private readonly requested = new Set<string>();
  private activeId: string | null = null;

  constructor(private readonly deps: OverlayModelDeps) {}

  /** The Mac is reachable (again): start over from its list of chats. */
  connected(): void {
    this.loaded.clear();
    this.requested.clear();
    this.deps.window({ op: 'status', text: '' });
    this.deps.request({ type: 'session.list', payload: {} });
  }

  offline(): void {
    this.deps.window({ op: 'status', text: 'Mac is offline' });
  }

  /** Everything the window needs to draw itself from scratch. */
  snapshot(): WindowOp {
    const active = this.activeId ? this.sessions.get(this.activeId) : undefined;
    const thread = this.activeId ? this.threads.get(this.activeId) : undefined;
    return { op: 'reset', title: active?.title ?? NO_CHAT, messages: thread?.map(toMessage).filter(present) ?? [] };
  }

  handle(message: InnerMessageBody): void {
    switch (message.type) {
      case 'session.list.result':
        this.sessions.clear();
        for (const s of message.payload.sessions) if (!s.hidden) this.sessions.set(s.sessionId, s);
        this.pickActive();
        return;
      case 'session.created': {
        const s = message.payload.session;
        if (s.hidden) return;
        this.sessions.set(s.sessionId, s);
        // The phone just opened it: that is where the next messages go.
        this.activate(s.sessionId);
        return;
      }
      case 'session.updated': {
        const s = message.payload.session;
        if (s.hidden) {
          this.sessions.delete(s.sessionId);
          if (this.activeId === s.sessionId) this.pickActive();
          return;
        }
        const titleChanged = this.sessions.get(s.sessionId)?.title !== s.title;
        this.sessions.set(s.sessionId, s);
        if (s.sessionId === this.activeId && titleChanged) this.deps.window({ op: 'title', title: s.title });
        return;
      }
      case 'session.deleted': {
        const id = message.payload.sessionId;
        this.sessions.delete(id);
        this.threads.delete(id);
        this.loaded.delete(id);
        this.requested.delete(id);
        if (this.activeId === id) {
          this.activeId = null;
          this.pickActive();
        }
        return;
      }
      case 'session.history.result': {
        const { sessionId, events } = message.payload;
        this.requested.delete(sessionId);
        this.threads.set(sessionId, buildThread(events));
        this.loaded.add(sessionId);
        if (sessionId === this.activeId) this.deps.window(this.snapshot());
        return;
      }
      case 'session.event': {
        const { sessionId, event } = message.payload;
        const meta = this.sessions.get(sessionId);
        if (meta) {
          this.sessions.set(sessionId, { ...meta, updatedAt: Date.now() });
          if (event.kind === 'user' && sessionId !== this.activeId) this.activate(sessionId);
        }
        const before = this.threads.get(sessionId) ?? [];
        const after = applyEvent(before, event);
        this.threads.set(sessionId, after);
        if (sessionId !== this.activeId || !this.loaded.has(sessionId)) return;
        // The reducer keeps untouched items by reference, so a reference change marks exactly what to redraw.
        after.forEach((item, i) => {
          if (item === before[i]) return;
          const m = toMessage(item);
          if (m) this.deps.window({ op: 'upsert', message: m });
        });
        return;
      }
      default:
        return;
    }
  }

  /** Shows the most recently used chat. */
  private pickActive(): void {
    const best = [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!best) {
      this.activeId = null;
      this.deps.window(this.snapshot());
      return;
    }
    if (best.sessionId !== this.activeId || !this.loaded.has(best.sessionId)) this.activate(best.sessionId);
    else this.deps.window(this.snapshot());
  }

  private activate(id: string): void {
    this.activeId = id;
    this.deps.window(this.snapshot());
    if (this.loaded.has(id) || this.requested.has(id)) return;
    this.requested.add(id);
    this.deps.request({ type: 'session.history', payload: { sessionId: id } });
  }
}

const present = (m: OverlayMessage | null): m is OverlayMessage => m !== null;

export function toMessage(item: ChatItem): OverlayMessage | null {
  switch (item.type) {
    case 'user': {
      const notes = [...(item.images ? [`${item.images} image${item.images > 1 ? 's' : ''}`] : []), ...(item.files ?? [])];
      return { id: item.key, role: 'user', text: item.text, blocks: parseMarkdown(item.text), streaming: false, ...(notes.length ? { note: notes.join(', ') } : {}) };
    }
    case 'assistant':
      return { id: item.key, role: 'assistant', text: item.text, blocks: parseMarkdown(item.text), streaming: item.streaming };
    case 'tool': {
      const text = `${shortToolName(item.name)} ${summarizeTool(item.input)}`.trim();
      return { id: item.key, role: 'tool', text, blocks: [], streaming: !item.result, ...(item.result?.isError ? { note: 'failed' } : {}) };
    }
    case 'error':
      return { id: item.key, role: 'error', text: item.message, blocks: [], streaming: false };
    case 'result':
      return null;
  }
}
