import type { HostCollector, HostSnapshot } from './types.js';

/** Build a deterministic mock host snapshot for local development and tests. */
export function mockSnapshot(): HostSnapshot {
  const now = new Date().toISOString();
  return {
    host: {
      hostname: 'mock-linux-vm',
      kernel: '6.8.0-acornops',
      distro: 'Ubuntu 24.04 LTS',
      uptimeSeconds: 86400,
      architecture: 'x64',
      osFamily: 'linux',
      serviceManager: 'systemd'
    },
    metrics: {
      loadAverage: [0.12, 0.18, 0.22],
      cpuUsagePercent: 7.5,
      memory: { totalBytes: 4_294_967_296, freeBytes: 2_147_483_648, usedBytes: 2_147_483_648 },
      swap: { totalBytes: 1_073_741_824, freeBytes: 805_306_368, usedBytes: 268_435_456 },
      disks: [{ mount: '/', filesystem: 'overlay', usedBytes: 8_589_934_592, totalBytes: 34_359_738_368, inodeUsedPercent: 12 }],
      network: [{ name: 'eth0', address: '172.18.0.10', state: 'up' }]
    },
    services: [
      { name: 'acornops-vm-agent.service', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'AcornOps VM Agent' },
      { name: 'ssh.service', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'OpenSSH server' }
    ],
    processes: [
      { pid: 1, name: 'node', user: 'acornops-agent', cpuPercent: 1.2, memoryPercent: 3.1, command: 'node dist/index.js' },
      { pid: 22, name: 'sshd', user: 'root', cpuPercent: 0.1, memoryPercent: 0.4, command: 'sshd: listener' }
    ],
    listeners: [
      { protocol: 'tcp', localAddress: '0.0.0.0', port: 22, process: 'sshd' }
    ],
    logs: [
      { source: 'journald', timestamp: now, unit: 'acornops-vm-agent.service', severity: 'info', message: 'snapshot uploaded' },
      { source: 'syslog', timestamp: now, severity: 'info', message: 'mock Linux/systemd VM healthy' }
    ],
    findings: [
      { id: 'mock-vm-healthy', severity: 'info', title: 'VM telemetry is healthy', message: 'No pressure or failed service findings were detected.', reason: 'healthy', objectKind: 'host', objectName: 'mock-linux-vm', timestamp: now }
    ]
  };
}

export class MockHostCollector implements HostCollector {
  /** Return a deterministic mock host snapshot. */
  async collectSnapshot(): Promise<HostSnapshot> {
    return mockSnapshot();
  }

  /** Return bounded mock logs matching optional source and query filters. */
  async getLogs(input: { source?: string; query?: string; tailLines: number; limitBytes: number }): Promise<{ entries: HostSnapshot['logs'] }> {
    const logs = mockSnapshot().logs
      .filter((entry) => !input.source || entry.source === input.source)
      .filter((entry) => !input.query || entry.message.toLowerCase().includes(input.query.toLowerCase()))
      .slice(-input.tailLines);
    let usedBytes = 0;
    const bounded = [];
    for (const entry of logs) {
      usedBytes += Buffer.byteLength(entry.message);
      if (usedBytes > input.limitBytes) break;
      bounded.push(entry);
    }
    return { entries: bounded };
  }
}
