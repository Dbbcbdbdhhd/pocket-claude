import type { ChatState } from '@pocket/client-core';
import type { PermissionDecision } from '@pocket/protocol';

export interface PanelState {
  paired: boolean;
  selected: string | null;
  chat: ChatState | null;
}

export type HostToWebview = { type: 'state'; state: PanelState };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'create' }
  | { type: 'select'; sessionId: string }
  | { type: 'send'; sessionId: string | null; text: string }
  | { type: 'interrupt'; sessionId: string }
  | { type: 'permission'; requestId: string; decision: PermissionDecision }
  | { type: 'kill' }
  | { type: 'refresh' }
  | { type: 'unpair' }
  | { type: 'pair' }
  | { type: 'clearError' };

const DECISIONS: readonly string[] = ['allow', 'allow_session', 'deny'];

const isString = (v: unknown): v is string => typeof v === 'string';

/** Validates an untrusted message received from the webview. */
export function parseIntent(raw: unknown): WebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'create':
    case 'kill':
    case 'refresh':
    case 'unpair':
    case 'pair':
    case 'clearError':
      return { type: m.type };
    case 'select':
      return isString(m.sessionId) ? { type: 'select', sessionId: m.sessionId } : undefined;
    case 'interrupt':
      return isString(m.sessionId) ? { type: 'interrupt', sessionId: m.sessionId } : undefined;
    case 'send':
      if (!isString(m.text) || !(m.sessionId === null || isString(m.sessionId))) return undefined;
      return { type: 'send', sessionId: m.sessionId, text: m.text };
    case 'permission':
      if (!isString(m.requestId) || !isString(m.decision) || !DECISIONS.includes(m.decision)) return undefined;
      return { type: 'permission', requestId: m.requestId, decision: m.decision as PermissionDecision };
    default:
      return undefined;
  }
}
