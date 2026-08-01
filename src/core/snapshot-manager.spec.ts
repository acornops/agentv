import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MockHostAdapter } from '../adapters/mock.js';
import { createLogger } from '../logger.js';
import { Observability } from '../observability.js';
import { SnapshotManager } from './snapshot-manager.js';

describe('SnapshotManager', () => {
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
