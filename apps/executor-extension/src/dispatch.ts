import { isToolName, type InnerMessageBody, type ToolResult } from '@pocket/protocol';
import type { IncomingMessage } from '@pocket/transport';
import { killAllBackground, tools, type ToolContext, type ToolFn } from './tools/index.js';

const FLUSH_INTERVAL_MS = 50;

export interface DispatcherOptions {
  brainDeviceId: string;
  send(body: InnerMessageBody): void;
  /** Throws if `root` is not a project this computer allows. */
  createContext(signal: AbortSignal, onOutput: ToolContext['onOutput'], root?: string): ToolContext;
  toolImpls?: Record<string, ToolFn>;
}

type Stream = 'stdout' | 'stderr';

class OutputBatcher {
  private parts: { stream: Stream; chunk: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly emit: (chunk: string, stream: Stream) => void) {}

  push(chunk: string, stream: Stream): void {
    const last = this.parts[this.parts.length - 1];
    if (last && last.stream === stream) last.chunk += chunk;
    else this.parts.push({ stream, chunk });
    this.timer ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const parts = this.parts;
    this.parts = [];
    for (const p of parts) this.emit(p.chunk, p.stream);
  }
}

export class ToolDispatcher {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly opts: DispatcherOptions) {}

  get activeCalls(): number {
    return this.running.size;
  }

  handle({ from, message }: IncomingMessage): void {
    if (from !== this.opts.brainDeviceId) return;
    switch (message.type) {
      case 'tool.call':
        void this.run(message.payload.callId, message.payload.name, message.payload.args, message.payload.root);
        return;
      case 'tool.cancel':
        this.running.get(message.payload.callId)?.abort();
        return;
      case 'control.kill':
        this.killAll();
        killAllBackground();
        return;
      default:
        return;
    }
  }

  killAll(): void {
    for (const ac of this.running.values()) ac.abort();
  }

  private async run(callId: string, name: string, args: unknown, root?: string): Promise<void> {
    if (this.running.has(callId)) return;
    const ac = new AbortController();
    this.running.set(callId, ac);
    const batcher = new OutputBatcher((chunk, stream) =>
      this.opts.send({ type: 'tool.output', payload: { callId, chunk, stream } }),
    );

    let result: ToolResult;
    try {
      const impl = this.opts.toolImpls?.[name] ?? (isToolName(name) ? tools[name] : undefined);
      if (!impl) {
        result = { content: `Unknown tool: ${name}`, isError: true };
      } else {
        result = await impl(args, this.opts.createContext(ac.signal, (chunk, stream) => batcher.push(chunk, stream), root));
      }
    } catch (e) {
      result = { content: e instanceof Error ? e.message : String(e), isError: true };
    }
    batcher.flush();
    this.running.delete(callId);
    this.opts.send({ type: 'tool.result', payload: { callId, content: result.content, isError: result.isError ?? false } });
  }
}
