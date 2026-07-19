export type CollectorStatus = 'ok' | 'partial' | 'unavailable' | 'permission_denied' | 'timed_out' | 'unsupported';

export interface CollectorHealth {
  collector: string;
  status: CollectorStatus;
  message?: string;
  duration_ms: number;
}

export interface HostSummary {
  hostname: string;
  distro: { id: string; version: string; pretty_name: string };
  kernel: string;
  architecture: string;
  boot_id: string;
  uptime_seconds: number;
  load: { one: number; five: number; fifteen: number };
  cpu: { usage_percent: number | null; sampled_ms: number };
  memory: { total_bytes: number; available_bytes: number; used_bytes: number; used_percent: number };
  swap: { total_bytes: number; free_bytes: number; used_bytes: number; used_percent: number };
  pressure_available: boolean;
  collector_health: CollectorHealth[];
}

export interface FilesystemSummary {
  filesystem: string; mount: string; type: string;
  total_bytes: number; used_bytes: number; free_bytes: number;
  used_percent: number; inode_used_percent: number | null; read_only: boolean;
}

export interface ProcessSummary {
  pid: number; ppid: number; user: string; state: string; name: string;
  cpu_percent: number; memory_bytes: number; memory_percent: number;
  start_time: string | null; executable: string | null; command_line: string;
}

export interface ServiceSummary {
  unit: string; description: string; load_state: string; active_state: string; sub_state: string;
}

export interface ServiceDetail extends ServiceSummary {
  unit_file_state: string | null; main_pid: number | null; result: string | null;
  exec_main_status: number | null; restart_count: number; invocation_id: string | null;
  fragment_path: string | null; active_enter_timestamp: string | null; inactive_enter_timestamp: string | null;
  restart_preconditions: { active_state: string; sub_state: string; invocation_id?: string };
}

export interface LogEntry {
  cursor: string | null; timestamp: string; priority: number | null;
  unit: string | null; pid: number | null; identifier: string | null; message: string;
}

export interface ListenerSummary {
  protocol: 'tcp' | 'udp'; address: string; port: number;
  pid: number | null; process: string | null; ownership_status: 'available' | 'permission_denied' | 'unavailable';
}

export interface HostAdapter {
  getHostSummary(signal?: AbortSignal): Promise<HostSummary>;
  listFilesystems(input: { mount?: string; include_pseudo: boolean; limit: number }, signal?: AbortSignal): Promise<{ items: FilesystemSummary[]; original_count: number; omitted_count: number; truncated: boolean; health: CollectorHealth }>;
  listProcesses(input: { sort_by: string; order: string; user?: string; query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ProcessSummary[]; original_count: number; omitted_count: number; health: CollectorHealth }>;
  getProcess(pid: number, signal?: AbortSignal): Promise<ProcessSummary>;
  listServices(input: { state: string; query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ServiceSummary[]; original_count: number; omitted_count: number; health: CollectorHealth }>;
  getService(unit: string, signal?: AbortSignal): Promise<ServiceDetail>;
  queryLogs(input: { unit?: string; priority?: number; since?: string; until?: string; query?: string; cursor?: string; limit: number; byte_limit: number }, signal?: AbortSignal): Promise<{ entries: LogEntry[]; next_cursor: string | null; returned_count: number; original_count: number; byte_count: number; truncated: boolean; health: CollectorHealth }>;
  listListeners(input: { protocol?: 'tcp' | 'udp'; port?: number; address?: string; process_query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ListenerSummary[]; original_count: number; omitted_count: number; partial: boolean; health: CollectorHealth }>;
}
