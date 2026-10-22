import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './store.js';

const MAX_BYTES = 5_000_000;
const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /("(?:signSk|encSk|sig|blob|ct)"\s*:\s*")[^"]+/g];

function redact(line: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, (m, prefix?: string) => (prefix ? `${prefix}[redacted]` : '[redacted]')), line);
}

let toStderr = false;

export function logToStderr(enabled: boolean): void {
  toStderr = enabled;
}

export function log(message: string): void {
  const line = redact(`${new Date().toISOString()} ${message}`);
  if (toStderr) process.stderr.write(`${line}\n`);
  const file = join(paths.logDir, 'brain.log');
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch {
    // logging must never take the daemon down
  }
}
