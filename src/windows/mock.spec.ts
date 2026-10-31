import { describe, expect, it } from 'vitest';
import { WindowsMockHost } from './mock.js';

describe('synthetic Windows filters', () => {
  const host = new WindowsMockHost([]);
  it('matches failed-service evidence without classifying never-started services as failed', async () => {
    const failed = await host.listServices({ limit: 10, state: 'failed' });
    expect(failed.items.map((item) => item.name)).toEqual(['SyntheticFailed']);
    expect(failed.original_count).toBe(1);
    expect((await host.listServices({ limit: 10, state: 'Stopped' })).items.map((item) => item.name)).toEqual(['SyntheticFailed', 'SyntheticNeverStarted']);
  });
  it('matches service names and display names case-insensitively before limiting', async () => {
    expect((await host.listServices({ limit: 1, query: 'SYNTHETIC FAILED' })).items.map((item) => item.name)).toEqual(['SyntheticFailed']);
    const result = await host.listServices({ limit: 1, query: 'synthetic' });
    expect(result.original_count).toBe(3); expect(result.omitted_count).toBe(2);
  });
  it('filters process names with literal case-insensitive queries', async () => {
    expect((await host.listProcesses({ limit: 10, query: 'SYNTHETIC.EXE' })).items.map((item) => item.pid)).toEqual([101]);
    expect((await host.listProcesses({ limit: 10, query: 'missing' })).items).toEqual([]);
    expect((await host.listProcesses({ limit: 10, query: '.*' })).items).toEqual([]);
  });
  it('filters listener protocol, port and literal address before reporting counts', async () => {
    expect((await host.listListeners({ limit: 10, protocol: 'udp' })).items).toEqual([]);
    expect((await host.listListeners({ limit: 10, port: 80 })).items).toEqual([]);
    expect((await host.listListeners({ limit: 10, query: 'missing' })).original_count).toBe(0);
    const found = await host.listListeners({ limit: 10, protocol: 'tcp', port: 8080, query: '127.0' });
    expect(found.items.map((item) => item.port)).toEqual([8080]);
  });
});
