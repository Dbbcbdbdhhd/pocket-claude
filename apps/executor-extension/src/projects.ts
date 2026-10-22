import * as path from 'node:path';
import type { Project } from '@pocket/protocol';

const MAX_PROJECTS = 30;

export const projectKey = (p: string) => {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * Projects the phone can pick: folders open in any VS Code window first, then ones opened before
 * (from our own history and VS Code's recent list), newest first.
 */
export function listProjects(open: readonly string[], history: Readonly<Record<string, number>>, recent: readonly string[]): Project[] {
  const out = new Map<string, Project>();
  const now = Date.now();
  for (const p of open) out.set(projectKey(p), { path: p, name: path.basename(p) || p, open: true, lastOpened: now });
  const known = [...Object.entries(history)].sort((a, b) => b[1] - a[1]);
  for (const [p, at] of known) if (!out.has(projectKey(p))) out.set(projectKey(p), { path: p, name: path.basename(p) || p, open: false, lastOpened: at });
  for (const p of recent) if (!out.has(projectKey(p))) out.set(projectKey(p), { path: p, name: path.basename(p) || p, open: false });
  return [...out.values()].slice(0, MAX_PROJECTS);
}

/** Records the open folders; keeps the most recent entries only. */
export function updateHistory(history: Readonly<Record<string, number>>, open: readonly string[], now = Date.now()): Record<string, number> {
  const next: Record<string, number> = { ...history };
  for (const p of open) {
    for (const k of Object.keys(next)) if (projectKey(k) === projectKey(p)) delete next[k];
    next[p] = now;
  }
  return Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MAX_PROJECTS));
}

/** A tool call may only target a project the phone could have picked from this computer's list. */
export function resolveRoot(root: string, allowed: readonly Project[]): string | undefined {
  return allowed.find((p) => projectKey(p.path) === projectKey(root))?.path;
}
