import { describe, expect, it } from 'vitest';
import { isAllowedByRules, validateRule } from '../src/allowlist.js';

const TOOLS = ['read_file', 'write_file', 'run_command'];

describe('allowlist rules', () => {
  it('allows a whole tool', () => {
    expect(isAllowedByRules(['write_file'], 'write_file', { path: 'a' })).toBe(true);
    expect(isAllowedByRules(['write_file'], 'run_command', { command: 'ls' })).toBe(false);
  });

  it('matches command prefixes on word boundaries', () => {
    const rules = ['run_command:npm test'];
    expect(isAllowedByRules(rules, 'run_command', { command: 'npm test' })).toBe(true);
    expect(isAllowedByRules(rules, 'run_command', { command: 'npm test -- auth' })).toBe(true);
    expect(isAllowedByRules(rules, 'run_command', { command: 'npm testx' })).toBe(false);
    expect(isAllowedByRules(rules, 'run_command', { command: 'npm install' })).toBe(false);
  });

  it('never auto-allows chained or substituted commands', () => {
    const rules = ['run_command:npm test'];
    for (const command of ['npm test; rm -rf /', 'npm test && del x', 'npm test | iex', 'npm test $(evil)', 'npm test `evil`', 'npm test > out', 'npm test\nrm x']) {
      expect(isAllowedByRules(rules, 'run_command', { command })).toBe(false);
    }
  });

  it('validates rules', () => {
    expect(validateRule('write_file', TOOLS)).toBeNull();
    expect(validateRule('run_command:git status', TOOLS)).toBeNull();
    expect(validateRule('nope', TOOLS)).toMatch(/Unknown tool/);
    expect(validateRule('write_file:x', TOOLS)).toMatch(/Only run_command/);
    expect(validateRule('run_command:a; b', TOOLS)).toMatch(/shell operators/);
    expect(validateRule('run_command:', TOOLS)).toMatch(/Empty/);
  });
});
