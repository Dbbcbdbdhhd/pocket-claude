import { describe, expect, it } from 'vitest';
import { applyEvent, buildThread } from '../src/thread.js';

describe('thread reducer', () => {
  it('merges streamed deltas into one assistant item and finalizes it', () => {
    let items = applyEvent([], { kind: 'user', text: 'hi', from: 'phone' });
    items = applyEvent(items, { kind: 'text_delta', text: 'Hel' });
    items = applyEvent(items, { kind: 'text_delta', text: 'lo' });
    expect(items[1]).toMatchObject({ type: 'assistant', text: 'Hello', streaming: true });
    items = applyEvent(items, { kind: 'text', text: 'Hello!' });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ type: 'assistant', text: 'Hello!', streaming: false });
  });

  it('attaches output and result to the matching tool card', () => {
    let items = applyEvent([], { kind: 'tool_use', id: 't1', name: 'run_command', input: { command: 'dir' } });
    items = applyEvent(items, { kind: 'tool_use', id: 't2', name: 'read_file', input: { path: 'a' } });
    items = applyEvent(items, { kind: 'tool_output', id: 't1', chunk: 'x', stream: 'stdout' });
    items = applyEvent(items, { kind: 'tool_output', id: 't1', chunk: 'y', stream: 'stderr' });
    items = applyEvent(items, { kind: 'tool_result', id: 't2', content: 'nope', isError: true });
    expect(items[0]).toMatchObject({ id: 't1', output: 'xy' });
    expect(items[1]).toMatchObject({ id: 't2', result: { content: 'nope', isError: true } });
  });

  it('a tool call ends the streaming bubble so later text starts a new one', () => {
    const items = buildThread([
      { kind: 'text_delta', text: 'Let me look.' },
      { kind: 'tool_use', id: 't', name: 'list_dir', input: {} },
      { kind: 'text_delta', text: 'Found it.' },
    ]);
    expect(items.map((i) => i.type)).toEqual(['assistant', 'tool', 'assistant']);
    expect(items[0]).toMatchObject({ streaming: false });
  });

  it('rebuilds a thread from durable history (no deltas)', () => {
    const items = buildThread([
      { kind: 'user', text: 'list', from: 'phone' },
      { kind: 'tool_use', id: 't', name: 'list_dir', input: {} },
      { kind: 'tool_result', id: 't', content: 'a.txt', isError: false },
      { kind: 'text', text: 'a.txt' },
      { kind: 'state', state: 'idle' },
      { kind: 'result', durationMs: 1000, costUsd: 0.01 },
    ]);
    expect(items.map((i) => i.type)).toEqual(['user', 'tool', 'assistant', 'result']);
  });

  it('idle state stops a dangling stream caret', () => {
    const items = buildThread([
      { kind: 'text_delta', text: 'partial' },
      { kind: 'state', state: 'idle' },
    ]);
    expect(items[0]).toMatchObject({ streaming: false });
  });
});
