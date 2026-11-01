import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.js';
import { Observability } from '../observability.js';
import { WindowsMockHost } from './mock.js';
import { WindowsSnapshotManager } from './snapshot.js';

const HOUR = 3_600_000;

/** Hold only the external host read; snapshot construction and sending stay real. */
class DeferredHost extends WindowsMockHost {
  readonly reads: Array<{ signal?: AbortSignal; release: () => void; fail: () => void }> = [];
  active = 0;
  maxActive = 0;

  override async getHostSummary(signal?: AbortSignal) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    const index = this.reads.length;
    const gate = new Promise<void>((resolve, reject) => {
      this.reads.push({ signal, release: resolve, fail: () => reject(new Error('Host unavailable')) });
    });
    try {
      await gate;
      return { ...await super.getHostSummary(), hostname: `generation-${index + 1}` };
    } finally {
      this.active--;
    }
  }
}

function setup() {
  const host = new DeferredHost([]);
  const sent: Buffer[] = [];
  const metrics = new Observability();
  const manager = new WindowsSnapshotManager(host, (payload) => { sent.push(payload); return true; }, createLogger('error'), metrics);
  return { host, sent, metrics, manager };
}

function hostname(payload: Buffer): string {
  return JSON.parse(gunzipSync(payload).toString('utf8')).params.data.host_summary.hostname;
}

describe('WindowsSnapshotManager generations', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends exactly one fresh startup snapshot after cancelled work drains without waiting an hour', async () => {
    const { host, sent, manager } = setup();
    try {
      manager.start(HOUR, 16_384);
      manager.stop();
      manager.start(HOUR, 16_384);
      expect(host.reads).toHaveLength(1);
      expect(host.reads[0].signal?.aborted).toBe(true);

      host.reads[0].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(0);
      expect(host.reads).toHaveLength(2);
      expect(host.reads[1].signal?.aborted).toBe(false);
      host.reads[1].release();
      await vi.advanceTimersByTimeAsync(0);

      expect(sent.map(hostname)).toEqual(['generation-2']);
      expect(host.maxActive).toBe(1);
      expect(host.reads).toHaveLength(2);
    } finally { manager.stop(); }
  });

  it('coalesces repeated starts to the newest budget and interval', async () => {
    const { host, sent, manager } = setup();
    try {
      manager.start(10, 1024);
      manager.start(HOUR, 1024);
      manager.start(2 * HOUR, 16_384);
      host.reads[0].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.reads).toHaveLength(2);
      host.reads[1].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map(hostname)).toEqual(['generation-2']);
      expect(gunzipSync(sent[0]).length).toBeGreaterThan(1024);
      expect(gunzipSync(sent[0]).length).toBeLessThanOrEqual(16_384);

      await vi.advanceTimersByTimeAsync(HOUR);
      expect(host.reads).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(HOUR);
      expect(host.reads).toHaveLength(3);
      host.reads[2].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map(hostname)).toEqual(['generation-2', 'generation-3']);
      expect(host.maxActive).toBe(1);
    } finally { manager.stop(); }
  });

  it('clears a pending startup when stopped before the old collection drains', async () => {
    const { host, sent, manager } = setup();
    manager.start(HOUR, 16_384);
    manager.start(HOUR, 16_384);
    manager.stop();
    host.reads[0].release();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(host.reads).toHaveLength(1);
    expect(sent).toHaveLength(0);
    expect(host.maxActive).toBe(1);
  });

  it('starts the pending generation after a cancelled collector fails', async () => {
    const { host, sent, manager } = setup();
    try {
      manager.start(HOUR, 16_384);
      manager.start(HOUR, 16_384);
      host.reads[0].fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(0);
      expect(host.reads).toHaveLength(2);
      host.reads[1].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map(hostname)).toEqual(['generation-2']);
      expect(host.maxActive).toBe(1);
    } finally { manager.stop(); }
  });

  it('skips interval work while busy without queuing another collection', async () => {
    const { host, sent, metrics, manager } = setup();
    try {
      manager.start(HOUR, 16_384);
      await vi.advanceTimersByTimeAsync(2 * HOUR);
      expect(host.reads).toHaveLength(1);
      expect(metrics.snapshot().skipped_snapshots).toBe(2);
      host.reads[0].release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map(hostname)).toEqual(['generation-1']);
      expect(host.reads).toHaveLength(1);
      expect(host.maxActive).toBe(1);
    } finally { manager.stop(); }
  });
});
