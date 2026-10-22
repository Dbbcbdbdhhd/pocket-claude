import type { InnerMessageBody } from '@pocket/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ExecutorBridge } from '../src/executor.js';

function setup(opts: { online?: boolean; sendOk?: boolean } = {}) {
  const sent: { to: string; body: InnerMessageBody }[] = [];
  const bridge = new ExecutorBridge({
    executorIds: () => ['exec', 'exec2'],
    isOnline: () => opts.online !== false,
    send: (to, body) => {
      sent.push({ to, body });
      return opts.sendOk !== false;
    },
  });
  const lastCall = () => {
    const call = [...sent].reverse().find((s) => s.body.type === 'tool.call');
    return call?.body.type === 'tool.call' ? { to: call.to, ...call.body.payload } : undefined;
  };
  return { bridge, sent, lastCall };
}

describe('ExecutorBridge', () => {
  it('fails fast when no computer is paired or it is offline', async () => {
    expect(await setup().bridge.call(undefined, 'list_dir', {})).toMatchObject({ isError: true });
    expect(await setup({ online: false }).bridge.call('exec', 'list_dir', {})).toMatchObject({ isError: true });
  });

  it('round-trips a call and streams output', async () => {
    const { bridge, lastCall } = setup();
    const chunks: string[] = [];
    const p = bridge.call('exec', 'run_command', { command: 'dir' }, { onOutput: (c) => chunks.push(c) });
    const call = lastCall()!;
    expect(call.name).toBe('run_command');
    expect(call.to).toBe('exec');
    bridge.handleOutput('exec', { callId: call.callId, chunk: 'a', stream: 'stdout' });
    bridge.handleOutput('exec', { callId: call.callId, chunk: 'b', stream: 'stdout' });
    bridge.handleResult('exec', { callId: call.callId, content: 'ab\nexit code 0', isError: false });
    expect(await p).toEqual({ content: 'ab\nexit code 0', isError: false });
    expect(chunks).toEqual(['a', 'b']);
  });

  it('only accepts results from the computer the call went to', async () => {
    const { bridge, lastCall } = setup();
    const p = bridge.call('exec', 'list_dir', {}, { timeoutMs: 200 });
    const call = lastCall()!;
    bridge.handleResult('exec2', { callId: call.callId, content: 'forged', isError: false });
    expect(await p).toMatchObject({ isError: true, content: expect.stringContaining('did not answer') });
  });

  it('routes a handle to whatever computer the resolver returns', async () => {
    const { bridge, lastCall } = setup();
    let target = 'exec';
    const handle = bridge.handle(() => target);
    void handle.call('list_dir', {});
    expect(lastCall()!.to).toBe('exec');
    target = 'exec2';
    void handle.call('list_dir', {});
    expect(lastCall()!.to).toBe('exec2');
    bridge.failAll('done');
  });

  it('ignores results for unknown calls', () => {
    const { bridge } = setup();
    expect(() => bridge.handleResult('exec', { callId: 'nope', content: '', isError: false })).not.toThrow();
  });

  it('sends tool.cancel when aborted', async () => {
    const { bridge, sent } = setup();
    const ac = new AbortController();
    const p = bridge.call('exec', 'run_command', { command: 'sleep' }, { signal: ac.signal });
    ac.abort();
    expect(await p).toMatchObject({ isError: true });
    expect(sent.some((s) => s.body.type === 'tool.cancel')).toBe(true);
  });

  it('times out and cancels', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, sent } = setup();
      const p = bridge.call('exec', 'grep', { pattern: 'x' }, { timeoutMs: 500 });
      vi.advanceTimersByTime(501);
      expect(await p).toMatchObject({ isError: true });
      expect(sent.some((s) => s.body.type === 'tool.cancel')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails in-flight calls of the computer that dropped', async () => {
    const { bridge } = setup();
    const a = bridge.call('exec', 'read_file', { path: 'a' });
    const b = bridge.call('exec2', 'read_file', { path: 'b' }, { timeoutMs: 100 });
    bridge.failAll('offline', 'exec');
    expect(await a).toEqual({ content: 'offline', isError: true });
    expect(await b).toMatchObject({ content: expect.stringContaining('did not answer') });
  });

  it('kill switch reaches every computer', async () => {
    const { bridge, sent } = setup();
    bridge.killAll();
    expect(sent.filter((s) => s.body.type === 'control.kill').map((s) => s.to)).toEqual(['exec', 'exec2']);
  });

  it('reports an unreachable computer when the link refuses to send', async () => {
    expect(await setup({ sendOk: false }).bridge.call('exec', 'list_dir', {})).toMatchObject({ isError: true });
  });
});
