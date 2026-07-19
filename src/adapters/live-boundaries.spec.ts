import { describe, expect, it, vi } from 'vitest';
import { FilesystemAdapter } from './filesystems.js';
import { SocketAdapter } from './sockets.js';
import { SystemdAdapter } from './systemd.js';

const bytes = `Filesystem Type 1-blocks Used Available Capacity Mounted on
/dev/sda1 ext4 1000 600 400 60% /
proc proc 0 0 0 0% /proc
`;
const inodes = `Filesystem Type Inodes IUsed IFree IUse% Mounted on
/dev/sda1 ext4 100 25 75 25% /
proc proc 0 0 0 0% /proc
`;

describe('live adapter command boundaries', () => {
  it('combines fixed df calls with mount flags and applies exact filters', async () => {
    const command = vi.fn(async (_executable: string, args: string[]) => ({
      stdout: args.includes('-i') ? inodes : bytes,
      stderr: '',
    }));
    const adapter = new FilesystemAdapter(command, async () => '36 25 0:32 / / ro,relatime - ext4 /dev/sda1 rw\n');
    const result = await adapter.list({ include_pseudo: false, mount: '/', limit: 1 });
    expect(result).toMatchObject({ original_count: 1, omitted_count: 0, truncated: false });
    expect(result.items).toEqual([expect.objectContaining({ mount: '/', total_bytes: 1000, inode_used_percent: 25, read_only: true })]);
    expect(command.mock.calls.map((call) => call[0])).toEqual(['/bin/df', '/bin/df']);
    expect(command.mock.calls.map((call) => call[1])).toEqual([
      ['-P', '-T', '-B1'],
      ['-P', '-T', '-i'],
    ]);
  });

  it('lists, filters, and bounds stable systemd rows', async () => {
    const command = vi.fn(async () => ({
      stdout: 'alpha.service loaded active running Alpha worker\nbeta.service loaded failed failed Beta worker\n',
      stderr: '',
    }));
    const result = await new SystemdAdapter(command).list({ state: 'active', query: 'alpha', limit: 1 });
    expect(result).toMatchObject({ original_count: 1, omitted_count: 0, items: [{ unit: 'alpha.service', active_state: 'active' }] });
    expect(command.mock.calls[0][0]).toBe('/bin/systemctl');
    expect(command.mock.calls[0][1]).toEqual(['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain']);
  });

  it('maps exact systemd properties into restart-safe service details', async () => {
    const command = vi.fn(async () => ({
      stdout: [
        'Id=alpha.service', 'Description=Alpha worker', 'LoadState=loaded', 'ActiveState=active', 'SubState=running',
        'UnitFileState=enabled', 'MainPID=42', 'Result=success', 'ExecMainStatus=0', 'NRestarts=2',
        'InvocationID=invocation-1', 'FragmentPath=/etc/systemd/system/alpha.service',
        'ActiveEnterTimestamp=now', 'InactiveEnterTimestamp=',
      ].join('\n'),
      stderr: '',
    }));
    const result = await new SystemdAdapter(command).get('alpha.service');
    expect(result).toMatchObject({
      unit: 'alpha.service', main_pid: 42, restart_count: 2, invocation_id: 'invocation-1',
      restart_preconditions: { active_state: 'active', sub_state: 'running', invocation_id: 'invocation-1' },
    });
    expect(command.mock.calls[0][1]).toContain('--property=InvocationID');
  });

  it('collects both socket protocols and represents missing ownership as partial', async () => {
    const command = vi.fn(async (_executable: string, args: string[]) => ({
      stdout: args.includes('-t')
        ? 'LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=42,fd=3))\n'
        : 'UNCONN 0 0 [::]:5353 [::]:*\n',
      stderr: '',
    }));
    const adapter = new SocketAdapter(vi.fn(async () => '/usr/bin/ss'), command);
    const result = await adapter.list({ limit: 10 });
    expect(result).toMatchObject({ original_count: 2, omitted_count: 0, partial: true });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 'tcp', port: 8080, pid: 42, process: 'node', ownership_status: 'available' }),
      expect.objectContaining({ protocol: 'udp', port: 5353, pid: null, ownership_status: 'unavailable' }),
    ]));
  });
});
