import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MockHostAdapter } from '../adapters/mock.js';
import type { FilesystemSummary } from '../adapters/types.js';
import { createLogger } from '../logger.js';
import { Observability } from '../observability.js';
import { ToolExecutionError } from '../tools/errors.js';
import { SnapshotManager } from './snapshot-manager.js';

/** Hold a collector at a known boundary without waiting on wall-clock time. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}

/** Observe calls to the inventory boundary while keeping its normal results. */
function observeInventory(host: MockHostAdapter) {
  return [
    vi.spyOn(host, 'listFilesystems'), vi.spyOn(host, 'listServices'),
    vi.spyOn(host, 'listProcesses'), vi.spyOn(host, 'listListeners'),
  ];
}

/** Capture real snapshot serialization with controlled host filesystem facts. */
async function collectFilesystemSnapshot(filesystems: FilesystemSummary[]) {
  const host = new MockHostAdapter();
  vi.spyOn(host, 'listFilesystems').mockResolvedValue({
    items: filesystems, original_count: filesystems.length, omitted_count: 0, truncated: false,
    health: { collector: 'filesystems', status: 'ok', duration_ms: 1 },
  });
  const sent: Buffer[] = [];
  const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), new Observability());
  try {
    manager.start(60_000, 64 * 1024);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    return (JSON.parse(gunzipSync(sent[0]).toString('utf8')) as {
      params: { data: { filesystems: FilesystemSummary[]; findings: Array<Record<string, unknown>> } };
    }).params.data;
  } finally {
    manager.stop();
  }
}

describe('SnapshotManager', () => {
  it('finishes the host sample before starting inventory collectors in parallel', async () => {
    const host = new MockHostAdapter();
    const summary = await host.getHostSummary();
    const hostSample = deferred();
    const filesystemCollection = deferred();
    vi.spyOn(host, 'getHostSummary').mockImplementation(async () => { await hostSample.promise; return summary; });
    const listFilesystems = host.listFilesystems.bind(host);
    const inventory = observeInventory(host);
    vi.mocked(host.listFilesystems).mockImplementation(async (input) => { await filesystemCollection.promise; return listFilesystems(input); });
    const sent: Buffer[] = [];
    const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), new Observability());

    try {
      manager.start(60_000, 64 * 1024);
      for (const collector of inventory) expect(collector).not.toHaveBeenCalled();
      expect(sent).toEqual([]);

      hostSample.resolve();
      await vi.waitFor(() => { for (const collector of inventory) expect(collector).toHaveBeenCalledOnce(); });
      expect(sent).toEqual([]);

      filesystemCollection.resolve();
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const snapshot = JSON.parse(gunzipSync(sent[0]).toString('utf8')).params.data;
      expect(snapshot.host_summary).toEqual(summary);
      expect(snapshot.top_processes).toHaveLength(1);
    } finally {
      manager.stop(); hostSample.resolve(); filesystemCollection.resolve();
    }
  });

  it.each([
    { error: new Error('host unavailable'), status: 'unavailable' },
    { error: new ToolExecutionError('TOOL_TIMEOUT', 'host timed out'), status: 'timed_out' },
  ])('still collects inventory when host facts are $status', async ({ error, status }) => {
    const host = new MockHostAdapter();
    vi.spyOn(host, 'getHostSummary').mockRejectedValue(error);
    const sent: Buffer[] = [];
    const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), new Observability());

    try {
      manager.start(60_000, 64 * 1024);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const snapshot = JSON.parse(gunzipSync(sent[0]).toString('utf8')).params.data;
      expect(snapshot.host_summary).toBeNull();
      for (const section of ['filesystems', 'degraded_services', 'top_processes', 'listeners']) expect(snapshot[section]).toHaveLength(1);
      expect(snapshot.collector_health).toContainEqual(expect.objectContaining({ collector: 'host_facts', status }));
    } finally {
      manager.stop();
    }
  });

  it('does not launch inventory or send a snapshot after stopping during the host sample', async () => {
    const host = new MockHostAdapter();
    const summary = await host.getHostSummary();
    const hostSample = deferred();
    vi.spyOn(host, 'getHostSummary').mockImplementation(async () => { await hostSample.promise; return summary; });
    const inventory = observeInventory(host);
    const metrics = new Observability();
    const finished = vi.spyOn(metrics, 'recordCollection');
    const sent: Buffer[] = [];
    const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), metrics);

    try {
      manager.start(60_000, 64 * 1024);
      manager.stop();
      hostSample.resolve();
      await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce());

      for (const collector of inventory) expect(collector).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    } finally {
      manager.stop(); hostSample.resolve();
    }
  });

  it('restarts with a fresh host sample without launching stale inventory', async () => {
    const host = new MockHostAdapter();
    const summary = await host.getHostSummary();
    const staleSample = deferred();
    const currentSample = deferred();
    const hostSummary = vi.spyOn(host, 'getHostSummary')
      .mockImplementationOnce(async () => { await staleSample.promise; return { ...summary, hostname: 'stale' }; })
      .mockImplementationOnce(async () => { await currentSample.promise; return { ...summary, hostname: 'current' }; });
    const inventory = observeInventory(host);
    const sent: Buffer[] = [];
    const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), new Observability());

    try {
      manager.start(60_000, 64 * 1024);
      manager.start(60_000, 64 * 1024);
      staleSample.resolve();
      await vi.waitFor(() => expect(hostSummary).toHaveBeenCalledTimes(2));
      for (const collector of inventory) expect(collector).not.toHaveBeenCalled();
      expect(sent).toEqual([]);

      currentSample.resolve();
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      for (const collector of inventory) expect(collector).toHaveBeenCalledOnce();
      expect(JSON.parse(gunzipSync(sent[0]).toString('utf8')).params.data.host_summary.hostname).toBe('current');
    } finally {
      manager.stop(); staleSample.resolve(); currentSample.resolve();
    }
  });

  it.each([
    { type: 'squashfs', mount: '/snap/certbot/5781', read_only: true },
    { type: 'squashfs', mount: '/opt/application-image', read_only: false },
    { type: 'erofs', mount: '/opt/container-image', read_only: true },
    { type: 'cramfs', mount: '/mnt/firmware', read_only: true },
    { type: 'romfs', mount: '/mnt/recovery', read_only: true },
    { type: 'iso9660', mount: '/media/installer', read_only: true },
  ])('retains $type facts at $mount without reporting capacity pressure', async (image) => {
    const filesystem: FilesystemSummary = {
      filesystem: '/dev/loop1', ...image, total_bytes: 1000, used_bytes: 1000,
      free_bytes: 0, used_percent: 100, inode_used_percent: 100,
    };
    const snapshot = await collectFilesystemSnapshot([filesystem]);

    expect(snapshot.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE')).toEqual([]);
    expect(snapshot.filesystems).toEqual([filesystem]);
    expect(snapshot.findings).toContainEqual(expect.objectContaining({ code: 'SERVICE_FAILED' }));
  });

  it.each([
    { type: 'ext4', mount: '/', filesystem: '/dev/sda1', read_only: true },
    { type: 'ext4', mount: '/mnt/data', filesystem: '/dev/loop2', read_only: false },
    { type: 'ext4', mount: '/snap/data', filesystem: '/dev/sdb1', read_only: false },
    { type: 'xfs', mount: '/var', filesystem: '/dev/sdc1', read_only: true },
    { type: 'btrfs', mount: '/home', filesystem: '/dev/sdd1', read_only: false },
    { type: 'tmpfs', mount: '/dev/shm', filesystem: 'tmpfs', read_only: false },
    { type: 'overlay', mount: '/mnt/container', filesystem: 'overlay', read_only: false },
    { type: 'nfs4', mount: '/mnt/shared', filesystem: 'server:/data', read_only: true },
    { type: 'futurefs', mount: '/mnt/new-format', filesystem: '/dev/sde1', read_only: true },
  ])('still reports full $type storage at $mount (read_only=$read_only)', async (storage) => {
    const filesystem: FilesystemSummary = {
      ...storage, total_bytes: 1000, used_bytes: 1000, free_bytes: 0,
      used_percent: 100, inode_used_percent: 10,
    };
    const snapshot = await collectFilesystemSnapshot([filesystem]);

    expect(snapshot.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE')).toEqual([
      { code: 'FILESYSTEM_PRESSURE', mount: storage.mount, severity: 'critical', summary: `Filesystem ${storage.mount} is 100% used` },
    ]);
    expect(snapshot.filesystems).toEqual([filesystem]);
  });

  it.each([
    { used_percent: 89, findingCount: 0 },
    { used_percent: 90, findingCount: 1 },
  ])('keeps the capacity threshold at 90% for $used_percent% usage', async ({ used_percent, findingCount }) => {
    const snapshot = await collectFilesystemSnapshot([{
      filesystem: '/dev/sda1', mount: '/', type: 'ext4', read_only: true,
      total_bytes: 1000, used_bytes: used_percent * 10, free_bytes: 1000 - used_percent * 10,
      used_percent, inode_used_percent: 10,
    }]);

    expect(snapshot.findings.filter((finding) => finding.code === 'FILESYSTEM_PRESSURE')).toHaveLength(findingCount);
  });

  it('describes failed services with concise operator-facing copy', async () => {
    const sent: Buffer[] = [];
    const manager = new SnapshotManager(
      new MockHostAdapter(),
      (payload) => { sent.push(payload); return true; },
      createLogger('error'),
      new Observability(),
    );

    manager.start(60_000, 64 * 1024);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    manager.stop();

    const notification = JSON.parse(gunzipSync(sent[0]).toString('utf8')) as {
      params: { data: { findings: Array<Record<string, unknown>> } };
    };
    expect(notification.params.data.findings).toContainEqual(expect.objectContaining({
      code: 'SERVICE_FAILED',
      summary: 'Service ssh.service failed',
      unit: 'ssh.service',
    }));
  });

  it('coalesces manual requests while collection is active', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    class DeferredHost extends MockHostAdapter {
      calls = 0;
      override async getHostSummary() {
        this.calls++;
        if (this.calls === 1) await blocked;
        return super.getHostSummary();
      }
    }
    const host = new DeferredHost();
    const sent: Buffer[] = [];
    const metrics = new Observability();
    const manager = new SnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), metrics);
    manager.start(60_000, 64 * 1024);
    await Promise.resolve();
    manager.trigger(); manager.trigger();
    release();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    manager.stop();
    expect(host.calls).toBe(2);
    expect(metrics.snapshot().skipped_snapshots).toBe(2);
  });
});
