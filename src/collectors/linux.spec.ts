import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, osMock } = vi.hoisted(() => {
  const execFileMock = vi.fn();
  const osMock = {
    hostname: vi.fn(() => 'vm-test-host'),
    release: vi.fn(() => '6.8.0-test'),
    uptime: vi.fn(() => 12345),
    arch: vi.fn(() => 'x64'),
    type: vi.fn(() => 'Linux'),
    totalmem: vi.fn(() => 8_589_934_592),
    freemem: vi.fn(() => 4_294_967_296),
    loadavg: vi.fn(() => [0.1, 0.2, 0.3]),
    networkInterfaces: vi.fn(() => ({
      lo: [{ address: '127.0.0.1', internal: true }],
      eth0: [{ address: '10.0.0.10', internal: false }]
    }))
  };
  return { execFileMock, osMock };
});

vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:os', () => ({ default: osMock }));

import { LinuxSystemdCollector, redactHostText } from './linux.js';

const systemctlOutput = [
  'acornops-vm-agent.service loaded active running AcornOps VM Agent',
  'ssh.service loaded active running OpenSSH server',
  'backup.service loaded failed failed Nightly backup',
  'stopped.service loaded inactive dead Stopped helper'
].join('\n');

const psOutput = [
  'PID USER %CPU %MEM COMMAND COMMAND',
  '1 root 4.2 1.1 node node dist/index.js --token process-secret password=swordfish',
  '22 syslog 0.5 0.2 rsyslogd rsyslogd -n',
  '33 app 0.1 0.3 worker worker --api-key=api-secret'
].join('\n');

const listenersOutput = [
  'Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
  'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=22,fd=3))',
  'udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("mdns",pid=44,fd=4))'
].join('\n');

const diskOutput = [
  'Filesystem 1B-blocks Used Available Use% Mounted on',
  '/dev/root 1000000 250000 750000 25% /',
  'tmpfs 500000 1000 499000 1% /run'
].join('\n');

const meminfoOutput = [
  'MemTotal:       8192000 kB',
  'MemAvailable:  4096000 kB',
  'SwapTotal:     1024000 kB',
  'SwapFree:       512000 kB'
].join('\n');

const journalOutput = [
  '2026-06-01T00:00:00+00:00 vm agent started token=journal-secret',
  '2026-06-01T00:00:01+00:00 vm Authorization: Bearer bearer-secret'
].join('\n');

const syslogOutput = [
  'Jun  1 00:00:02 vm app password=syslog-secret',
  'Jun  1 00:00:03 vm app healthy'
].join('\n');

function commandOutput(command: string, args: string[]): string {
  if (command === 'sh' && args[1]?.includes('/etc/os-release')) return 'Ubuntu 24.04 LTS';
  if (command === 'systemctl') return systemctlOutput;
  if (command === 'ps') return psOutput;
  if (command === 'sh' && args[1]?.includes('ss -lntup')) return listenersOutput;
  if (command === 'df') return diskOutput;
  if (command === 'cat') return meminfoOutput;
  if (command === 'journalctl') return journalOutput;
  if (command === 'tail' && args.includes('/var/log/syslog')) return syslogOutput;
  return '';
}

function installExecFileFixture() {
  execFileMock.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
    callback(null, { stdout: commandOutput(command, args) });
  });
}

describe('Linux/systemd collector hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installExecFileFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts sensitive command and log tokens', () => {
    const redacted = redactHostText(
      'cmd --token abc123 password=swordfish Authorization: Bearer secret-token agent_key=ak_live'
    );

    expect(redacted).toContain('--token <redacted>');
    expect(redacted).toContain('password=<redacted>');
    expect(redacted).toContain('Authorization: Bearer <redacted>');
    expect(redacted).toContain('agent_key=<redacted>');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('swordfish');
    expect(redacted).not.toContain('secret-token');
    expect(redacted).not.toContain('ak_live');
  });

  it('collects and normalizes a Linux/systemd host snapshot from command output', async () => {
    const snapshot = await new LinuxSystemdCollector(['journald', 'syslog']).collectSnapshot();

    expect(snapshot.host).toMatchObject({
      hostname: 'vm-test-host',
      kernel: '6.8.0-test',
      distro: 'Ubuntu 24.04 LTS',
      architecture: 'x64',
      osFamily: 'linux',
      serviceManager: 'systemd'
    });
    expect(snapshot.metrics.memory).toEqual({
      totalBytes: 8_388_608_000,
      freeBytes: 4_194_304_000,
      usedBytes: 4_194_304_000
    });
    expect(snapshot.metrics.swap).toEqual({
      totalBytes: 1_048_576_000,
      freeBytes: 524_288_000,
      usedBytes: 524_288_000
    });
    expect(snapshot.metrics.disks).toEqual([
      { filesystem: '/dev/root', totalBytes: 1_000_000, usedBytes: 250_000, mount: '/', inodeUsedPercent: null },
      { filesystem: 'tmpfs', totalBytes: 500_000, usedBytes: 1_000, mount: '/run', inodeUsedPercent: null }
    ]);
    expect(snapshot.metrics.network).toEqual([{ name: 'eth0', address: '10.0.0.10', state: 'up' }]);
    expect(snapshot.services).toContainEqual({
      name: 'backup.service',
      loadState: 'loaded',
      activeState: 'failed',
      subState: 'failed',
      description: 'Nightly backup'
    });
    expect(snapshot.processes[0]).toMatchObject({
      pid: 1,
      user: 'root',
      cpuPercent: 4.2,
      memoryPercent: 1.1,
      name: 'node'
    });
    expect(snapshot.processes[0]?.command).toContain('--token <redacted>');
    expect(snapshot.processes[0]?.command).toContain('password=<redacted>');
    expect(snapshot.processes[0]?.command).not.toContain('process-secret');
    expect(snapshot.listeners).toEqual([
      { protocol: 'tcp', localAddress: '0.0.0.0', port: 22, process: 'sshd' },
      { protocol: 'udp', localAddress: '0.0.0.0', port: 5353, process: 'mdns' }
    ]);
    expect(snapshot.logs.map((entry) => entry.source)).toEqual(['journald', 'journald', 'syslog', 'syslog']);
    expect(snapshot.logs.map((entry) => entry.message).join('\n')).not.toMatch(/journal-secret|bearer-secret|syslog-secret/);
    expect(snapshot.findings).toEqual([
      expect.objectContaining({ id: 'service-backup.service', severity: 'warning', objectKind: 'systemd_service' }),
      expect.objectContaining({ id: 'service-stopped.service', severity: 'info', objectKind: 'systemd_service' })
    ]);
  });

  it('honors configured log sources, query filtering, tail limits, and byte limits', async () => {
    const collector = new LinuxSystemdCollector(['syslog']);

    await expect(collector.getLogs({ source: 'journald', tailLines: 10, limitBytes: 10_000 })).resolves.toEqual({ entries: [] });

    const { entries } = await collector.getLogs({
      source: 'syslog',
      query: 'healthy',
      tailLines: 1,
      limitBytes: 10_000
    });

    expect(entries).toEqual([
      expect.objectContaining({ source: 'syslog', message: 'Jun  1 00:00:03 vm app healthy' })
    ]);

    const bounded = await collector.getLogs({
      source: 'syslog',
      tailLines: 50,
      limitBytes: Buffer.byteLength('Jun  1 00:00:02 vm app password=<redacted>')
    });

    expect(bounded.entries).toHaveLength(1);
    expect(bounded.entries[0]?.message).toContain('password=<redacted>');
  });

  it('collects journald logs and ignores unknown configured log sources', async () => {
    const collector = new LinuxSystemdCollector(['journald', 'custom']);

    const { entries } = await collector.getLogs({
      tailLines: 10,
      limitBytes: 10_000
    });

    expect(entries).toEqual([
      expect.objectContaining({ source: 'journald', message: 'vm agent started token=<redacted>' }),
      expect.objectContaining({ source: 'journald', message: 'vm Authorization: Bearer <redacted>' })
    ]);
    expect(execFileMock).toHaveBeenCalledWith(
      'journalctl',
      ['-n', '10', '--no-pager', '-o', 'short-iso'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function)
    );
  });

  it('falls back from /var/log/syslog to /var/log/messages', async () => {
    execFileMock.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
      if (command === 'tail' && args.includes('/var/log/syslog')) {
        callback(null, { stdout: '' });
        return;
      }
      if (command === 'tail' && args.includes('/var/log/messages')) {
        callback(null, { stdout: 'Jun  1 00:00:04 vm fallback secret=message-secret' });
        return;
      }
      callback(null, { stdout: commandOutput(command, args) });
    });

    const { entries } = await new LinuxSystemdCollector(['syslog']).getLogs({
      source: 'syslog',
      tailLines: 99999,
      limitBytes: 10_000
    });

    expect(entries).toEqual([
      expect.objectContaining({ source: 'syslog', message: 'Jun  1 00:00:04 vm fallback secret=<redacted>' })
    ]);
    expect(execFileMock).toHaveBeenCalledWith(
      'tail',
      ['-n', '5000', '/var/log/messages'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function)
    );
  });

  it('handles hosts without visible non-loopback network interfaces', async () => {
    osMock.networkInterfaces.mockImplementationOnce(() => undefined as never);

    const snapshot = await new LinuxSystemdCollector(['journald']).collectSnapshot();

    expect(snapshot.metrics.network).toEqual([]);
  });

  it('returns bounded empty structures when host commands are unavailable', async () => {
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
      callback(new Error('command unavailable'));
    });

    const snapshot = await new LinuxSystemdCollector(['journald', 'syslog']).collectSnapshot();

    expect(snapshot.host.distro).toBe('Linux');
    expect(snapshot.services).toEqual([]);
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.listeners).toEqual([]);
    expect(snapshot.logs).toEqual([]);
    expect(snapshot.findings).toEqual([]);
  });
});
