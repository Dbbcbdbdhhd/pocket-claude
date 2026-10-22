import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTO_ALLOWED_TOOLS, CLAUDE_TOOLS, readLocalSkillFile, toDisplayCall, TOOL_ALIASES } from '../src/claude-tools.js';

describe('Claude Code tool adapter', () => {
  it('routes built-in names to the executor tools', () => {
    expect(TOOL_ALIASES).toMatchObject({ Bash: 'mcp__pocket__Bash', PowerShell: 'mcp__pocket__Bash', Read: 'mcp__pocket__Read', Edit: 'mcp__pocket__Edit' });
  });

  it('translates arguments to protocol calls', () => {
    expect(toDisplayCall('Bash', { command: 'npm test', timeout: 5000, description: 'x' })).toEqual({ name: 'run_command', input: { command: 'npm test', timeout_ms: 5000 } });
    expect(toDisplayCall('Bash', { command: 'npm run dev', run_in_background: true })).toEqual({ name: 'run_command', input: { command: 'npm run dev', background: true } });
    expect(toDisplayCall('Read', { file_path: 'C:\\a.ts', offset: 3 })).toEqual({ name: 'read_file', input: { path: 'C:\\a.ts', offset: 3 } });
    expect(toDisplayCall('Grep', { pattern: 'x', '-i': true, head_limit: 5 })).toEqual({ name: 'grep', input: { pattern: 'x', ignore_case: true, max_results: 5 } });
    expect(toDisplayCall('BashOutput', { bash_id: 'bg1' })).toEqual({ name: 'command_output', input: { id: 'bg1' } });
    expect(toDisplayCall('Agent', { prompt: 'p' })).toEqual({ name: 'Agent', input: { prompt: 'p' } });
  });

  it('auto-allows only read-only tools and safe built-ins', () => {
    expect(AUTO_ALLOWED_TOOLS).toContain('mcp__pocket__Read');
    expect(AUTO_ALLOWED_TOOLS).toContain('Agent');
    expect(AUTO_ALLOWED_TOOLS).not.toContain('mcp__pocket__Bash');
    expect(AUTO_ALLOWED_TOOLS).not.toContain('mcp__pocket__Write');
    expect(AUTO_ALLOWED_TOOLS).not.toContain('ExitPlanMode');
    for (const t of CLAUDE_TOOLS) expect(t.toProtocol({}).name).toBeTruthy();
  });

  it('serves skill files locally and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'));
    mkdirSync(join(dir, 'pdf'));
    writeFileSync(join(dir, 'pdf', 'REF.md'), 'one\ntwo\n');
    expect(await readLocalSkillFile([dir], join(dir, 'pdf', 'REF.md'))).toBe('     1\tone\n     2\ttwo');
    expect(await readLocalSkillFile([dir], join(dir, '..', 'secret'))).toBeUndefined();
    expect(await readLocalSkillFile([dir], 'pdf/REF.md')).toBeUndefined();
    expect(await readLocalSkillFile([dir], 'C:\\work\\a.ts')).toBeUndefined();
  });
});
