import { readdir, readFile, readlink } from 'node:fs/promises';
import os from 'node:os';
import { redactString } from '../redaction.js';
import { ToolExecutionError } from '../tools/errors.js';
import type { CollectorHealth, ProcessSummary } from './types.js';

interface ProcRecord extends ProcessSummary { uid: number; start_ticks: number; }
interface ProcContext { uptime: number; totalMemory: number; bootEpoch: number; }
const LINUX_USER_HZ = 100;
const PROC_READ_CONCURRENCY = 32;

interface ProcfsDependencies {
  listPids: () => Promise<number[]>;
  readText: (path: string, signal?: AbortSignal) => Promise<string>;
  readBuffer: (path: string, signal?: AbortSignal) => Promise<Buffer>;
  readLink: (path: string) => Promise<string | null>;
  cpuCount: () => number;
  now: () => number;
}

const defaultDependencies: ProcfsDependencies = {
  listPids: async () => (await readdir('/proc', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name)),
  readText: (path, signal) => readFile(path, { encoding: 'utf8', signal }),
  readBuffer: (path, signal) => readFile(path, { signal }),
  readLink: (path) => readlink(path).catch(() => null),
  cpuCount: () => os.cpus().length,
  now: () => Date.now(),
};

/** Parse procfs colon-delimited status and meminfo records. */
export function parseProcStatus(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\n').flatMap((line) => {
    const index = line.indexOf(':'); return index > 0 ? [[line.slice(0, index), line.slice(index + 1).trim()]] : [];
  }));
}

/** Read bounded, redacted process metadata without ever opening environ. */
export class ProcfsAdapter {
  private passwd: Map<number, string> | null = null;

  constructor(private readonly dependencies: ProcfsDependencies = defaultDependencies) {}

  async list(input: { sort_by: string; order: string; user?: string; query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ProcessSummary[]; original_count: number; omitted_count: number; health: CollectorHealth }> {
    const started = this.dependencies.now();
    const [candidates, context] = await Promise.all([this.dependencies.listPids(), this.context(signal)]);
    let failures = 0;
    const processes: ProcRecord[] = [];
    for (let index = 0; index < candidates.length; index += PROC_READ_CONCURRENCY) {
      this.ensureActive(signal);
      const batch = await Promise.all(candidates.slice(index, index + PROC_READ_CONCURRENCY).map((pid) =>
        this.read(pid, context, signal).catch(() => { failures++; return null; })));
      processes.push(...batch.filter((item): item is ProcRecord => Boolean(item)));
    }
    let filtered = processes;
    if (input.user) filtered = filtered.filter((item) => item.user === input.user);
    if (input.query) { const query = input.query.toLowerCase(); filtered = filtered.filter((item) => `${item.name} ${item.command_line}`.toLowerCase().includes(query)); }
    const factor = input.order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => factor * this.sortValue(a, b, input.sort_by));
    return { items: filtered.slice(0, input.limit), original_count: filtered.length, omitted_count: Math.max(0, filtered.length - input.limit), health: { collector: 'procfs', status: failures ? 'partial' : 'ok', message: failures ? `${failures} process record(s) became unavailable or unreadable` : undefined, duration_ms: this.dependencies.now() - started } };
  }

  async get(pid: number, signal?: AbortSignal): Promise<ProcessSummary> {
    try { return await this.read(pid, await this.context(signal), signal); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ESRCH') throw new ToolExecutionError('RESOURCE_NOT_FOUND', `Process ${pid} was not found`);
      throw error;
    }
  }

  private async context(signal?: AbortSignal): Promise<ProcContext> {
    this.ensureActive(signal);
    const [uptimeText, memText] = await Promise.all([
      this.dependencies.readText('/proc/uptime', signal),
      this.dependencies.readText('/proc/meminfo', signal),
    ]);
    const uptime = Number(uptimeText.split(/\s+/)[0]) || 0;
    return {
      uptime,
      totalMemory: Number.parseInt(parseProcStatus(memText).MemTotal || '0', 10) * 1024,
      bootEpoch: this.dependencies.now() / 1000 - uptime,
    };
  }

  private async read(pid: number, context: ProcContext, signal?: AbortSignal): Promise<ProcRecord> {
    this.ensureActive(signal);
    const base = `/proc/${pid}`;
    const [statusText, statText, cmdline, executable] = await Promise.all([
      this.dependencies.readText(`${base}/status`, signal),
      this.dependencies.readText(`${base}/stat`, signal),
      this.dependencies.readBuffer(`${base}/cmdline`, signal),
      this.dependencies.readLink(`${base}/exe`),
    ]);
    const status = parseProcStatus(statusText);
    const close = statText.lastIndexOf(')');
    const fields = statText.slice(close + 2).trim().split(/\s+/);
    const uid = Number(status.Uid?.split(/\s+/)[0] || 0);
    const rss = Number.parseInt(status.VmRSS || '0', 10) * 1024;
    const cpuSeconds = ((Number(fields[11]) || 0) + (Number(fields[12]) || 0)) / LINUX_USER_HZ;
    const startTicks = Number(fields[19]) || 0;
    const elapsed = Math.max(0.001, context.uptime - startTicks / LINUX_USER_HZ);
    const command = cmdline.length ? cmdline.toString('utf8').split('\0').filter(Boolean).join(' ') : `[${status.Name || pid}]`;
    return {
      pid, ppid: Number(fields[1]) || 0, uid, user: await this.user(uid), state: fields[0] || status.State || 'unknown', name: status.Name || String(pid),
      cpu_percent: Number(Math.min(100 * Math.max(1, this.dependencies.cpuCount()), 100 * cpuSeconds / elapsed).toFixed(2)),
      memory_bytes: rss, memory_percent: context.totalMemory ? Number((100 * rss / context.totalMemory).toFixed(2)) : 0,
      start_ticks: startTicks, start_time: startTicks ? new Date((context.bootEpoch + startTicks / LINUX_USER_HZ) * 1000).toISOString() : null,
      executable, command_line: redactString(command).slice(0, 4096),
    };
  }

  private ensureActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ToolExecutionError('TOOL_TIMEOUT', 'Process collection was aborted');
  }

  private async user(uid: number): Promise<string> {
    if (!this.passwd) {
      const text = await this.dependencies.readText('/etc/passwd');
      this.passwd = new Map(text.split('\n').filter(Boolean).map((line) => { const values = line.split(':'); return [Number(values[2]), values[0]]; }));
    }
    return this.passwd.get(uid) || String(uid);
  }

  private sortValue(a: ProcRecord, b: ProcRecord, field: string): number {
    if (field === 'pid') return a.pid - b.pid;
    if (field === 'memory') return a.memory_bytes - b.memory_bytes;
    if (field === 'start_time') return a.start_ticks - b.start_ticks;
    return a.cpu_percent - b.cpu_percent;
  }
}
