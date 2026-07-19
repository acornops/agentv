import { describe, expect, it, vi } from 'vitest';
import { HostFactsAdapter } from './host-facts.js';

const baseFiles: Record<string, string> = {
  '/etc/os-release': 'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n',
  '/proc/sys/kernel/random/boot_id': 'boot-id-1\n',
  '/proc/uptime': '1234.50 100.00\n',
  '/proc/loadavg': '1.25 2.50 3.75 1/100 42\n',
  '/proc/meminfo': 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 50 kB\n',
  '/proc/pressure/cpu': 'some avg10=0.00\n',
};

function dependencies(readText: (path: string) => Promise<string>) {
  return {
    readText,
    sleep: vi.fn(async () => undefined),
    hostname: () => 'vm-1',
    release: () => '6.8.0',
    architecture: () => 'x64',
  };
}

describe('HostFactsAdapter', () => {
  it('normalizes sampled Linux host, CPU, memory, and pressure facts', async () => {
    let statRead = 0;
    const adapter = new HostFactsAdapter(dependencies(async (path) => {
      if (path === '/proc/stat') return statRead++ === 0 ? 'cpu 100 0 100 800 0\n' : 'cpu 150 0 150 900 0\n';
      return baseFiles[path];
    }));
    const result = await adapter.collect();
    expect(result).toMatchObject({
      hostname: 'vm-1', distro: { id: 'ubuntu', version: '24.04', pretty_name: 'Ubuntu 24.04 LTS' },
      kernel: '6.8.0', architecture: 'x64', boot_id: 'boot-id-1', uptime_seconds: 1234,
      load: { one: 1.25, five: 2.5, fifteen: 3.75 }, cpu: { usage_percent: 50, sampled_ms: 100 },
      memory: { total_bytes: 1024000, available_bytes: 409600, used_bytes: 614400, used_percent: 60 },
      swap: { total_bytes: 204800, free_bytes: 51200, used_bytes: 153600, used_percent: 75 },
      pressure_available: true,
    });
    expect(result.collector_health).toEqual(expect.arrayContaining([
      expect.objectContaining({ collector: 'cpu', status: 'ok' }),
      expect.objectContaining({ collector: 'host_facts', status: 'ok' }),
    ]));
  });

  it('reports CPU and pressure degradation without converting the host result to empty success', async () => {
    const adapter = new HostFactsAdapter(dependencies(async (path) => {
      if (path === '/proc/stat' || path === '/proc/pressure/cpu') throw new Error('unavailable');
      return baseFiles[path];
    }));
    const result = await adapter.collect();
    expect(result.hostname).toBe('vm-1');
    expect(result.cpu.usage_percent).toBeNull();
    expect(result.pressure_available).toBe(false);
    expect(result.collector_health).toContainEqual(expect.objectContaining({ collector: 'cpu', status: 'partial' }));
  });
});
