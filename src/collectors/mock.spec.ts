import { describe, expect, it } from 'vitest';
import { MockHostCollector, mockSnapshot } from './mock.js';

describe('MockHostCollector', () => {
  it('returns deterministic Linux/systemd host snapshots for local development', async () => {
    const snapshot = await new MockHostCollector().collectSnapshot();

    expect(snapshot).toMatchObject({
      host: {
        hostname: 'mock-linux-vm',
        osFamily: 'linux',
        serviceManager: 'systemd'
      },
      services: expect.arrayContaining([
        expect.objectContaining({ name: 'acornops-vm-agent.service', activeState: 'active' })
      ]),
      listeners: [{ protocol: 'tcp', localAddress: '0.0.0.0', port: 22, process: 'sshd' }]
    });
  });

  it('filters mock logs by source, query, tail, and byte limit', async () => {
    const collector = new MockHostCollector();

    await expect(collector.getLogs({
      source: 'journald',
      query: 'snapshot',
      tailLines: 10,
      limitBytes: 10_000
    })).resolves.toEqual({
      entries: [expect.objectContaining({ source: 'journald', message: 'snapshot uploaded' })]
    });

    await expect(collector.getLogs({
      source: 'syslog',
      tailLines: 10,
      limitBytes: 1
    })).resolves.toEqual({ entries: [] });

    await expect(collector.getLogs({
      tailLines: 1,
      limitBytes: 10_000
    })).resolves.toEqual({
      entries: [expect.objectContaining({ source: 'syslog' })]
    });
  });

  it('creates fresh timestamped snapshots for each call', () => {
    const first = mockSnapshot();
    const second = mockSnapshot();

    expect(first).not.toBe(second);
    expect(first.logs[0]?.timestamp).toEqual(expect.any(String));
    expect(second.findings[0]?.timestamp).toEqual(expect.any(String));
  });
});
