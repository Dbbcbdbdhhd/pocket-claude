/**
 * "Always allow" rules, stored as strings:
 *   write_file              → every call of that tool
 *   run_command:npm test    → commands equal to, or starting with, "npm test " and containing no shell chaining
 */
const SHELL_CHAINING = /[;&|`$<>\n\r]|\$\(/;

export function parseRule(rule: string): { tool: string; prefix?: string } {
  const i = rule.indexOf(':');
  if (i < 0) return { tool: rule.trim() };
  return { tool: rule.slice(0, i).trim(), prefix: rule.slice(i + 1).trim() };
}

export function validateRule(rule: string, knownTools: readonly string[]): string | null {
  const { tool, prefix } = parseRule(rule);
  if (!knownTools.includes(tool)) return `Unknown tool "${tool}". Known: ${knownTools.join(', ')}`;
  if (prefix !== undefined) {
    if (tool !== 'run_command') return 'Only run_command rules can have a command prefix';
    if (!prefix) return 'Empty command prefix';
    if (SHELL_CHAINING.test(prefix)) return 'Command prefix must not contain shell operators';
  }
  return null;
}

export function isAllowedByRules(rules: readonly string[], tool: string, input: Record<string, unknown>): boolean {
  return rules.some((rule) => {
    const parsed = parseRule(rule);
    if (parsed.tool !== tool) return false;
    if (parsed.prefix === undefined) return true;
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command || SHELL_CHAINING.test(command)) return false;
    return command === parsed.prefix || command.startsWith(`${parsed.prefix} `);
  });
}
