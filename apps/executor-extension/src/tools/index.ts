import type { ToolName } from '@pocket/protocol';
import { commandKill, commandOutput } from './background.js';
import { editFile } from './edit-file.js';
import { gitCommit, gitDiff, gitStatus } from './git.js';
import { glob } from './glob.js';
import { grep } from './grep.js';
import { listDir } from './list-dir.js';
import { readFile } from './read-file.js';
import { runCommand } from './run-command.js';
import type { ToolFn } from './types.js';
import { workspaceInfo } from './workspace-info.js';
import { writeFile } from './write-file.js';

export { killAllBackground } from './background.js';
export type { ToolContext, ToolFn } from './types.js';

export const tools: Record<ToolName, ToolFn> = {
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  list_dir: listDir,
  glob,
  grep,
  run_command: runCommand,
  command_output: commandOutput,
  command_kill: commandKill,
  workspace_info: workspaceInfo,
  git_status: gitStatus,
  git_diff: gitDiff,
  git_commit: gitCommit,
};
