import { describe, expect, it } from 'vitest';
import { collectServiceEvidence } from '../scripts/windows-tests/collector-evidence.mjs';

function host(failing: string, error: unknown) {
  const result = { health: { status: 'ok' }, items: [{}] };
  return {
    getHostSummary: async () => { if (failing === 'host') throw error; return { os_family: 'windows', product_type: 3, build: '20348' }; },
    listFilesystems: async () => result, listProcesses: async () => result, listServices: async () => result, listListeners: async () => result,
    queryLogs: async () => { if (failing === 'logs') throw error; return { health: { status: 'ok' }, entries: [] }; },
    stop: async () => undefined,
  };
}

describe('owned native service collector evidence', () => {
  it('retains operation, allowlisted failure details and original call timeline without host data', async () => {
    const error = { toolCode: 'TOOL_TIMEOUT', message: 'secret error', data: { collector: 'host', stage: 'cpu_query_started', elapsed_ms: 8001, stdout_bytes: 0, stderr_bytes: 80, secret: 'credential' } };
    const result = await collectServiceEvidence({
      allowedScripts: ['host'], allowedStages: ['cpu_query_started'], clock: () => 100,
      createHost: (observe: (event: unknown) => void) => {
        const fixture = host('host', error);
        fixture.getHostSummary = async () => {
          observe({ event: 'timer_fired', collector: 'host', at_ms: 8000, stage: 'cpu_query_started', stdout_bytes: 0, raw: 'private stdout' });
          throw error;
        };
        return fixture;
      },
    });
    expect(result.failure).toMatchObject({ operation: 'host', code: 'TOOL_TIMEOUT', collector: 'host', stage: 'cpu_query_started', runner_elapsed_ms: 8001 });
    expect(result.operations[0].events).toEqual([{ event: 'timer_fired', collector: 'host', at_ms: 8000, stage: 'cpu_query_started', stdout_bytes: 0 }]);
    expect(JSON.stringify(result)).not.toMatch(/secret|credential|private stdout/);
  });
  it('identifies a later denied operation, keeps earlier summaries and bounds event retention', async () => {
    const result = await collectServiceEvidence({
      allowedScripts: ['events'], allowedStages: ['script_started'],
      createHost: (observe: (event: unknown) => void) => {
        const fixture = host('logs', { toolCode: 'PERMISSION_DENIED', data: { collector: 'events', stage: 'untrusted-stage', elapsed_ms: Infinity } });
        const fail = fixture.queryLogs;
        fixture.queryLogs = async () => {
          for (let i = 0; i < 100; i++) observe({ event: 'stage', collector: 'events', stage: 'script_started', at_ms: i });
          observe({ event: 'raw-stderr', collector: 'events', at_ms: 2 });
          return fail();
        };
        return fixture;
      },
    });
    expect(result.failure).toMatchObject({ operation: 'application', code: 'PERMISSION_DENIED', collector: 'events' });
    expect(result.failure).not.toHaveProperty('stage'); expect(result.failure).not.toHaveProperty('runner_elapsed_ms');
    expect(result.collections.services).toEqual({ status: 'ok', count: 1 });
    expect(result.operations.at(-1).events).toHaveLength(64);
    expect(JSON.stringify(result)).not.toMatch(/untrusted-stage|raw-stderr/);
  });
  it('preserves the original failure if fixture shutdown also fails', async () => {
    const result = await collectServiceEvidence({ allowedScripts: [], allowedStages: [], createHost: () => {
      const fixture = host('host', { toolCode: 'HOST_UNAVAILABLE' }); fixture.stop = async () => { throw new Error('private cleanup'); }; return fixture;
    } });
    expect(result.failure).toMatchObject({ code: 'HOST_UNAVAILABLE', operation: 'host' });
    expect(result.cleanup_failure).toBe('FIXTURE_STOP_FAILED');
    expect(JSON.stringify(result)).not.toContain('private cleanup');
  });
});
