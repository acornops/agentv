import type { Readable } from 'node:stream';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWindowsReadiness } from './windows-readiness.js';
import { win32, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { WindowsRuntimeOptions, WindowsStopHandle } from './windows-runtime.js';

const settingsKeys = [
  'ACORNOPS_AGENT_PLATFORM_URL', 'ACORNOPS_TARGET_ID', 'ACORNOPS_AGENT_KEY', 'ACORNOPS_AGENT_TARGET_TYPE',
  'ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS', 'ACORNOPS_AGENT_MIN_SNAPSHOT_INTERVAL_MS', 'ACORNOPS_AGENT_MAX_SNAPSHOT_INTERVAL_MS',
  'ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES', 'ACORNOPS_AGENT_MIN_SNAPSHOT_BYTES', 'ACORNOPS_AGENT_MAX_REMOTE_SNAPSHOT_BYTES',
  'ACORNOPS_AGENT_LOG_LEVEL', 'ACORNOPS_VM_ALLOWED_LOG_CHANNELS', 'ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE',
  'ACORNOPS_VM_OS_FAMILY', 'ACORNOPS_VM_SERVICE_MANAGER', 'ACORNOPS_VM_COLLECTOR_MODE', 'ACORNOPS_AGENT_WRITE_ENABLED', 'ACORNOPS_AGENT_MOCK_ACTIONS_ENABLED',
] as const;
const fixed = { ACORNOPS_VM_OS_FAMILY: 'windows', ACORNOPS_VM_SERVICE_MANAGER: 'scm', ACORNOPS_VM_COLLECTOR_MODE: 'live', ACORNOPS_AGENT_WRITE_ENABLED: 'false', ACORNOPS_AGENT_MOCK_ACTIONS_ENABLED: 'false', ACORNOPS_AGENT_TARGET_TYPE: 'virtual_machine' };
const launchSchema = z.object({ launchId: z.string().uuid(), configSha256: z.string().regex(/^[a-f0-9]{64}$/), stateDirectory: z.string().max(1024).refine((value) => win32.isAbsolute(value)) }).strict();
type ServiceRuntimeOptions = WindowsRuntimeOptions & { launch?: z.infer<typeof launchSchema> };
const commandSchema = z.discriminatedUnion('command', [z.object({ command: z.literal('START'), trustedSystemDirectory: z.string().min(1).max(1024), launch: launchSchema }).strict(), z.object({ command: z.literal('STOP') }).strict()]);

/** Parse only named AgentV settings; service launch paths never come from config. */
export function parseWindowsServiceConfig(raw: string): Record<string, string> {
  if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('Windows service config exceeds limit');
  let parsed: { version: 1; settings: Record<string, string> };
  try { parsed = z.object({ version: z.literal(1), settings: z.record(z.string(), z.string().max(8192)) }).strict().parse(JSON.parse(raw)); } catch { throw new Error('Invalid Windows service config'); }
  if (Object.keys(parsed.settings).some((key) => !(settingsKeys as readonly string[]).includes(key))) throw new Error('Unknown Windows service setting');
  for (const [key, value] of Object.entries(fixed)) if (parsed.settings[key] !== undefined && parsed.settings[key] !== value) throw new Error('Windows service requires live read-only Windows/scm settings');
  return { ...parsed.settings, ...fixed };
}

async function startFromProtectedConfig(configPath: string, options: ServiceRuntimeOptions): Promise<WindowsStopHandle> {
  const file = await open(configPath, 'r');
  let raw: string;
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > 64 * 1024) throw new Error('Invalid protected Windows service config');
    const buffer = Buffer.alloc(64 * 1024 + 1); let length = 0;
    while (length < buffer.length) { const read = await file.read(buffer, length, buffer.length - length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length > 64 * 1024) throw new Error('Windows service config exceeds limit');
    raw = buffer.subarray(0, length).toString('utf8');
  } finally { await file.close(); }
  if (!options.launch || createHash('sha256').update(raw).digest('hex') !== options.launch.configSha256) throw new Error('Windows service configuration changed during launch');
  const sessionState = createWindowsReadiness({ directory: options.launch.stateDirectory, ...options.launch });
  sessionState.disconnected();
  const settings = parseWindowsServiceConfig(raw);
  for (const name of Object.keys(process.env)) if (name.startsWith('ACORNOPS_')) delete process.env[name];
  Object.assign(process.env, settings);
  // Imports occur only after the native host has assigned the child to its job.
  const [{ loadConfig }, { startWindowsAgent }] = await Promise.all([import('./config.js'), import('./windows-runtime.js')]);
  return startWindowsAgent(loadConfig(), { ...options, sessionState });
}

/** Wait for private START, retain early STOP, and bound protocol/start/stop lifetimes. */
export async function runWindowsServiceEntry(options: {
  input: Readable; configPath: string; sessionState?: WindowsRuntimeOptions['sessionState'];
  start?: (path: string, runtime: ServiceRuntimeOptions) => Promise<WindowsStopHandle>;
}): Promise<void> {
  if (!win32.isAbsolute(options.configPath)) throw new Error('Windows service config path must be absolute');
  let buffer = Buffer.alloc(0); let started = false; let stopRequested = false; let handle: WindowsStopHandle | undefined; let stopping: Promise<void> | undefined;
  let resolveDone!: () => void; let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const boundedStop = () => stopping ??= (async () => {
    if (!handle) return;
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([handle.stop(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Windows runtime stop deadline exceeded')), 15000); })]); resolveDone(); }
    catch { rejectDone(new Error('Windows runtime shutdown failed')); } finally { clearTimeout(timer); }
  })();
  const requestStop = () => { stopRequested = true; if (handle) void boundedStop(); else if (!started) resolveDone(); };
  let startTimer = setTimeout(() => rejectDone(new Error('Windows service START deadline exceeded')), 10000);
  const fail = () => { rejectDone(new Error('Invalid Windows service control protocol')); requestStop(); };
  let inputBytes = 0;
  const data = (chunk: Buffer | string) => {
    inputBytes += Buffer.byteLength(chunk); if (inputBytes > 8192) { fail(); return; }
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    // Never retain an unbounded partial line, even when no newline is received.
    while (buffer.length) {
      const newline = buffer.indexOf(10);
      if (newline < 0) { if (buffer.length > 4096) fail(); break; }
      if (newline > 4096) { fail(); return; }
      const line = buffer.subarray(0, newline).toString('utf8'); buffer = buffer.subarray(newline + 1);
      let command: z.infer<typeof commandSchema>; try { command = commandSchema.parse(JSON.parse(line)); } catch { fail(); return; }
      if (command.command === 'STOP') { requestStop(); continue; }
      if (started || stopRequested) { fail(); return; }
      started = true; clearTimeout(startTimer);
      startTimer = setTimeout(() => { stopRequested = true; rejectDone(new Error('Windows runtime startup deadline exceeded')); }, 15000);
      void (options.start || startFromProtectedConfig)(options.configPath, { trustedSystemDirectory: command.trustedSystemDirectory, sessionState: options.sessionState, launch: command.launch }).then((runtime) => { clearTimeout(startTimer); handle = runtime; if (stopRequested) void boundedStop(); }).catch(() => rejectDone(new Error('Windows runtime startup failed')));
    }
  };
  const end = () => { if (!started || buffer.length) fail(); else requestStop(); };
  options.input.on('data', data); options.input.once('end', end); options.input.once('error', fail);
  try { await done; } finally { clearTimeout(startTimer); options.input.off('data', data); options.input.off('end', end); options.input.off('error', fail); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--config') { process.stderr.write('Invalid Windows service entry arguments\n'); process.exitCode = 1; }
  else try { await runWindowsServiceEntry({ input: process.stdin, configPath: process.argv[3] }); } catch { process.stderr.write('Windows service runtime stopped with an error\n'); process.exitCode = 1; }
}
