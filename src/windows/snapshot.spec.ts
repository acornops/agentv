import { describe, expect, it } from 'vitest';
import { WindowsMockHost } from './mock.js';
import { buildWindowsSnapshot } from './snapshot.js';
import { healthSchema, hostSchema } from './types.js';

describe('serialized Windows snapshot health contract', () => {
  it('retains valid health objects in both the host summary and aggregate after redaction', async () => {
    const wire = JSON.parse(JSON.stringify(await buildWindowsSnapshot(new WindowsMockHost(['Application', 'System']))));
    expect(hostSchema.safeParse(wire.host_summary).success).toBe(true);
    expect(healthSchema.array().safeParse(wire.collector_health).success).toBe(true);
    expect(wire.collector_health).toContainEqual({ collector: 'windows_host', status: 'ok', duration_ms: 0 });
    expect(wire.collector_health).toHaveLength(5);
  });
  it('redacts copied health messages without treating repeated health evidence as a cycle', async () => {
    const host = new WindowsMockHost([]);
    const summary = await host.getHostSummary();
    summary.collector_health[0].message = 'password=synthetic-secret';
    host.getHostSummary = async () => summary;
    const wire = JSON.parse(JSON.stringify(await buildWindowsSnapshot(host)));
    expect(wire.host_summary.collector_health[0].message).toBe('password=<redacted>');
    expect(wire.collector_health[0]).toEqual({ collector: 'windows_host', status: 'ok', duration_ms: 0, message: 'password=<redacted>' });
    expect(JSON.stringify(wire)).not.toContain('synthetic-secret');
  });
});
