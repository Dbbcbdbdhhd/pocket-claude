import { describe, expect, it } from 'vitest';
import type { InnerMessage, InnerMessageBody } from '@pocket/protocol';
import { ToolDispatcher } from '../src/dispatch.js';
import type { ToolContext, ToolFn } from '../src/tools/index.js';

const BRAIN = 'brain-1';

const msg = (body: InnerMessageBody): InnerMessage => ({ ts: 0, counter: 1, ...body });

function setup(impls: Record<string, ToolFn>) {
  const sent: InnerMessageBody[] = [];
  const d = new ToolDispatcher({
    brainDeviceId: BRAIN,
    send: (b) => sent.push(b),
    createContext: (signal, onOutput) =>
      ({ guard: { roots: [], resolve: async (p: string) => p }, roots: [], signal, onOutput, platform: process.platform }) satisfies ToolContext,
    toolImpls: impls,
  });
  const call = (from: string, callId: string, name = 'echo', args: unknown = {}) =>
    d.handle({ from, message: msg({ type: 'tool.call', payload: { callId, name, args } }) });
  return { d, sent, call };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ToolDispatcher', () => {
  it('ignores everything from non-brain devices', async () => {
    let ran = 0;
    const { d, sent, call } = setup({ echo: async () => (ran++, { content: 'x' }) });
    call('intruder', 'c1');
    d.handle({ from: 'intruder', message: msg({ type: 'control.kill', payload: { scope: 'all' } }) });
    await tick(20);
    expect(ran).toBe(0);
    expect(sent).toEqual([]);
  });

  it('returns tool.result for a brain call', async () => {
    const { sent, call } = setup({ echo: async () => ({ content: 'hi' }) });
    call(BRAIN, 'c1');
    await tick(20);
    expect(sent).toEqual([{ type: 'tool.result', payload: { callId: 'c1', content: 'hi', isError: false } }]);
  });

  it('reports unknown tools and thrown errors as isError', async () => {
    const { sent, call } = setup({ boom: async () => { throw new Error('bad'); } });
    call(BRAIN, 'c1', 'nope');
    call(BRAIN, 'c2', 'boom');
    await tick(20);
    expect(sent).toEqual([
      { type: 'tool.result', payload: { callId: 'c1', content: 'Unknown tool: nope', isError: true } },
      { type: 'tool.result', payload: { callId: 'c2', content: 'bad', isError: true } },
    ]);
  });

  it('cancels one call and leaves others running', async () => {
    const waiter: ToolFn = (_a, ctx) =>
      new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve({ content: 'cancelled', isError: true })));
    const { d, sent, call } = setup({ wait: waiter });
    call(BRAIN, 'a', 'wait');
    call(BRAIN, 'b', 'wait');
    await tick(10);
    d.handle({ from: 'intruder', message: msg({ type: 'tool.cancel', payload: { callId: 'a' } }) });
    d.handle({ from: BRAIN, message: msg({ type: 'tool.cancel', payload: { callId: 'a' } }) });
    await tick(10);
    expect(sent).toEqual([{ type: 'tool.result', payload: { callId: 'a', content: 'cancelled', isError: true } }]);
    expect(d.activeCalls).toBe(1);
    d.handle({ from: BRAIN, message: msg({ type: 'control.kill', payload: { scope: 'all' } }) });
    await tick(10);
    expect(sent).toHaveLength(2);
    expect(d.activeCalls).toBe(0);
  });

  it('coalesces output into few tool.output messages before the result', async () => {
    const chatty: ToolFn = async (_a, ctx) => {
      for (let i = 0; i < 200; i++) ctx.onOutput(`l${i}\n`, 'stdout');
      ctx.onOutput('e\n', 'stderr');
      await tick(120);
      ctx.onOutput('late\n', 'stdout');
      return { content: 'done' };
    };
    const { sent, call } = setup({ chatty });
    call(BRAIN, 'c1', 'chatty');
    await tick(250);
    const outputs = sent.filter((s) => s.type === 'tool.output');
    expect(outputs.length).toBeLessThanOrEqual(5);
    expect(outputs.length).toBeGreaterThanOrEqual(3);
    const stdout = outputs.map((o) => (o.type === 'tool.output' && o.payload.stream === 'stdout' ? o.payload.chunk : '')).join('');
    expect(stdout.startsWith('l0\nl1\n')).toBe(true);
    expect(stdout.endsWith('late\n')).toBe(true);
    expect(sent[sent.length - 1]).toEqual({ type: 'tool.result', payload: { callId: 'c1', content: 'done', isError: false } });
  });
});
