import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Coordinator, type LeaderMessage, type WindowMessage } from '../src/coordinator.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-'));
const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pocket-test-${process.pid}` : path.join(dir, 'p.sock');
const tokenFile = path.join(dir, 'token');
const made: Coordinator[] = [];

function window(folders: string[]) {
  const log: string[] = [];
  const received: LeaderMessage[] = [];
  const fromFollowers: WindowMessage[] = [];
  const c = new Coordinator({
    pipePath,
    tokenFile,
    folders: () => folders,
    log: () => {},
    events: {
      becameLeader: () => log.push('leader'),
      becameFollower: () => log.push('follower'),
      followersChanged: () => log.push('followers'),
      followerMessage: (_f, m) => fromFollowers.push(m),
      leaderMessage: (m) => received.push(m),
    },
  });
  made.push(c);
  c.start();
  return { c, log, received, fromFollowers };
}

const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(() => {
  for (const c of made.splice(0)) c.dispose();
});

describe('Coordinator', () => {
  it('elects one leader, shares folders and messages, and hands over when the leader closes', async () => {
    const a = window(['/a']);
    await until(() => a.c.role === 'leader');
    const b = window(['/b']);
    await until(() => b.c.role === 'follower' && a.c.allFollowers().length === 1);
    expect(a.c.allFollowers()[0]!.folders).toEqual(['/b']);

    a.c.broadcast({ t: 'state', state: { x: 1 } });
    await until(() => b.received.some((m) => m.t === 'state'));
    b.c.send({ t: 'kill' });
    await until(() => a.fromFollowers.length === 1);

    a.c.dispose();
    await until(() => b.c.role === 'leader');
    expect(b.log).toContain('leader');
  });

  it('drops a local client that does not know the token', async () => {
    const a = window(['/a']);
    await until(() => a.c.role === 'leader');
    const intruder = net.createConnection(pipePath);
    await new Promise<void>((r) => intruder.once('connect', () => r()));
    intruder.write(`${JSON.stringify({ t: 'hello', token: 'wrong', folders: ['/x'] })}\n`);
    await new Promise<void>((r) => intruder.once('close', () => r()));
    expect(a.c.allFollowers()).toHaveLength(0);
  });
});
