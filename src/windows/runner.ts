import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { win32 } from 'node:path';
import { z } from 'zod';
import { ToolExecutionError } from '../tools/errors.js';
import { scripts, type ScriptId } from './scripts.js';

const resultSchema = z.object({ items: z.array(z.unknown()).max(1000), truncated: z.boolean(), status: z.enum(['ok', 'partial', 'unavailable', 'permission_denied']) }).strict();
export type CollectorResult = z.infer<typeof resultSchema>;
export interface CollectorRunner { run(script: ScriptId, data: Record<string, unknown>, signal?: AbortSignal): Promise<CollectorResult>; stop(): Promise<void>; }

/** Build a fixed collector command with caller values only in JSON stdin. */
export function collectorCommand(script: ScriptId, data: Record<string, unknown>) {
  if (!Object.hasOwn(scripts, script)) throw new Error('Unknown Windows collector');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(scripts[script], 'utf16le').toString('base64')];
  const stdin = JSON.stringify(data);
  if (args.join(' ').length > 30000 || Buffer.byteLength(stdin) > 8192) throw new Error('Windows collector input exceeds limit');
  return { args, stdin };
}

/** Supply only OS command dependencies, excluding credentials and Node preloads. */
export function collectorEnvironment(systemDirectory: string): NodeJS.ProcessEnv {
  const windows = win32.dirname(systemDirectory);
  const powershell = win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0');
  return { SystemRoot: windows, WINDIR: windows, PATH: `${systemDirectory};${powershell}`, PSModulePath: win32.join(powershell, 'Modules') };
}

/** Validate the bounded native collector envelope without surfacing raw output. */
export function parseCollectorResult(stdout: string): CollectorResult {
  try { return resultSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); }
  catch { throw new ToolExecutionError('HOST_UNAVAILABLE', 'Windows collector returned invalid JSON or fields'); }
}

/** Execute local fixed scripts, with a trusted service-host system-directory seam. */
export class WindowsCollectorRunner implements CollectorRunner {
  private readonly children = new Map<ChildProcessWithoutNullStreams, Promise<void>>();
  private stopping = false;
  private readonly executable: string;
  constructor(private readonly systemDirectory = 'C:\\Windows\\System32') {
    if (process.platform !== 'win32') throw new Error('Live Windows collectors require Windows Server');
    if (process.arch !== 'x64' || ![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Live Windows collectors require x64 Node 22 or 24');
    if (!win32.isAbsolute(systemDirectory) || win32.normalize(systemDirectory) !== systemDirectory || !/^[A-Za-z]:\\/.test(systemDirectory)) throw new Error('Unsupported trusted Windows system directory');
    this.executable = win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }
  private async trustedExecutable(): Promise<void> {
    let path = win32.parse(this.executable).root;
    for (const part of this.executable.slice(path.length).split('\\')) { path = win32.join(path, part); const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('Unsupported Windows collector executable redirection'); }
    const resolved = await realpath(this.executable);
    if (resolved.toLowerCase() !== this.executable.toLowerCase() || !(await lstat(resolved)).isFile()) throw new Error('Unsupported Windows collector executable path');
  }
  async run(script: ScriptId, data: Record<string, unknown>, signal?: AbortSignal): Promise<CollectorResult> {
    if (this.stopping || signal?.aborted) throw new ToolExecutionError('TOOL_TIMEOUT', 'Windows collection cancelled');
    try { await this.trustedExecutable(); } catch { throw new ToolExecutionError('COMMAND_UNAVAILABLE', 'Trusted Windows PowerShell path is unavailable or unsupported'); }
    if (this.stopping || signal?.aborted) throw new ToolExecutionError('TOOL_TIMEOUT', 'Windows collection cancelled');
    const command = collectorCommand(script, data);
    return await new Promise((resolve, reject) => {
      const child = spawn(this.executable, command.args, { env: collectorEnvironment(this.systemDirectory), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let bytes = 0; const output: Buffer[] = []; let failure: ToolExecutionError | undefined;
      const kill = (error: ToolExecutionError) => { failure ??= error; child.kill(); };
      const abort = () => kill(new ToolExecutionError('TOOL_TIMEOUT', 'Windows collection cancelled'));
      const timer = setTimeout(() => kill(new ToolExecutionError('TOOL_TIMEOUT', 'Windows collector timed out')), 8000);
      signal?.addEventListener('abort', abort, { once: true });
      const consume = (chunk: Buffer, retain: boolean) => { bytes += chunk.length; if (bytes > 1024 * 1024) kill(new ToolExecutionError('OUTPUT_TOO_LARGE', 'Windows collector output exceeds limit')); else if (retain) output.push(chunk); };
      child.stdout.on('data', (chunk: Buffer) => consume(chunk, true)); child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
      child.stdin.on('error', () => undefined); child.stdin.end(command.stdin, 'utf8');
      const closed = new Promise<void>((done) => child.once('close', () => done())); this.children.set(child, closed);
      child.once('error', () => { failure ??= new ToolExecutionError('COMMAND_UNAVAILABLE', 'Windows collector could not start'); });
      child.once('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.children.delete(child); if (failure) reject(failure); else if (code !== 0) reject(new ToolExecutionError('HOST_UNAVAILABLE', 'Windows collector exited unsuccessfully')); else { try { resolve(parseCollectorResult(Buffer.concat(output).toString('utf8'))); } catch (error) { reject(error); } } });
    });
  }
  async stop(): Promise<void> { this.stopping = true; const pending = [...this.children.entries()]; for (const [child] of pending) child.kill(); await Promise.all(pending.map(([, closed]) => closed)); }
}
