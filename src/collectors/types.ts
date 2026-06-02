export interface HostSnapshot {
  host: {
    hostname: string;
    kernel: string;
    distro: string;
    uptimeSeconds: number;
    architecture: string;
    osFamily: 'linux';
    serviceManager: 'systemd';
  };
  metrics: {
    loadAverage: number[];
    cpuUsagePercent: number | null;
    memory: { totalBytes: number; freeBytes: number; usedBytes: number };
    swap: { totalBytes: number; freeBytes: number; usedBytes: number };
    disks: Array<{ mount: string; filesystem: string; usedBytes: number; totalBytes: number; inodeUsedPercent: number | null }>;
    network: Array<{ name: string; address?: string; state?: string }>;
  };
  services: Array<{ name: string; loadState: string; activeState: string; subState: string; description?: string }>;
  processes: Array<{ pid: number; name: string; user?: string; cpuPercent?: number; memoryPercent?: number; command?: string }>;
  listeners: Array<{ protocol: string; localAddress: string; port: number; process?: string }>;
  logs: Array<{ source: string; timestamp: string; message: string; unit?: string; severity?: string }>;
  findings: Array<{ id: string; severity: 'critical' | 'warning' | 'info'; title: string; message: string; reason: string; objectKind?: string; objectName?: string; timestamp: string }>;
}

export interface HostCollector {
  collectSnapshot(): Promise<HostSnapshot>;
  getLogs(input: { source?: string; query?: string; tailLines: number; limitBytes: number }): Promise<{ entries: HostSnapshot['logs'] }>;
}
