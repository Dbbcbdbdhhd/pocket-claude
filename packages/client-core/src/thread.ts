import type { SessionEvent } from '@pocket/protocol';

const MAX_TOOL_OUTPUT = 20_000;

export type ChatItem =
  | { type: 'user'; key: string; text: string; from: string; images?: number; files?: string[] }
  | { type: 'assistant'; key: string; text: string; streaming: boolean }
  | {
      type: 'tool';
      key: string;
      id: string;
      name: string;
      input: unknown;
      output: string;
      result?: { content: string; isError: boolean };
    }
  | { type: 'result'; key: string; durationMs?: number; costUsd?: number }
  | { type: 'error'; key: string; message: string };

let seq = 0;
const key = () => `i${++seq}`;

function finalizeStreaming(items: ChatItem[]): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.type === 'assistant' && last.streaming) return [...items.slice(0, -1), { ...last, streaming: false }];
  return items;
}

/** Pure reducer from Claude activity events to renderable chat items. */
export function applyEvent(items: ChatItem[], event: SessionEvent): ChatItem[] {
  switch (event.kind) {
    case 'user':
      return [...finalizeStreaming(items), { type: 'user', key: key(), text: event.text, from: event.from, ...(event.images ? { images: event.images } : {}), ...(event.files?.length ? { files: event.files } : {}) }];
    case 'text_delta': {
      const last = items[items.length - 1];
      if (last?.type === 'assistant' && last.streaming) return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      return [...items, { type: 'assistant', key: key(), text: event.text, streaming: true }];
    }
    case 'text': {
      const last = items[items.length - 1];
      if (last?.type === 'assistant' && last.streaming) return [...items.slice(0, -1), { ...last, text: event.text, streaming: false }];
      return [...items, { type: 'assistant', key: key(), text: event.text, streaming: false }];
    }
    case 'tool_use':
      return [...finalizeStreaming(items), { type: 'tool', key: key(), id: event.id, name: event.name, input: event.input, output: '' }];
    case 'tool_output':
      return items.map((it) =>
        it.type === 'tool' && it.id === event.id ? { ...it, output: (it.output + event.chunk).slice(-MAX_TOOL_OUTPUT) } : it,
      );
    case 'tool_result':
      return items.map((it) => (it.type === 'tool' && it.id === event.id ? { ...it, result: { content: event.content, isError: event.isError } } : it));
    case 'result':
      return [...finalizeStreaming(items), { type: 'result', key: key(), durationMs: event.durationMs, costUsd: event.costUsd }];
    case 'error':
      return [...finalizeStreaming(items), { type: 'error', key: key(), message: event.message }];
    case 'state':
      return event.state === 'idle' ? finalizeStreaming(items) : items;
  }
}

export function buildThread(events: SessionEvent[]): ChatItem[] {
  return events.reduce(applyEvent, [] as ChatItem[]);
}
