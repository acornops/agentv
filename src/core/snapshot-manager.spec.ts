import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MockHostAdapter } from '../adapters/mock.js';
import type { FilesystemSummary } from '../adapters/types.js';
import { createLogger } from '../logger.js';
import { Observability } from '../observability.js';
import { SnapshotManager } from './snapshot-manager.js';

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
