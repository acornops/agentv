import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { HostAdapter, CollectorHealth } from '../adapters/types.js';
import type { Logger } from '../logger.js';
import { createNotification } from '../mcp/protocol.js';
import type { Observability } from '../observability.js';
import { ToolExecutionError } from '../tools/errors.js';

const gzipAsync = promisify(gzip);
type Trigger = 'startup' | 'manual' | 'interval';

/** Build bounded telemetry directly from adapters and send compressed snapshots. */
export class SnapshotManager {
  private interval: NodeJS.Timeout | null = null;
  private active = false;
  private generation = 0;
  private inFlight = false;
  private pending = false;
  private maxBytes = 1024 * 1024;

  constructor(
    private readonly host: HostAdapter,
    private readonly send: (payload: Buffer) => boolean,
    private readonly logger: Logger,
    private readonly metrics: Observability,
  ) {}

  start(intervalMs: number, maxBytes: number): void {
    this.stop(); this.active = true; this.generation++; this.maxBytes = maxBytes;
    const generation = this.generation;
    this.interval = setInterval(() => void this.collect(generation, 'interval'), intervalMs); this.interval.unref();
    void this.collect(generation, 'startup');
  }

  stop(): void { this.active = false; this.generation++; this.pending = false; if (this.interval) clearInterval(this.interval); this.interval = null; }
  trigger(): void { if (this.active) void this.collect(this.generation, 'manual'); }

  private async collect(generation: number, trigger: Trigger): Promise<void> {
    if (!this.active || generation !== this.generation) return;
    if (this.inFlight) {
      this.metrics.increment('skipped_snapshots');
      if (trigger !== 'interval') this.pending = true;
      return;
    }
    this.inFlight = true; const started = Date.now();
    try {
      const health: CollectorHealth[] = [];
      const safe = async <T>(collector: string, operation: () => Promise<T>, fallback: T): Promise<T> => {
        const collectorStarted = Date.now();
        try { return await operation(); }
        catch (error) {
          const status = error instanceof ToolExecutionError && error.toolCode === 'PERMISSION_DENIED' ? 'permission_denied'
            : error instanceof ToolExecutionError && error.toolCode === 'TOOL_TIMEOUT' ? 'timed_out' : 'unavailable';
          health.push({ collector, status, message: 'Collection failed', duration_ms: Date.now() - collectorStarted }); return fallback;
        }
      };
      const [hostSummary, filesystems, services, processes, listeners] = await Promise.all([
        safe('host_facts', () => this.host.getHostSummary(), null),
        safe('filesystems', () => this.host.listFilesystems({ include_pseudo: false, limit: 50 }), null),
        safe('systemd', () => this.host.listServices({ state: 'failed', limit: 50 }), null),
        safe('procfs', () => this.host.listProcesses({ sort_by: 'cpu', order: 'desc', limit: 20 }), null),
        safe('sockets', () => this.host.listListeners({ limit: 50 }), null),
      ]);
      if (!this.active || generation !== this.generation) return;
      if (hostSummary) health.push(...hostSummary.collector_health);
      for (const section of [filesystems, services, processes, listeners]) if (section) health.push(section.health);
      const findings: Array<Record<string, unknown>> = [];
      if (hostSummary && hostSummary.memory.used_percent >= 90) findings.push({ severity: 'critical', code: 'MEMORY_PRESSURE', summary: `Memory use is ${hostSummary.memory.used_percent}%` });
      for (const item of filesystems?.items || []) if (item.used_percent >= 90) findings.push({ severity: 'critical', code: 'FILESYSTEM_PRESSURE', mount: item.mount, summary: `Filesystem ${item.mount} is ${item.used_percent}% used` });
      for (const item of services?.items || []) findings.push({ severity: 'critical', code: 'SERVICE_FAILED', unit: item.unit, summary: `${item.unit} is failed` });
      const snapshot: Record<string, any> = {
        schema_version: 'acornops.agentv-snapshot.v2', host_summary: hostSummary,
        filesystems: filesystems?.items || [], degraded_services: services?.items || [], top_processes: processes?.items || [],
        listeners: listeners?.items || [], findings, collector_health: health,
        truncation: { filesystems: filesystems?.omitted_count || 0, services: services?.omitted_count || 0, processes: processes?.omitted_count || 0, listeners: listeners?.omitted_count || 0 },
      };
      const dataBudget = Math.max(0, this.maxBytes - 1024);
      const optional = ['top_processes', 'listeners', 'filesystems', 'degraded_services'];
      while (Buffer.byteLength(JSON.stringify(snapshot)) > dataBudget && optional.some((key) => snapshot[key].length)) {
        const key = optional.find((candidate) => snapshot[candidate].length) as string;
        snapshot[key].pop(); snapshot.truncation[key === 'top_processes' ? 'processes' : key === 'degraded_services' ? 'services' : key]++;
        this.metrics.increment('truncations');
      }
      const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot));
      if (snapshotBytes > dataBudget) {
        this.metrics.increment('dropped_snapshots');
        this.logger.warn({ snapshotBytes, dataBudget }, 'Dropping snapshot whose required sections exceed the byte budget');
        return;
      }
      const notification = createNotification('notify/snapshot', { timestamp: new Date().toISOString(), data: snapshot });
      const notificationBytes = Buffer.from(JSON.stringify(notification));
      if (notificationBytes.length > this.maxBytes) { this.metrics.increment('dropped_snapshots'); return; }
      const compressed = await gzipAsync(notificationBytes);
      if (compressed.length > this.maxBytes) { this.metrics.increment('dropped_snapshots'); this.logger.warn({ compressedBytes: compressed.length, maxBytes: this.maxBytes }, 'Dropping over-budget snapshot'); return; }
      if (!this.send(compressed)) { this.metrics.increment('dropped_snapshots'); return; }
      this.logger.info({ durationMs: Date.now() - started, compressedBytes: compressed.length, findings: findings.length }, 'Snapshot prepared');
    } finally {
      this.metrics.recordCollection(Date.now() - started); this.inFlight = false;
      if (this.pending && this.active) { this.pending = false; void this.collect(this.generation, 'manual'); }
    }
  }
}
