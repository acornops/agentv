import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { HostCollector, HostSnapshot } from './types.js';

const execFileAsync = promisify(execFile);

/** Run a host command and return trimmed stdout, or empty text on failure. */
async function run(command: string, args: string[], timeout = 3000, maxBuffer = 512 * 1024): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout, maxBuffer });
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Redact obvious secrets from host command and log text. */
export function redactHostText(value: string): string {
  return value
    .replace(/\b(api[_-]?key|agent[_-]?key|token|secret|password|passwd|pwd)=\S+/gi, '$1=<redacted>')
    .replace(/(^|\s)(--?(?:api[_-]?key|agent[_-]?key|token|secret|password|passwd|pwd))(?:=|\s+)\S+/gi, '$1$2 <redacted>')
    .replace(/\b(authorization:\s*bearer\s+)\S+/gi, '$1<redacted>');
}

/** Redact and bound a process command line. */
function redactCommand(command: string): string {
  return redactHostText(command).slice(0, 240);
}

/** Parse recent journald text into normalized log entries. */
function parseJournaldLogs(text: string, now: string): HostSnapshot['logs'] {
  return text.split('\n').slice(-50).map((line) => ({
    source: 'journald',
    timestamp: line.slice(0, 25).trim() || now,
    message: redactHostText(line.slice(25).trim()).slice(0, 1000),
    severity: 'info'
  })).filter((entry) => entry.message);
}

/** Parse recent syslog text into normalized log entries. */
function parseSyslogLogs(text: string, now: string): HostSnapshot['logs'] {
  return text.split('\n').slice(-50).map((line) => ({
    source: 'syslog',
    timestamp: now,
    message: redactHostText(line.trim()).slice(0, 1000),
    severity: 'info'
  })).filter((entry) => entry.message);
}

/** Keep log entries within a byte budget. */
function boundLogEntries(entries: HostSnapshot['logs'], limitBytes: number): HostSnapshot['logs'] {
  let usedBytes = 0;
  const bounded: HostSnapshot['logs'] = [];
  for (const entry of entries) {
    const size = Buffer.byteLength(entry.message);
    if (usedBytes + size > limitBytes) break;
    usedBytes += size;
    bounded.push(entry);
  }
  return bounded;
}

/** Parse Linux meminfo text into memory usage totals. */
function parseMeminfo(text: string): { totalBytes: number; freeBytes: number; usedBytes: number } {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get('MemTotal') || os.totalmem();
  const freeBytes = (values.get('MemAvailable') || values.get('MemFree') || os.freemem());
  return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
}

/** Parse Linux meminfo text into swap usage totals. */
function parseSwap(text: string): { totalBytes: number; freeBytes: number; usedBytes: number } {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get('SwapTotal') || 0;
  const freeBytes = values.get('SwapFree') || 0;
  return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
}

export class LinuxSystemdCollector implements HostCollector {
  /** Initialize a live Linux/systemd collector with allowed log sources. */
  constructor(private readonly allowedLogSources: string[]) {}

  /** Collect a bounded live host snapshot. */
  async collectSnapshot(): Promise<HostSnapshot> {
    const now = new Date().toISOString();
    const [distro, servicesText, processText, listenersText, diskText, memText, journalText, syslogText] = await Promise.all([
      run('sh', ['-c', '. /etc/os-release 2>/dev/null && printf "%s" "${PRETTY_NAME:-Linux}" || uname -s']),
      run('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager']),
      run('ps', ['-eo', 'pid,user,pcpu,pmem,comm,args', '--sort=-pcpu']),
      run('sh', ['-c', 'ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null || true']),
      run('df', ['-P', '-B1']),
      run('cat', ['/proc/meminfo']),
      this.allowedLogSources.includes('journald') ? run('journalctl', ['-n', '50', '--no-pager', '-o', 'short-iso']) : '',
      this.allowedLogSources.includes('syslog') ? this.readSyslog(50) : ''
    ]);

    const memory = parseMeminfo(memText);
    const swap = parseSwap(memText);
    const services = servicesText.split('\n').filter(Boolean).slice(0, 100).map((line) => {
      const [name = 'unknown', loadState = 'unknown', activeState = 'unknown', subState = 'unknown', ...desc] = line.trim().split(/\s+/);
      return { name, loadState, activeState, subState, description: desc.join(' ') };
    });
    const processes = processText.split('\n').slice(1, 51).map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s*(.*)$/);
      return match ? {
        pid: Number(match[1]),
        user: match[2],
        cpuPercent: Number(match[3]),
        memoryPercent: Number(match[4]),
        name: match[5],
        command: redactCommand(match[6] || match[5])
      } : null;
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const disks = diskText.split('\n').slice(1).map((line) => {
      const parts = line.trim().split(/\s+/);
      return parts.length >= 6 ? {
        filesystem: parts[0],
        totalBytes: Number(parts[1]) || 0,
        usedBytes: Number(parts[2]) || 0,
        mount: parts[5],
        inodeUsedPercent: null
      } : null;
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const listeners = listenersText.split('\n').filter((line) => /LISTEN|tcp|udp/i.test(line)).slice(0, 100).map((line) => {
      const address = line.match(/((?:\d{1,3}\.){3}\d{1,3}|\*|0\.0\.0\.0|\[::\]|::):(\d+)/);
      return {
        protocol: /^\s*udp/i.test(line) ? 'udp' : 'tcp',
        localAddress: address?.[1] || 'unknown',
        port: Number(address?.[2] || 0),
        process: line.match(/users:\(\("([^"]+)"/)?.[1]
      };
    });
    const logs = [
      ...parseJournaldLogs(journalText, now),
      ...parseSyslogLogs(syslogText, now)
    ].slice(-100);
    const findings = services
      .filter((service) => ['failed', 'inactive'].includes(service.activeState))
      .slice(0, 25)
      .map((service) => ({
        id: `service-${service.name}`,
        severity: service.activeState === 'failed' ? 'warning' as const : 'info' as const,
        title: `Service ${service.name} is ${service.activeState}`,
        message: `${service.name} state is ${service.activeState}/${service.subState}.`,
        reason: service.activeState,
        objectKind: 'systemd_service',
        objectName: service.name,
        timestamp: now
      }));

    return {
      host: {
        hostname: os.hostname(),
        kernel: os.release(),
        distro: distro || os.type(),
        uptimeSeconds: os.uptime(),
        architecture: os.arch(),
        osFamily: 'linux',
        serviceManager: 'systemd'
      },
      metrics: {
        loadAverage: os.loadavg(),
        cpuUsagePercent: null,
        memory,
        swap,
        disks,
        network: os.networkInterfaces()
          ? Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
              (addresses || []).filter((addr) => !addr.internal).map((addr) => ({ name, address: addr.address, state: 'up' }))
            )
          : []
      },
      services,
      processes,
      listeners,
      logs,
      findings
    };
  }

  /** Return bounded log entries from allowed host log sources. */
  async getLogs(input: { source?: string; query?: string; tailLines: number; limitBytes: number }): Promise<{ entries: HostSnapshot['logs'] }> {
    if (input.source && !this.allowedLogSources.includes(input.source)) return { entries: [] };
    const now = new Date().toISOString();
    const sources = input.source ? [input.source] : this.allowedLogSources;
    const chunks = await Promise.all(sources.map(async (source) => {
      if (source === 'journald') {
        const text = await run('journalctl', ['-n', String(input.tailLines), '--no-pager', '-o', 'short-iso'], 5000);
        return parseJournaldLogs(text, now);
      }
      if (source === 'syslog') {
        return parseSyslogLogs(await this.readSyslog(input.tailLines), now);
      }
      return [];
    }));
    let entries = chunks.flat();
    if (input.query) entries = entries.filter((entry) => entry.message.toLowerCase().includes(input.query!.toLowerCase()));
    return { entries: boundLogEntries(entries.slice(-input.tailLines), input.limitBytes) };
  }

  private async readSyslog(tailLines: number): Promise<string> {
    const lineCount = String(Math.max(1, Math.min(tailLines, 5000)));
    return (
      await run('tail', ['-n', lineCount, '/var/log/syslog'], 5000)
      || await run('tail', ['-n', lineCount, '/var/log/messages'], 5000)
    );
  }
}
