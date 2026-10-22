import type { ToolResult } from '@pocket/protocol';
import type { PathGuard } from '../path-guard.js';

export interface ToolContext {
  guard: PathGuard;
  roots: string[];
  signal: AbortSignal;
  onOutput(chunk: string, stream: 'stdout' | 'stderr'): void;
  rgPath?: string;
  platform: NodeJS.Platform;
}

export type ToolFn = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

export const errorResult = (e: unknown): ToolResult => ({
  content: e instanceof Error ? e.message : String(e),
  isError: true,
});

export function guarded(fn: ToolFn): ToolFn {
  return async (args, ctx) => {
    try {
      return await fn(args, ctx);
    } catch (e) {
      return errorResult(e);
    }
  };
}
