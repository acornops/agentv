import { describe, expect, it } from 'vitest';
import { MockHostAdapter } from './mock.js';

describe('MockHostAdapter', () => {
  it('provides normalized journald evidence for local cross-service smoke', async () => {
    const result = await new MockHostAdapter().queryLogs({
      unit: 'acornops-agentv.service', limit: 20, byte_limit: 1024
    });

    expect(result.returned_count).toBe(1);
    expect(result.entries[0]).toMatchObject({ unit: 'acornops-agentv.service', priority: 6 });
    expect(result.byte_count).toBeGreaterThan(0);
  });
});
