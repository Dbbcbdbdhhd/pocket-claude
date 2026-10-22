import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  deserializeIdentity,
  generateIdentity,
  serializeIdentity,
  type Identity,
  type Role,
  type SessionMeta,
  type SerializedIdentity,
} from '@pocket/protocol';

const run = promisify(execFile);

export const HOME = process.env.POCKET_HOME ?? join(homedir(), '.pocket-claude');
export const paths = {
  home: HOME,
  state: join(HOME, 'state.json'),
  sessionsDir: join(HOME, 'sessions'),
  workDir: join(HOME, 'work'),
  socket: join(HOME, 'control.sock'),
  logDir: process.env.POCKET_LOG_DIR ?? join(homedir(), 'Library', 'Logs', 'pocket-claude'),
  /** Local plugin whose only content is a link to the user's skills, so Claude gets them without user settings or CLAUDE.md. */
  skillsPlugin: join(HOME, 'skills-plugin'),
  userSkills: process.env.POCKET_SKILLS_DIR ?? join(homedir(), '.claude', 'skills'),
};

export interface PairedDevice {
  deviceId: string;
  role: Exclude<Role, 'brain'>;
  name: string;
  signPub: string;
  encPub: string;
  pairedAt: number;
  /** The person this device belongs to; see `User`. */
  userId: string;
}

/** A person using this Mac's Claude: their phone(s), computers and chats are theirs alone. */
export interface User {
  id: string;
  name: string;
  createdAt: number;
  /** The Mac's owner: may work on the Mac itself, invite people and manage them from the CLI. */
  owner?: boolean;
}

export const OWNER_ID = 'owner';

export interface UsageTotals {
  turns: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface BrainState {
  /** Where this daemon connects; on the relay's own machine this is the local address. */
  relayUrl: string;
  /** Address phones and computers use; goes into pairing codes. Defaults to `relayUrl`. */
  publicRelayUrl?: string;
  devices: PairedDevice[];
  users: User[];
  /** "Always allow" rules, see allowlist.ts. */
  allowlist: string[];
  sessions: SessionMeta[];
  replay: Record<string, number>;
  usage?: { days: Record<string, UsageTotals>; sessions: Record<string, UsageTotals> };
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Default computer per person (`userId` → `deviceId`): the one picked last on their phone. */
  activeExecutors?: Record<string, string>;
  /** The Telegram bot the daemon runs; set with `pocket-claude telegram <token>`. */
  telegram?: { token: string; username: string };
  /** @deprecated single-user default computer; `migrateState` moves it into `activeExecutors`. */
  activeExecutor?: string;
}

const DEFAULT_STATE: BrainState = {
  relayUrl: process.env.POCKET_RELAY_URL ?? 'http://127.0.0.1:8787',
  devices: [],
  users: [],
  allowlist: [],
  sessions: [],
  replay: {},
};

/**
 * Brings state from before people existed up to date, in place: everything that was there belongs to the owner.
 * Idempotent, so it also runs on every daemon start and on states handed to `Brain` directly.
 */
export function migrateState(state: BrainState): BrainState {
  state.users ??= [];
  if (!state.users.some((u) => u.owner)) {
    let name = 'Owner';
    try {
      name = userInfo().username || name;
    } catch {}
    state.users.unshift({ id: OWNER_ID, name, createdAt: Date.now(), owner: true });
  }
  const owner = state.users.find((u) => u.owner)!;
  for (const d of state.devices) d.userId ||= owner.id;
  for (const s of state.sessions) s.userId ||= owner.id;
  if (state.activeExecutor) {
    state.activeExecutors = { ...state.activeExecutors, [owner.id]: state.activeExecutor };
    delete state.activeExecutor;
  }
  return state;
}

export function ensureDirs(): void {
  for (const dir of [paths.home, paths.sessionsDir, paths.workDir, paths.logDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Returns the plugin directory, or null when the user has no skills. */
export function ensureSkillsPlugin(): string | null {
  if (!existsSync(paths.userSkills)) return null;
  const manifestDir = join(paths.skillsPlugin, '.claude-plugin');
  mkdirSync(manifestDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(manifestDir, 'plugin.json'), `${JSON.stringify({ name: 'skills', version: '1.0.0', description: 'Skills installed on this Mac' })}\n`);
  const link = join(paths.skillsPlugin, 'skills');
  let linked = false;
  try {
    linked = lstatSync(link).isSymbolicLink();
  } catch {}
  if (!linked) symlinkSync(paths.userSkills, link, 'dir');
  return paths.skillsPlugin;
}

export function loadState(): BrainState {
  try {
    return migrateState({ ...DEFAULT_STATE, ...JSON.parse(readFileSync(paths.state, 'utf8')) });
  } catch {
    return migrateState(structuredClone(DEFAULT_STATE));
  }
}

export function saveState(state: BrainState): void {
  const tmp = `${paths.state}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, paths.state);
}

const KEYCHAIN_SERVICE = 'pocket-claude';
const KEYCHAIN_ACCOUNT = process.env.POCKET_KEYCHAIN_ACCOUNT ?? 'brain-identity';

/** The brain's long-term keys live in the macOS login Keychain; elsewhere (CI, tests) in a 0600 file. */
export async function loadOrCreateIdentity(): Promise<Identity> {
  const existing = await readSecret();
  if (existing) return deserializeIdentity(JSON.parse(existing) as SerializedIdentity);
  const identity = generateIdentity();
  await writeSecret(JSON.stringify(serializeIdentity(identity)));
  return identity;
}

const useKeychain = () => process.platform === 'darwin' && !process.env.POCKET_NO_KEYCHAIN;
const identityFile = () => join(HOME, 'identity.json');

async function readSecret(): Promise<string | null> {
  if (!useKeychain()) {
    try {
      return readFileSync(identityFile(), 'utf8');
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function writeSecret(value: string): Promise<void> {
  if (!useKeychain()) {
    writeFileSync(identityFile(), value, { mode: 0o600 });
    return;
  }
  await run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', value]);
}
