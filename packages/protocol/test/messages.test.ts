import { describe, expect, it } from 'vitest';
import { innerMessageBodySchema, innerMessageSchema } from '../src/index.js';

const session = { sessionId: 's', title: 't', state: 'idle', createdAt: 1, updatedAt: 2 };

describe('innerMessageBodySchema', () => {
  it.each([
    { type: 'session.create', payload: {} },
    { type: 'message.send', payload: { sessionId: 's', text: 'x', attachments: [{ mime: 'image/png', dataBase64: 'AA==' }] } },
    { type: 'permission.respond', payload: { requestId: 'r', decision: 'allow_session' } },
    { type: 'session.created', payload: { session } },
    { type: 'session.event', payload: { sessionId: 's', event: { kind: 'tool_result', id: 'i', content: 'c', isError: false } } },
    { type: 'tool.call', payload: { callId: 'c', name: 'read_file', args: { path: 'a' } } },
    { type: 'tool.output', payload: { callId: 'c', chunk: 'x', stream: 'stderr' } },
    { type: 'control.kill', payload: { scope: 'all' } },
  ])('accepts $type', (msg) => {
    expect(innerMessageBodySchema.safeParse(msg).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(innerMessageBodySchema.safeParse({ type: 'nope', payload: {} }).success).toBe(false);
  });

  it('rejects invalid payloads', () => {
    expect(innerMessageBodySchema.safeParse({ type: 'message.send', payload: { sessionId: 's' } }).success).toBe(false);
    expect(innerMessageBodySchema.safeParse({ type: 'control.kill', payload: { scope: 'one' } }).success).toBe(false);
    expect(innerMessageBodySchema.safeParse({ type: 'permission.respond', payload: { requestId: 'r', decision: 'maybe' } }).success).toBe(false);
  });

  it('inner message requires ts and counter', () => {
    expect(innerMessageSchema.safeParse({ ts: 1, counter: 2, type: 'status.get', payload: {} }).success).toBe(true);
    expect(innerMessageSchema.safeParse({ type: 'status.get', payload: {} }).success).toBe(false);
  });
});
