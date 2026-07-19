import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { ToolExecutionError } from '../tools/errors.js';

export interface CommandResult { stdout: string; stderr: string; }

/** Resolve the first executable from a small compiled list of absolute paths. */
export async function resolveExecutable(paths: readonly string[]): Promise<string> {
  for (const candidate of paths) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try the next compiled path */ }
  }
  throw new ToolExecutionError('COMMAND_UNAVAILABLE', `Required command is unavailable: ${paths.join(' or ')}`);
}

/** Execute one fixed binary with structured arguments and bounded output. */
export async function runCommand(
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number; maxBytes: number; signal?: AbortSignal },
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    execFile(executable, [...args], {
      // Never leak the AgentV credential or service configuration into host
      // command environments (and therefore /proc/<pid>/environ).
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', LANG: 'C' },
      timeout: options.timeoutMs,
      maxBuffer: options.maxBytes,
      encoding: 'utf8',
      signal: options.signal,
    }, (error, stdout, stderr) => {
      if (!error) { resolve({ stdout, stderr }); return; }
      const value = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
      if (value.killed || value.code === 'ETIMEDOUT' || value.name === 'AbortError') {
        reject(new ToolExecutionError('TOOL_TIMEOUT', 'Host command timed out', { phase: 'host_command' })); return;
      }
      if (value.code === 'ENOENT') { reject(new ToolExecutionError('COMMAND_UNAVAILABLE', `Required command is unavailable: ${executable}`)); return; }
      if (value.code === 'EACCES' || value.code === 'EPERM') { reject(new ToolExecutionError('PERMISSION_DENIED', 'Host command access was denied')); return; }
      if (value.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(value.message || '')) {
        reject(new ToolExecutionError('OUTPUT_TOO_LARGE', 'Host command output exceeded its byte limit', { phase: 'host_command' })); return;
      }
      const message = `${stderr || value.message}`.toLowerCase();
      if (message.includes('permission denied') || message.includes('access denied')) {
        reject(new ToolExecutionError('PERMISSION_DENIED', 'Host command access was denied')); return;
      }
      reject(new ToolExecutionError('HOST_UNAVAILABLE', `Host command failed: ${executable}`, { exitCode: value.code }));
    });
  });
}
