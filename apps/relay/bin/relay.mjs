#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../src/node-server.ts', import.meta.url));
const tsx = import.meta.resolve('tsx');

const child = spawn(process.execPath, ['--import', tsx, server], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
