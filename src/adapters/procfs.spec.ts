import { describe, expect, it } from 'vitest';
import { ProcfsAdapter, parseProcStatus } from './procfs.js';

function stat(pid: number, name: string, ppid: number, userTicks: number, startTicks: number): string {
  const fields = ['R', String(ppid), '0', '0', '0', '0', '0', '0', '0', '0', '0', String(userTicks), '0', '0', '0', '0', '0', '0', '0', String(startTicks)];
  return `${pid} (${name}) ${fields.join(' ')}`;
}

function dependencies(options: { missingPid?: number } = {}) {
  const files: Record<string, string> = {
    '/proc/uptime': '100.00 0.00\n',
    '/proc/meminfo': 'MemTotal: 1000 kB\n',
    '/etc/passwd': 'root:x:0:0:root:/root:/bin/bash\nworker:x:1000:1000::/home/worker:/bin/sh\n',
    '/proc/42/status': 'Name:\tapi worker\nUid:\t1000 1000 1000 1000\nVmRSS:\t250 kB\n',
    '/proc/42/stat': stat(42, 'api worker', 1, 50, 1000),
    '/proc/99/status': 'Name:\tkworker\nUid:\t0 0 0 0\nVmRSS:\t10 kB\n',
    '/proc/99/stat': stat(99, 'kworker', 2, 5, 2000),
  };
  const readText = async (path: string) => {
    if (options.missingPid && path.startsWith(`/proc/${options.missingPid}/`)) {
      throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    }
    const value = files[path];
    if (value === undefined) throw Object.assign(new Error(`missing fixture ${path}`), { code: 'ENOENT' });
    return value;
  };
  return {
    listPids: async () => [42, 99],
    readText,
    readBuffer: async (path: string) => {
      if (options.missingPid && path.startsWith(`/proc/${options.missingPid}/`)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return path.includes('/42/')
        ? Buffer.from('node\0server.js\0--token\0super-secret\0')
        : Buffer.alloc(0);
    },
    readLink: async (path: string) => path.includes('/42/') ? '/usr/bin/node' : null,
    cpuCount: () => 2,
    now: () => 200_000,
  };
}

describe('ProcfsAdapter', () => {
  it('parses colon-delimited records without accepting malformed lines', () => {
    expect(parseProcStatus('Name:\tworker\nmalformed\nUid:\t1000 1000\n')).toEqual({ Name: 'worker', Uid: '1000 1000' });
  });

  it('reads, redacts, filters, sorts, and bounds process records', async () => {
    const result = await new ProcfsAdapter(dependencies()).list({ sort_by: 'memory', order: 'desc', query: 'node', limit: 1 });
    expect(result).toMatchObject({ original_count: 1, omitted_count: 0, health: { status: 'ok' } });
    expect(result.items[0]).toMatchObject({
      pid: 42, ppid: 1, uid: 1000, user: 'worker', name: 'api worker', state: 'R',
      memory_bytes: 256000, memory_percent: 25, executable: '/usr/bin/node',
    });
    expect(result.items[0].command_line).toContain('<redacted>');
    expect(result.items[0].command_line).not.toContain('super-secret');
  });

  it('uses bracketed names for kernel threads and reports vanished list entries as partial', async () => {
    const result = await new ProcfsAdapter(dependencies({ missingPid: 42 })).list({ sort_by: 'pid', order: 'asc', limit: 10 });
    expect(result.items).toEqual([expect.objectContaining({ pid: 99, command_line: '[kworker]', user: 'root' })]);
    expect(result.health).toMatchObject({ status: 'partial', message: '1 process record(s) became unavailable or unreadable' });
  });

  it('maps a vanished exact PID to RESOURCE_NOT_FOUND and honors cancellation', async () => {
    const adapter = new ProcfsAdapter(dependencies({ missingPid: 42 }));
    await expect(adapter.get(42)).rejects.toMatchObject({ toolCode: 'RESOURCE_NOT_FOUND' });
    await expect(adapter.list({ sort_by: 'cpu', order: 'desc', limit: 10 }, AbortSignal.abort())).rejects.toMatchObject({ toolCode: 'TOOL_TIMEOUT' });
  });
});
