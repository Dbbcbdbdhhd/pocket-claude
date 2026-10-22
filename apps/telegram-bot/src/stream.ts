import { CURSOR, packMessages, type Piece } from './render.js';

export interface StreamSink {
  /** Sends HTML and returns the message id. */
  send(html: string): Promise<number>;
  edit(messageId: number, html: string): Promise<void>;
}

const THROTTLE_MS = 1200;

/**
 * Shows one reply as it is generated: the last message is edited as text arrives (at most once per
 * {@link THROTTLE_MS}); once it fills up it is left alone and the rest continues in a new message.
 */
export class ReplyStream {
  private readonly messages: { id: number; html: string }[] = [];
  private latest: { pieces: Piece[]; done: boolean } = { pieces: [], done: false };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastFlush = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: StreamSink,
    private readonly placeholder: { waiting: string; empty: string },
    private readonly throttleMs = THROTTLE_MS,
  ) {}

  update(pieces: Piece[], done: boolean): Promise<void> {
    this.latest = { pieces, done };
    if (done) return this.flush();
    if (this.timer) return this.queue;
    const wait = Math.max(0, this.throttleMs - (Date.now() - this.lastFlush));
    if (wait === 0) return this.flush();
    this.timer = setTimeout(() => void this.flush(), wait);
    return this.queue;
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.lastFlush = Date.now();
    const { pieces, done } = this.latest;
    this.queue = this.queue.then(() => this.apply(pieces, done)).catch(() => {});
    return this.queue;
  }

  private async apply(pieces: Piece[], done: boolean): Promise<void> {
    const chunks = packMessages(pieces);
    if (!chunks.length) chunks.push(done ? this.placeholder.empty : this.placeholder.waiting);
    for (let i = 0; i < chunks.length; i++) {
      const live = i === chunks.length - 1 && !done;
      const html = `${chunks[i]}${live ? CURSOR : ''}`;
      const existing = this.messages[i];
      if (!existing) {
        this.messages.push({ id: await this.sink.send(html), html });
      } else if (existing.html !== html) {
        await this.sink.edit(existing.id, html);
        existing.html = html;
      }
    }
  }
}
