import { ToolExecutionError } from '../tools/errors.js';
import type { LogChannel, WindowsHost, WindowsHostSummary, WindowsList, WindowsLogsInput, WindowsQuery, WindowsService } from './types.js';

/** Deterministic synthetic fixtures, never captured native qualification evidence. */
export class WindowsMockHost implements WindowsHost {
  constructor(private readonly channels: readonly LogChannel[]) {}
  async getHostSummary(): Promise<WindowsHostSummary> { return { os_family: 'windows', hostname: 'synthetic-windows', version: '10.0.20348', build: '20348', product_type: 3, architecture: '64-bit', system_volume: 'C:', uptime_seconds: 3600, cpu: { usage_percent: 12, sampled_ms: 0 }, memory: { total_bytes: 8e9, available_bytes: 6e9, used_bytes: 2e9, used_percent: 25 }, collector_health: [{ collector: 'windows_host', status: 'ok', duration_ms: 0 }] }; }
  private list<T>(items: T[], limit: number, collector: string): WindowsList<T> { return { items: items.slice(0, limit), original_count: items.length, omitted_count: Math.max(0, items.length - limit), health: { collector, status: 'ok', duration_ms: 0 } }; }
  async listFilesystems(input: WindowsQuery) { return this.list([{ volume: 'C:', filesystem: 'NTFS', total_bytes: 100e9, free_bytes: 60e9, used_bytes: 40e9, used_percent: 40 }], input.limit, 'windows_volumes'); }
  async listProcesses(input: WindowsQuery) { return this.list([{ pid: 101, ppid: 4, name: 'synthetic.exe', cpu_percent: null, memory_bytes: 1e6, start_time: null }], input.limit, 'windows_processes'); }
  async getProcess(pid: number) { const item = (await this.listProcesses({ limit: 100 })).items.find((item) => item.pid === pid); if (!item) throw new ToolExecutionError('RESOURCE_NOT_FOUND', 'Process not found'); return item; }
  async listServices(input: WindowsQuery & { state?: string }) {
    const items: WindowsService[] = [{ name: 'SyntheticRunning', display_name: 'Synthetic Running', state: 'Running', start_mode: 'Auto', process_id: 101, exit_code: 0, service_specific_exit_code: null }, { name: 'SyntheticFailed', display_name: 'Synthetic Failed', state: 'Stopped', start_mode: 'Manual', process_id: 0, exit_code: 1067, service_specific_exit_code: null }, { name: 'SyntheticNeverStarted', display_name: 'Synthetic Never Started', state: 'Stopped', start_mode: 'Manual', process_id: 0, exit_code: 1077, service_specific_exit_code: null }];
    return this.list(items.filter((item) => (!input.query || item.name.includes(input.query)) && (!input.state || input.state === 'all' || item.state === input.state)), input.limit, 'windows_services');
  }
  async getService(name: string) { const item = (await this.listServices({ limit: 100 })).items.find((item) => item.name === name); if (!item) throw new ToolExecutionError('RESOURCE_NOT_FOUND', 'Service not found'); return item; }
  async listListeners(input: WindowsQuery) { return this.list([{ protocol: 'tcp' as const, address: '127.0.0.1', port: 8080, pid: 101, ownership_status: 'available' as const }], input.limit, 'windows_listeners'); }
  async queryLogs(input: WindowsLogsInput) { if (!this.channels.includes(input.channel)) throw new ToolExecutionError('PERMISSION_DENIED', 'Log channel is not locally allowed'); return { entries: [], returned_count: 0, original_count: 0, byte_count: 2, truncated: false, health: { collector: 'windows_events', status: 'ok' as const, duration_ms: 0 } }; }
  async stop(): Promise<void> {}
}
