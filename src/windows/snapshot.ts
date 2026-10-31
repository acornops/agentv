import { gzipSync } from 'node:zlib';
import type { CollectorHealth } from '../adapters/types.js';
import type { Logger } from '../logger.js';
import { createNotification } from '../mcp/protocol.js';
import type { Observability } from '../observability.js';
import { redactValue } from '../redaction.js';
import { ToolExecutionError } from '../tools/errors.js';
import type { WindowsHost } from './types.js';
import { isFailedService } from './service-health.js';
export { isFailedService } from './service-health.js';

/** Build Windows-only telemetry; incomplete enumeration can never assert recovery. */
export async function buildWindowsSnapshot(host: WindowsHost, signal?: AbortSignal) {
  const health: CollectorHealth[] = [];
  const safe = async <T>(collector: string, operation: () => Promise<T>) => {
    try { return await operation(); } catch (error) { health.push({ collector, status: error instanceof ToolExecutionError && error.toolCode === 'PERMISSION_DENIED' ? 'permission_denied' : error instanceof ToolExecutionError && error.toolCode === 'TOOL_TIMEOUT' ? 'timed_out' : 'unavailable', duration_ms: 0 }); return null; }
  };
  const [summary, volumes, services, processes, listeners] = await Promise.all([
    safe('windows_host', () => host.getHostSummary(signal)), safe('windows_volumes', () => host.listFilesystems({ limit: 1000 }, signal)), safe('windows_services', () => host.listServices({ limit: 1000, state: 'all' }, signal)), safe('windows_processes', () => host.listProcesses({ limit: 20 }, signal)), safe('windows_listeners', () => host.listListeners({ limit: 50 }, signal)),
  ]);
  if (summary) health.push(...summary.collector_health);
  for (const section of [volumes, services, processes, listeners]) if (section) health.push(section.health);
  const failures = (services?.items || []).filter(isFailedService);
  const findings: Array<Record<string, unknown>> = failures.map((item) => ({ severity: 'critical', code: 'SERVICE_FAILED', name: item.name, summary: `Windows service ${item.name} stopped with exit code ${item.exit_code}` }));
  if (summary && summary.memory.used_percent >= 90) findings.push({ severity: 'critical', code: 'MEMORY_PRESSURE', summary: `Memory use is ${summary.memory.used_percent}%` });
  for (const volume of volumes?.items || []) if (volume.used_percent !== null && volume.used_percent >= 90) findings.push({ severity: 'critical', code: 'FILESYSTEM_PRESSURE', volume: volume.volume, summary: `Volume ${volume.volume} is ${volume.used_percent}% used` });
  const servicesKnown = services?.items.every((item) => ['Running', 'Stopped'].includes(item.state || '') && item.start_mode !== null && ['Auto', 'Automatic', 'Manual', 'Disabled'].includes(item.start_mode) && item.exit_code !== null);
  const snapshot = { schema_version: 'acornops.agentv-windows-snapshot.v1' as const, host_summary: summary, filesystems: volumes?.items.slice(0, 50) || [], degraded_services: failures.slice(0, 50), top_processes: processes?.items || [], listeners: listeners?.items || [], findings, collector_health: health,
    finding_coverage: { filesystems: volumes?.health.status === 'ok' && volumes.omitted_count === 0 && volumes.items.every((item) => item.used_percent !== null) ? 'complete' : 'incomplete', services: services?.health.status === 'ok' && services.omitted_count === 0 && servicesKnown ? 'complete' : 'incomplete' },
    truncation: { filesystems: (volumes?.omitted_count || 0) + Math.max(0, (volumes?.items.length || 0) - 50), services: (services?.omitted_count || 0) + Math.max(0, failures.length - 50), processes: processes?.omitted_count || 0, listeners: listeners?.omitted_count || 0 },
  };
  return redactValue(snapshot) as typeof snapshot;
}

/** Schedule cancellable Windows snapshots without changing Linux SnapshotManager. */
export class WindowsSnapshotManager {
  private interval: NodeJS.Timeout | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private inFlight = false;
  constructor(private readonly host: WindowsHost, private readonly send: (payload: Buffer) => boolean, private readonly logger: Logger, private readonly metrics: Observability) {}
  start(intervalMs: number, maxBytes: number): void { this.stop(); const generation = this.generation; this.controller = new AbortController(); this.interval = setInterval(() => void this.collect(generation, maxBytes), intervalMs); this.interval.unref(); void this.collect(generation, maxBytes); }
  stop(): void { this.generation++; clearInterval(this.interval); this.interval = undefined; this.controller?.abort(); }
  private async collect(generation: number, maxBytes: number): Promise<void> {
    if (this.inFlight) { this.metrics.increment('skipped_snapshots'); return; }
    this.inFlight = true;
    try {
      const snapshot = await buildWindowsSnapshot(this.host, this.controller?.signal);
      if (generation !== this.generation) return;
      const optional = ['top_processes', 'listeners', 'filesystems', 'degraded_services'] as const;
      while (Buffer.byteLength(JSON.stringify(snapshot)) > maxBytes - 1024 && optional.some((key) => snapshot[key].length)) {
        const key = optional.find((key) => snapshot[key].length)!; snapshot[key].pop(); snapshot.truncation[key === 'top_processes' ? 'processes' : key === 'degraded_services' ? 'services' : key]++;
      }
      const bytes = Buffer.from(JSON.stringify(createNotification('notify/snapshot', { timestamp: new Date().toISOString(), data: snapshot })));
      if (bytes.length > maxBytes) { this.metrics.increment('dropped_snapshots'); return; }
      const compressed = gzipSync(bytes);
      if (compressed.length > maxBytes || !this.send(compressed)) this.metrics.increment('dropped_snapshots');
    } catch { this.logger.warn({}, 'Windows snapshot unavailable'); } finally { this.inFlight = false; }
  }
}
