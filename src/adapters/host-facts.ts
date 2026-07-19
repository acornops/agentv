import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { CollectorHealth, HostSummary } from './types.js';

interface HostFactsDependencies {
  readText: (path: string, signal?: AbortSignal) => Promise<string>;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  hostname: () => string;
  release: () => string;
  architecture: () => string;
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason || new Error('CPU sample aborted');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    const aborted = () => { clearTimeout(timer); reject(signal?.reason || new Error('CPU sample aborted')); };
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

const defaults: HostFactsDependencies = {
  readText: (path, signal) => readFile(path, { encoding: 'utf8', signal }),
  sleep,
  hostname: os.hostname,
  release: os.release,
  architecture: os.arch,
};

function pairs(text: string, separator = '='): Record<string, string> {
  return Object.fromEntries(text.split('\n').flatMap((line) => {
    const index = line.indexOf(separator);
    if (index < 1) return [];
    return [[line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]];
  }));
}

function memBytes(value: string | undefined): number {
  const kib = Number.parseInt(value || '0', 10);
  return Number.isFinite(kib) ? kib * 1024 : 0;
}

async function cpuSample(dependencies: HostFactsDependencies, signal?: AbortSignal): Promise<{ usage_percent: number | null; sampled_ms: number }> {
  const read = async () => (await dependencies.readText('/proc/stat', signal)).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const before = await read();
  const sampledMs = 100;
  await dependencies.sleep(sampledMs, signal);
  const after = await read();
  const totalBefore = before.reduce((sum, value) => sum + value, 0);
  const totalAfter = after.reduce((sum, value) => sum + value, 0);
  const idleBefore = (before[3] || 0) + (before[4] || 0);
  const idleAfter = (after[3] || 0) + (after[4] || 0);
  const total = totalAfter - totalBefore;
  return { usage_percent: total > 0 ? Number((100 * (1 - ((idleAfter - idleBefore) / total))).toFixed(2)) : null, sampled_ms: sampledMs };
}

/** Collect immutable and sampled host facts from Linux procfs. */
export class HostFactsAdapter {
  constructor(private readonly dependencies: HostFactsDependencies = defaults) {}

  async collect(signal?: AbortSignal): Promise<HostSummary> {
    const started = Date.now();
    const health: CollectorHealth[] = [];
    const [releaseText, bootId, uptimeText, loadText, memoryText] = await Promise.all([
      this.dependencies.readText('/etc/os-release', signal), this.dependencies.readText('/proc/sys/kernel/random/boot_id', signal),
      this.dependencies.readText('/proc/uptime', signal), this.dependencies.readText('/proc/loadavg', signal), this.dependencies.readText('/proc/meminfo', signal),
    ]);
    const release = pairs(releaseText);
    const memory = pairs(memoryText, ':');
    const total = memBytes(memory.MemTotal);
    const available = memBytes(memory.MemAvailable);
    const swapTotal = memBytes(memory.SwapTotal);
    const swapFree = memBytes(memory.SwapFree);
    let cpu = { usage_percent: null as number | null, sampled_ms: 100 };
    try { cpu = await cpuSample(this.dependencies, signal); health.push({ collector: 'cpu', status: 'ok', duration_ms: Date.now() - started }); }
    catch { health.push({ collector: 'cpu', status: 'partial', message: 'CPU sample unavailable', duration_ms: Date.now() - started }); }
    let pressureAvailable = true;
    try { await this.dependencies.readText('/proc/pressure/cpu', signal); } catch { pressureAvailable = false; }
    health.push({ collector: 'host_facts', status: 'ok', duration_ms: Date.now() - started });
    const load = loadText.trim().split(/\s+/).map(Number);
    return {
      hostname: this.dependencies.hostname(), distro: { id: release.ID || 'unknown', version: release.VERSION_ID || 'unknown', pretty_name: release.PRETTY_NAME || 'Unknown Linux' },
      kernel: this.dependencies.release(), architecture: this.dependencies.architecture(), boot_id: bootId.trim(), uptime_seconds: Math.floor(Number(uptimeText.split(/\s+/)[0]) || 0),
      load: { one: load[0] || 0, five: load[1] || 0, fifteen: load[2] || 0 }, cpu,
      memory: { total_bytes: total, available_bytes: available, used_bytes: Math.max(0, total - available), used_percent: total ? Number((100 * (total - available) / total).toFixed(2)) : 0 },
      swap: { total_bytes: swapTotal, free_bytes: swapFree, used_bytes: Math.max(0, swapTotal - swapFree), used_percent: swapTotal ? Number((100 * (swapTotal - swapFree) / swapTotal).toFixed(2)) : 0 },
      pressure_available: pressureAvailable, collector_health: health,
    };
  }
}
