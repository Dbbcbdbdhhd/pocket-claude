import { describe, expect, it } from 'vitest';
import { migrateState, OWNER_ID, type BrainState } from '../src/store.js';

const device = (deviceId: string, role: 'client' | 'executor', userId?: string) =>
  ({ deviceId, role, name: deviceId, signPub: 'a', encPub: 'b', pairedAt: 1, ...(userId ? { userId } : {}) }) as BrainState['devices'][number];

describe('migrateState', () => {
  it('gives everything from a single-user state to the owner', () => {
    const state = migrateState({
      relayUrl: 'http://r',
      devices: [device('phone', 'client'), device('pc', 'executor')],
      allowlist: [],
      sessions: [{ sessionId: 's1', title: 'Chat', state: 'idle', createdAt: 1, updatedAt: 1 }],
      replay: {},
      activeExecutor: 'pc',
    } as unknown as BrainState);
    expect(state.users).toEqual([{ id: OWNER_ID, name: expect.any(String), createdAt: expect.any(Number), owner: true }]);
    expect(state.devices.map((d) => d.userId)).toEqual([OWNER_ID, OWNER_ID]);
    expect(state.sessions[0]?.userId).toBe(OWNER_ID);
    expect(state.activeExecutors).toEqual({ [OWNER_ID]: 'pc' });
    expect(state.activeExecutor).toBeUndefined();
  });

  it('leaves a migrated state alone', () => {
    const state: BrainState = {
      relayUrl: 'http://r',
      users: [{ id: OWNER_ID, name: 'Me', createdAt: 1, owner: true }, { id: 'u2', name: 'Masha', createdAt: 2 }],
      devices: [device('phone', 'client', 'u2')],
      allowlist: [],
      sessions: [{ sessionId: 's1', title: 'Chat', state: 'idle', createdAt: 1, updatedAt: 1, userId: 'u2' }],
      replay: {},
      activeExecutors: { u2: 'pc' },
    };
    const before = JSON.stringify(state);
    expect(JSON.stringify(migrateState(state))).toBe(before);
  });
});
