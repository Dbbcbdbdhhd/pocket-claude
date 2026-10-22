import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SerializedIdentity } from '@pocket/protocol';

/** One Telegram account linked to a person on the Mac: the bot is a client device of that person. */
export interface Link {
  chatId: number;
  username?: string;
  languageCode?: string;
  credentials: {
    relayUrl: string;
    accountId: string;
    deviceId: string;
    identity: SerializedIdentity;
    brainDeviceId: string;
    brainEncPub: string;
  };
  replay: Record<string, number>;
}

export interface BotState {
  /** Keyed by Telegram user id. */
  links: Record<string, Link>;
}

export interface BotStore {
  load(): BotState;
  save(state: BotState): void;
}

export function fileStore(file: string): BotStore {
  return {
    load() {
      try {
        return { links: {}, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<BotState>) };
      } catch {
        return { links: {} };
      }
    },
    save(state) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}

export function memoryStore(initial: BotState = { links: {} }): BotStore {
  let state = initial;
  return {
    load: () => structuredClone(state),
    save: (s) => {
      state = structuredClone(s);
    },
  };
}
