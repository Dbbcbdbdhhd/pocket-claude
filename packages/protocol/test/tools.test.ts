import { describe, expect, it } from 'vitest';
import { isToolName, mcpToolName, READ_ONLY_TOOLS, TOOL_NAMES, toolArgs, toolDescriptions } from '../src/index.js';

describe('tools', () => {
  it('TOOL_NAMES matches toolArgs keys and descriptions', () => {
    expect([...TOOL_NAMES].sort()).toEqual(Object.keys(toolArgs).sort());
    expect(Object.keys(toolDescriptions).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('READ_ONLY_TOOLS is a strict subset', () => {
    for (const t of READ_ONLY_TOOLS) expect(TOOL_NAMES).toContain(t);
    expect(READ_ONLY_TOOLS.size).toBeLessThan(TOOL_NAMES.length);
    expect(READ_ONLY_TOOLS.has('run_command')).toBe(false);
    expect(READ_ONLY_TOOLS.has('write_file')).toBe(false);
  });

  it('formats mcp tool names', () => {
    expect(mcpToolName('read_file')).toBe('mcp__pocket__read_file');
  });

  it('isToolName guards against prototype keys', () => {
    expect(isToolName('grep')).toBe(true);
    expect(isToolName('toString')).toBe(false);
    expect(isToolName('nope')).toBe(false);
  });

  it('read_file args validate offset', () => {
    expect(toolArgs.read_file.safeParse({ path: 'a', offset: 0 }).success).toBe(false);
    expect(toolArgs.read_file.safeParse({ path: 'a', offset: 1, limit: 10 }).success).toBe(true);
    expect(toolArgs.read_file.safeParse({ path: 'a', offset: 1.5 }).success).toBe(false);
  });

  it('run_command bounds timeout', () => {
    expect(toolArgs.run_command.safeParse({ command: 'ls', timeout_ms: 999 }).success).toBe(false);
    expect(toolArgs.run_command.safeParse({ command: 'ls', timeout_ms: 5000 }).success).toBe(true);
  });
});
