import type { ChatState } from '@pocket/client-core';
import { useMemo } from 'react';

export function pendingCount(state: ChatState): number {
  const withRequest = new Set(state.permissions.map((p) => p.sessionId));
  const waiting = state.sessions.filter((s) => s.state === 'waiting_permission' && !withRequest.has(s.sessionId)).length;
  return state.permissions.length + waiting;
}

export function usePendingCount(state: ChatState): number {
  return useMemo(() => pendingCount(state), [state]);
}

export function connectionBanner(state: ChatState): string | null {
  if (state.connection === 'connecting') return 'Connecting…';
  if (state.connection === 'offline') return 'Offline — reconnecting';
  if (!state.brainOnline) return 'Mac offline';
  return null;
}

export function isActiveNow(state: ChatState): boolean {
  return state.connection === 'online' && state.brainOnline;
}
