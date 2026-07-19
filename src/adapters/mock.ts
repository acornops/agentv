import { ToolExecutionError } from '../tools/errors.js';
import type { HostAdapter, ProcessSummary, ServiceDetail } from './types.js';

const health = (collector: string) => ({ collector, status: 'ok' as const, duration_ms: 1 });
const process: ProcessSummary = { pid: 1, ppid: 0, user: 'root', state: 'S', name: 'systemd', cpu_percent: 0.1, memory_bytes: 16_777_216, memory_percent: 0.1, start_time: '2026-01-01T00:00:00.000Z', executable: '/usr/lib/systemd/systemd', command_line: '/sbin/init' };
const service: ServiceDetail = { unit: 'ssh.service', description: 'OpenSSH server', load_state: 'loaded', active_state: 'active', sub_state: 'running', unit_file_state: 'enabled', main_pid: 100, result: 'success', exec_main_status: 0, restart_count: 0, invocation_id: 'mock-invocation', fragment_path: '/usr/lib/systemd/system/ssh.service', active_enter_timestamp: 'Thu 2026-01-01 00:00:00 UTC', inactive_enter_timestamp: null, restart_preconditions: { active_state: 'active', sub_state: 'running', invocation_id: 'mock-invocation' } };

/** Deterministic adapter for local contract and transport testing. */
export class MockHostAdapter implements HostAdapter {
  async getHostSummary() { return { hostname: 'agentv-mock', distro: { id: 'ubuntu', version: '24.04', pretty_name: 'Ubuntu 24.04 LTS' }, kernel: '6.8.0', architecture: 'x64', boot_id: '00000000-0000-0000-0000-000000000001', uptime_seconds: 3600, load: { one: 0.1, five: 0.2, fifteen: 0.3 }, cpu: { usage_percent: 5, sampled_ms: 100 }, memory: { total_bytes: 1024, available_bytes: 512, used_bytes: 512, used_percent: 50 }, swap: { total_bytes: 0, free_bytes: 0, used_bytes: 0, used_percent: 0 }, pressure_available: true, collector_health: [health('host_facts')] }; }
  async listFilesystems(input: Parameters<HostAdapter['listFilesystems']>[0]) { const items = [{ filesystem: '/dev/vda1', mount: '/', type: 'ext4', total_bytes: 1000, used_bytes: 500, free_bytes: 500, used_percent: 50, inode_used_percent: 10, read_only: false }].filter((item) => !input.mount || item.mount === input.mount); return { items, original_count: items.length, omitted_count: 0, truncated: false, health: health('filesystems') }; }
  async listProcesses() { return { items: [process], original_count: 1, omitted_count: 0, health: health('procfs') }; }
  async getProcess(pid: number) { if (pid !== 1) throw new ToolExecutionError('RESOURCE_NOT_FOUND', `Process ${pid} was not found`); return process; }
  async listServices() { return { items: [service], original_count: 1, omitted_count: 0, health: health('systemd') }; }
  async getService(unit: string) { if (unit !== service.unit) throw new ToolExecutionError('RESOURCE_NOT_FOUND', `Service ${unit} was not found`); return service; }
  async queryLogs(input: Parameters<HostAdapter['queryLogs']>[0]) {
    const entry = {
      cursor: 's=mock;i=1', timestamp: '2026-01-01T00:00:00.000Z', priority: 6,
      unit: input.unit || 'acornops-agentv.service', pid: 100, identifier: 'agentv-mock',
      message: 'AgentV mock journal entry'
    };
    return { entries: [entry], next_cursor: entry.cursor, returned_count: 1, original_count: 1, byte_count: Buffer.byteLength(JSON.stringify(entry)), truncated: false, health: health('journald') };
  }
  async listListeners() { return { items: [{ protocol: 'tcp' as const, address: '0.0.0.0', port: 22, pid: 100, process: 'sshd', ownership_status: 'available' as const }], original_count: 1, omitted_count: 0, partial: false, health: health('sockets') }; }
}
