import { z } from 'zod';

/**
 * Single source of truth for the tools Claude can call on the executor.
 * The brain exposes them to Claude Code as MCP tools; the executor implements them.
 */
export const toolArgs = {
  read_file: z.object({
    path: z.string().describe('File path, absolute or relative to the workspace root'),
    offset: z.number().int().min(1).optional().describe('1-based line to start reading from'),
    limit: z.number().int().min(1).optional().describe('Maximum number of lines to return'),
  }),
  write_file: z.object({
    path: z.string().describe('File path, absolute or relative to the workspace root'),
    content: z.string().describe('Full new file content'),
  }),
  edit_file: z.object({
    path: z.string(),
    old_string: z.string().describe('Exact text to replace; must be unique in the file unless replace_all is set'),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  list_dir: z.object({
    path: z.string().optional().describe('Directory, defaults to the workspace root'),
  }),
  glob: z.object({
    pattern: z.string().describe('Glob pattern such as src/**/*.ts'),
    path: z.string().optional().describe('Directory to search in, defaults to the workspace root'),
  }),
  grep: z.object({
    pattern: z.string().describe('Regular expression (ripgrep syntax)'),
    path: z.string().optional(),
    glob: z.string().optional().describe('Only search files matching this glob'),
    ignore_case: z.boolean().optional(),
    max_results: z.number().int().min(1).max(2000).optional(),
  }),
  run_command: z.object({
    command: z.string().describe('PowerShell command line'),
    cwd: z.string().optional().describe('Working directory, defaults to the workspace root'),
    timeout_ms: z.number().int().min(1000).max(3_600_000).optional(),
    background: z.boolean().optional().describe('Start the command in the background and return its id immediately'),
  }),
  command_output: z.object({
    id: z.string().describe('Id of a background command'),
    wait_ms: z.number().int().min(0).max(60_000).optional().describe('Wait up to this long for new output or exit'),
  }),
  command_kill: z.object({
    id: z.string().describe('Id of a background command'),
  }),
  workspace_info: z.object({}),
  git_status: z.object({
    path: z.string().optional().describe('Repository directory, defaults to the workspace root'),
  }),
  git_diff: z.object({
    path: z.string().optional().describe('Repository directory, defaults to the workspace root'),
    staged: z.boolean().optional().describe('Show staged changes instead of unstaged'),
    file: z.string().optional().describe('Limit the diff to one file'),
  }),
  git_commit: z.object({
    path: z.string().optional().describe('Repository directory, defaults to the workspace root'),
    message: z.string().min(1).describe('Commit message'),
    files: z.array(z.string()).optional().describe('Files to stage before committing; omit to commit what is already staged'),
  }),
} as const;

export type ToolName = keyof typeof toolArgs;
export type ToolArgs<N extends ToolName> = z.infer<(typeof toolArgs)[N]>;

export const TOOL_NAMES = Object.keys(toolArgs) as ToolName[];

export const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set([
  'read_file',
  'list_dir',
  'glob',
  'grep',
  'workspace_info',
  'git_status',
  'git_diff',
  'command_output',
]);

export const toolDescriptions: Record<ToolName, string> = {
  read_file: 'Read a text file from the Windows workspace. Returns numbered lines.',
  write_file: 'Create or overwrite a file in the Windows workspace.',
  edit_file: 'Replace an exact string in a file in the Windows workspace.',
  list_dir: 'List entries of a directory in the Windows workspace.',
  glob: 'Find files in the Windows workspace by glob pattern.',
  grep: 'Search file contents in the Windows workspace with a regular expression.',
  run_command: 'Run a PowerShell command on the Windows machine and return its output, or start it in the background.',
  command_output: 'Read new output of a background command on the Windows machine.',
  command_kill: 'Stop a background command on the Windows machine.',
  workspace_info: 'Describe the Windows workspace: root folders, OS, shell, open editors.',
  git_status: 'Show the branch and changed files of a git repository in the Windows workspace.',
  git_diff: 'Show the git diff (unstaged, or staged) of a repository in the Windows workspace.',
  git_commit: 'Stage the given files (optional) and create a git commit in the Windows workspace. Needs user approval.',
};

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolArgs, name);
}

export const MCP_SERVER_NAME = 'pocket';
export const mcpToolName = (name: ToolName): string => `mcp__${MCP_SERVER_NAME}__${name}`;

export interface ToolResult {
  content: string;
  isError?: boolean;
}
