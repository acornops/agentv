import { describe, expect, it, vi } from 'vitest';
import { MockHostCollector, mockSnapshot } from '../collectors/mock.js';
import type { HostCollector, HostSnapshot } from '../collectors/types.js';
import { boundSnapshot, callTool, toolDefinitions } from './index.js';

function collectorFor(snapshot: HostSnapshot): HostCollector {
  return {
    collectSnapshot: vi.fn(async () => structuredClone(snapshot)),
    getLogs: vi.fn(async () => ({ entries: snapshot.logs }))
  };
}

function expandedSnapshot(): HostSnapshot {
  const snapshot = mockSnapshot();
  snapshot.processes = Array.from({ length: 250 }, (_, index) => ({
    pid: index + 1,
    name: `proc-${index + 1}`,
    user: 'app',
    cpuPercent: index,
    memoryPercent: index / 10,
    command: `node worker-${index + 1}`
  }));
  snapshot.services = Array.from({ length: 600 }, (_, index) => ({
    name: `service-${index + 1}.service`,
    loadState: 'loaded',
    activeState: index === 1 ? 'failed' : 'active',
    subState: index === 1 ? 'failed' : 'running',
    description: `Service ${index + 1}`
  }));
  snapshot.listeners = [
    { protocol: 'tcp', localAddress: '0.0.0.0', port: 22, process: 'sshd' },
    { protocol: 'tcp', localAddress: '127.0.0.1', port: 8080, process: 'api' }
  ];
  snapshot.logs = Array.from({ length: 20 }, (_, index) => ({
    source: index % 2 === 0 ? 'journald' : 'syslog',
    timestamp: '2026-06-01T00:00:00.000Z',
    severity: 'info',
    message: `log-${index + 1} ${'x'.repeat(200)}`
  }));
  return snapshot;
}

describe('VM read-only tools', () => {
  it('advertises the expected read-only VM diagnostic tools', () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      'get_host_summary',
      'list_processes',
      'get_process',
      'list_services',
      'get_service_status',
      'get_logs',
      'search_logs',
      'check_port',
      'list_listening_ports'
    ]);
    expect(toolDefinitions.every((tool) => tool.capability === 'read')).toBe(true);
    expect(toolDefinitions.every((tool) => tool.version === 'v1')).toBe(true);
    expect(toolDefinitions.every((tool) => tool.timeout_ms === 10000)).toBe(true);
  });

  it('returns mock host summary and process details', async () => {
    const collector = new MockHostCollector();
    await expect(callTool(collector, 'get_host_summary', {})).resolves.toMatchObject({
      host: { osFamily: 'linux', serviceManager: 'systemd' }
    });
    await expect(callTool(collector, 'get_process', { pid: 1 })).resolves.toMatchObject({
      process: { pid: 1 }
    });
  });

  it('applies result limits and lookup semantics for snapshot-backed tools', async () => {
    const snapshot = expandedSnapshot();
    const collector = collectorFor(snapshot);

    await expect(callTool(collector, 'list_processes', { limit: 999 })).resolves.toMatchObject({
      processes: expect.arrayContaining([expect.objectContaining({ pid: 1 })])
    });
    expect((await callTool(collector, 'list_processes', { limit: 999 }) as { processes: unknown[] }).processes).toHaveLength(200);
    expect((await callTool(collector, 'list_processes', { limit: -5 }) as { processes: unknown[] }).processes).toHaveLength(1);
    expect((await callTool(collector, 'list_processes', { limit: 'bad' }) as { processes: unknown[] }).processes).toHaveLength(50);
    expect((await callTool(collector, 'list_services', { limit: 999 }) as { services: unknown[] }).services).toHaveLength(500);
    await expect(callTool(collector, 'get_service_status', { name: 'service-2.service' })).resolves.toMatchObject({
      service: { name: 'service-2.service', activeState: 'failed' }
    });
    await expect(callTool(collector, 'get_service_status', { name: 'missing.service' })).resolves.toEqual({ service: null });
    await expect(callTool(collector, 'check_port', { port: '8080' })).resolves.toEqual({
      listener: { protocol: 'tcp', localAddress: '127.0.0.1', port: 8080, process: 'api' }
    });
    await expect(callTool(collector, 'check_port', { port: 1234 })).resolves.toEqual({ listener: null });
    await expect(callTool(collector, 'list_listening_ports', {})).resolves.toEqual({
      listeners: snapshot.listeners
    });
    await expect(callTool(collector, 'get_process', { pid: 999999 })).resolves.toEqual({ process: null });
  });

  it('normalizes log tool arguments without collecting a full snapshot', async () => {
    const collector: HostCollector = {
      collectSnapshot: vi.fn(async () => {
        throw new Error('collectSnapshot should not be called');
      }),
      getLogs: vi.fn(async () => ({ entries: [] }))
    };

    await callTool(collector, 'get_logs', {
      source: 'syslog',
      tail_lines: '6000',
      limit_bytes: '2097152'
    });
    expect(collector.getLogs).toHaveBeenCalledWith({
      source: 'syslog',
      tailLines: 5000,
      limitBytes: 1048576
    });

    await callTool(collector, 'search_logs', {
      source: 42,
      query: 'OOM',
      tailLines: 0,
      limitBytes: 'bad'
    });
    expect(collector.getLogs).toHaveBeenLastCalledWith({
      source: undefined,
      query: 'OOM',
      tailLines: 1,
      limitBytes: 262144
    });
    expect(collector.collectSnapshot).not.toHaveBeenCalled();
  });

  it('rejects unknown tool names', async () => {
    await expect(callTool(new MockHostCollector(), 'restart_service', {})).rejects.toThrow('Unknown tool restart_service');
  });

  it('bounds snapshots by trimming logs and then processes without mutating the original', async () => {
    const snapshot = expandedSnapshot();
    const tenProcessSnapshot = structuredClone(snapshot);
    tenProcessSnapshot.logs = [];
    tenProcessSnapshot.processes = tenProcessSnapshot.processes.slice(0, 10);
    const maxBytes = Buffer.byteLength(JSON.stringify(tenProcessSnapshot)) + 100;

    const bounded = boundSnapshot(snapshot, maxBytes);

    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(maxBytes);
    expect(bounded.logs.length).toBeLessThan(snapshot.logs.length);
    expect(bounded.processes).toHaveLength(10);
    expect(snapshot.logs).toHaveLength(20);
    expect(snapshot.processes).toHaveLength(250);
  });

  it('keeps the minimum process floor even if the requested byte budget is smaller', () => {
    const snapshot = expandedSnapshot();
    snapshot.logs = [];

    const bounded = boundSnapshot(snapshot, 1);

    expect(bounded.logs).toEqual([]);
    expect(bounded.processes).toHaveLength(10);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeGreaterThan(1);
  });
});
