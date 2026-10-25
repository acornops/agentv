import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { FilesystemAdapter } from '../adapters/filesystems.js';
import { MockHostAdapter } from '../adapters/mock.js';
import type { CollectorHealth, FilesystemSummary, HostAdapter } from '../adapters/types.js';
import { createLogger } from '../logger.js';
import { Observability } from '../observability.js';
import { ToolExecutionError } from '../tools/errors.js';
import { SnapshotManager } from './snapshot-manager.js';

interface FilesystemRow { source: string; type: string; mount: string; used: number; }
interface SnapshotData {
  filesystems: FilesystemSummary[];
  findings: Array<{ code: string; mount?: string; severity: string }>;
  finding_coverage: { filesystems: 'complete' | 'incomplete'; services: 'complete' | 'incomplete' };
  collector_health: CollectorHealth[];
  top_processes: unknown[];
  degraded_services: unknown[];
  listeners: unknown[];
  truncation: { filesystems: number; processes: number; services: number; listeners: number };
}

/** Keep the real df parser and collector limits while substituting host commands. */
function filesystemAdapter(rows: FilesystemRow[]): FilesystemAdapter {
  return new FilesystemAdapter(async (executable, args) => {
    if (executable !== '/bin/df') throw new Error('Unexpected command');
    const inodes = args.includes('-i');
    return {
      stdout: 'Filesystem Type Total Used Free Use% Mounted on\n' + rows.map((row) =>
        `${row.source} ${row.type} 1000 ${inodes ? 100 : row.used * 10} ${inodes ? 900 : 1000 - row.used * 10} ${inodes ? 10 : row.used}% ${row.mount}`,
      ).join('\n'),
      stderr: '',
    };
  }, async () => '36 25 0:32 / /var ro,relatime - ext4 /dev/data rw\n');
}

/** Wait for a serialized snapshot or an explicit over-budget drop. */
async function collect(
  adapter: FilesystemAdapter,
  maxBytes = 64 * 1024,
  services?: Awaited<ReturnType<HostAdapter['listServices']>>,
) {
  const host: HostAdapter = new MockHostAdapter();
  host.listFilesystems = (input: Parameters<HostAdapter['listFilesystems']>[0]) => adapter.list(input);
  if (services) host.listServices = async () => services;
  const sent: Buffer[] = [];
  const metrics = new Observability();
  const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), metrics);
  try {
    manager.start(60_000, maxBytes);
    await vi.waitFor(() => expect(sent.length + metrics.snapshot().dropped_snapshots).toBe(1));
    const decoded = sent[0] ? gunzipSync(sent[0]) : null;
    const data = decoded ? (JSON.parse(decoded.toString('utf8')) as { params: { data: SnapshotData } }).params.data : null;
    return { data, decoded, sent, counters: metrics.snapshot() };
  } finally {
    manager.stop();
  }
}

const snapRows: FilesystemRow[] = [
  { source: '/dev/root', type: 'ext4', mount: '/', used: 50 },
  ...Array.from({ length: 60 }, (_, i) => ({ source: `/dev/loop${i}`, type: 'squashfs', mount: `/snap/pkg${String(i).padStart(2, '0')}`, used: 100 })),
  { source: '/dev/data', type: 'ext4', mount: '/var', used: 100 },
];

describe('snapshot filesystem inventory bounds', () => {
  it('reports full /var after more than 50 immutable mounts without expanding retained inventory or the public tool result', async () => {
    const adapter = filesystemAdapter(snapRows);
    const toolPage = await adapter.list({ include_pseudo: false, limit: 50 });
    const { data } = await collect(adapter);

    expect(data!.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE')).toEqual([
      { code: 'FILESYSTEM_PRESSURE', mount: '/var', severity: 'critical', summary: 'Filesystem /var is 100% used' },
    ]);
    expect(toolPage).toMatchObject({ original_count: 62, omitted_count: 12, truncated: true });
    expect(data!.filesystems).toEqual(toolPage.items);
    expect(data!.filesystems).toHaveLength(50);
    expect(data!.truncation).toEqual({ filesystems: 12, processes: 0, services: 0, listeners: 0 });
    expect(data!.finding_coverage).toEqual({ filesystems: 'complete', services: 'complete' });
    expect(data!.collector_health).toContainEqual(expect.objectContaining({ collector: 'filesystems', status: 'ok' }));
    expect(data!.top_processes).toHaveLength(1);
    expect(data!.degraded_services).toHaveLength(1);
    expect(data!.listeners).toHaveLength(1);
  });

  it('retains every eligible capacity finding even when there are more than 50 eligible mounts', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ source: `/dev/data${i}`, type: 'ext4', mount: `/data/${String(i).padStart(2, '0')}`, used: 90 }));
    const { data } = await collect(filesystemAdapter(rows));
    const findings = data!.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE');

    expect(findings).toHaveLength(60);
    expect(findings).toContainEqual({ code: 'FILESYSTEM_PRESSURE', mount: '/data/59', severity: 'critical', summary: 'Filesystem /data/59 is 90% used' });
    expect(data!.filesystems).toHaveLength(50);
    expect(data!.truncation.filesystems).toBe(10);
  });

  it('preserves findings while trimming optional facts to a low byte budget and counts all omitted rows', async () => {
    const { data, decoded, sent, counters } = await collect(filesystemAdapter(snapRows), 4096);

    expect(data!.findings).toContainEqual({ code: 'FILESYSTEM_PRESSURE', mount: '/var', severity: 'critical', summary: 'Filesystem /var is 100% used' });
    expect(data!.filesystems.length).toBeLessThan(50);
    expect(data!.filesystems).toEqual((await filesystemAdapter(snapRows).list({ include_pseudo: false, limit: data!.filesystems.length })).items);
    expect(data!.truncation.filesystems).toBe(62 - data!.filesystems.length);
    expect(data!.finding_coverage).toEqual({ filesystems: 'complete', services: 'complete' });
    expect(data!.top_processes).toEqual([]);
    expect(data!.listeners).toEqual([]);
    expect(data!.truncation.processes).toBe(1);
    expect(data!.truncation.listeners).toBe(1);
    expect(decoded!.byteLength).toBeLessThanOrEqual(4096);
    expect(sent[0].byteLength).toBeLessThanOrEqual(4096);
    expect(counters.dropped_snapshots).toBe(0);
  });

  it('drops rather than partially reporting capacity findings when required findings exceed the byte budget', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ source: `/dev/data${i}`, type: 'ext4', mount: `/data/${i}`, used: 100 }));
    const { sent, counters } = await collect(filesystemAdapter(rows), 4096);

    expect(sent).toEqual([]);
    expect(counters.dropped_snapshots).toBe(1);
  });

  it.each([0, 1])('keeps service finding coverage separate from inventory trimming with %i collection omissions', async (omitted) => {
    const services = {
      items: Array.from({ length: 5 }, (_, index) => ({
        unit: `failed-${index}.service`, description: 'A'.repeat(2000),
        load_state: 'loaded', active_state: 'failed', sub_state: 'failed',
      })),
      original_count: 5 + omitted, omitted_count: omitted,
      health: { collector: 'systemd', status: 'ok' as const, duration_ms: 1 },
    };
    const { data } = await collect(filesystemAdapter([]), 8192, services);

    expect(data!.findings.filter((finding) => finding.code === 'SERVICE_FAILED')).toHaveLength(5);
    expect(data!.degraded_services.length).toBeLessThan(5);
    expect(data!.truncation.services).toBe(5 + omitted - data!.degraded_services.length);
    expect(data!.finding_coverage.services).toBe(omitted === 0 ? 'complete' : 'incomplete');
  });

  it.each([
    { error: new ToolExecutionError('TOOL_TIMEOUT', 'df timed out'), status: 'timed_out' },
    { error: new ToolExecutionError('PERMISSION_DENIED', 'df access denied'), status: 'permission_denied' },
    { error: new Error('df unavailable'), status: 'unavailable' },
  ])('reports $status collection instead of healthy empty filesystem facts', async ({ error, status }) => {
    const adapter = new FilesystemAdapter(async () => { throw error; }, async () => '');
    const { data } = await collect(adapter);

    expect(data!.filesystems).toEqual([]);
    expect(data!.finding_coverage).toEqual({ filesystems: 'incomplete', services: 'complete' });
    expect(data!.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE')).toEqual([]);
    expect(data!.collector_health.filter((health) => health.collector === 'filesystems')).toEqual([
      expect.objectContaining({ collector: 'filesystems', status, message: 'Collection failed' }),
    ]);
  });
});
