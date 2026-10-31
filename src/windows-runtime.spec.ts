import { describe, expect, it } from 'vitest';
import { createWindowsHost } from './windows-runtime.js';
import { WindowsMockHost } from './windows/mock.js';
import { isFailedService, buildWindowsSnapshot } from './windows/snapshot.js';
import { registerWindowsTools } from './windows/tools.js';
import { toolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';

const service = { name: '示例;$(x)', display_name: 'Synthetic service', state: 'Stopped', start_mode: 'Manual', process_id: 0, exit_code: 1067, service_specific_exit_code: null };
describe('isolated Windows runtime', () => {
  it('selects synthetic Windows data independently of the host and rejects live on another OS', async () => {
    const host = createWindowsHost({ collectorMode: 'mock', allowedLogChannels: [] });
    expect(await host.getHostSummary()).toMatchObject({ os_family: 'windows', hostname: 'synthetic-windows' });
    if (process.platform !== 'win32') expect(() => createWindowsHost({ collectorMode: 'live', allowedLogChannels: [] })).toThrow('Windows');
  });
  it('requires affirmative native stopped-service failure evidence', () => {
    expect(isFailedService(service)).toBe(true);
    for (const exit_code of [0, 1077, null]) expect(isFailedService({ ...service, exit_code })).toBe(false);
    expect(isFailedService({ ...service, start_mode: 'Disabled' })).toBe(false);
    expect(isFailedService({ ...service, start_mode: null })).toBe(false);
    expect(isFailedService({ ...service, state: 'Running' })).toBe(false);
  });
  it('uses a separate snapshot version and keeps unavailable metrics absent', async () => {
    const snapshot = await buildWindowsSnapshot(new WindowsMockHost([]));
    expect(snapshot.schema_version).toBe('acornops.agentv-windows-snapshot.v1');
    expect(snapshot.host_summary).not.toHaveProperty('load');
    expect(snapshot.host_summary).not.toHaveProperty('swap');
    expect(snapshot.finding_coverage.services).toBe('complete');
    expect(snapshot.degraded_services.map((item) => item.name)).toEqual(['SyntheticFailed']);
  });
  it('never registers or dispatches restart even under hostile write policy', async () => {
    registerWindowsTools(new WindowsMockHost(['Application']));
    expect(toolRegistry.getAll()).toHaveLength(8);
    expect(toolRegistry.get('get_service')!.schema.safeParse({ unit: 'ssh.service' }).success).toBe(false);
    expect(toolRegistry.get('get_service')!.schema.safeParse({ name: service.name }).success).toBe(true);
    expect(toolRegistry.get('query_logs')!.schema.safeParse({ channel: 'Security' }).success).toBe(false);
    const executor = new ToolExecutor({ localWriteEnabled: () => true }); executor.setActiveGeneration(1);
    await expect(executor.execute({ name: 'restart_service', arguments: {}, requestId: 1, policy: { allowedTools: new Set(['restart_service']), writeEnabled: true, generation: 1, targetId: 'vm' } })).rejects.toThrow('not allowed');
  });
});

describe('conservative Windows evidence', () => {
  it('cannot recover services from partial enumeration or unknown native evidence', async () => {
    for (const mode of ['partial', 'unknown', 'denied'] as const) {
      const host = new WindowsMockHost([]);
      host.listServices = async () => ({ items: mode === 'unknown' ? [{ ...service, exit_code: null }] : [], original_count: 0, omitted_count: mode === 'partial' ? 1 : 0, health: { collector: 'windows_services', status: mode === 'denied' ? 'permission_denied' : mode === 'partial' ? 'partial' : 'ok', duration_ms: 0 } });
      expect((await buildWindowsSnapshot(host)).finding_coverage.services).toBe('incomplete');
    }
  });
});
