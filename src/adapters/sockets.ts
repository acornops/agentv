import { resolveExecutable, runCommand } from './command-runner.js';
import type { CollectorHealth, ListenerSummary } from './types.js';
type CommandRunner = typeof runCommand;
type ExecutableResolver = typeof resolveExecutable;

function endpoint(value: string): { address: string; port: number } | null {
  const bracketed = value.match(/^\[([^\]]+)]:(\d+)$/);
  if (bracketed) return { address: bracketed[1], port: Number(bracketed[2]) };
  const index = value.lastIndexOf(':');
  if (index < 0) return null;
  return { address: value.slice(0, index), port: Number(value.slice(index + 1)) };
}

/** Parse stable ss listener rows for a single protocol. */
export function parseSocketOutput(protocol: 'tcp' | 'udp', text: string): ListenerSummary[] {
  return text.split('\n').flatMap((line): ListenerSummary[] => {
    const fields = line.trim().split(/\s+/); if (fields.length < 5) return [];
    const local = endpoint(fields[3]); if (!local || !Number.isInteger(local.port)) return [];
    const processText = fields.slice(5).join(' ');
    const pidMatch = processText.match(/pid=(\d+)/); const nameMatch = processText.match(/users:\(\(\"([^\"]+)\"/);
    const unavailable = !pidMatch;
    return [{ protocol, address: local.address, port: local.port, pid: pidMatch ? Number(pidMatch[1]) : null, process: nameMatch?.[1] || null, ownership_status: unavailable ? 'unavailable' : 'available' }];
  });
}

/** Collect listening TCP and UDP sockets from fixed ss invocations. */
export class SocketAdapter {
  private readonly executable: Promise<string>;
  constructor(
    resolver: ExecutableResolver = resolveExecutable,
    private readonly command: CommandRunner = runCommand,
  ) { this.executable = resolver(['/usr/bin/ss', '/usr/sbin/ss']); }
  async list(input: { protocol?: 'tcp' | 'udp'; port?: number; address?: string; process_query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ListenerSummary[]; original_count: number; omitted_count: number; partial: boolean; health: CollectorHealth }> {
    const started = Date.now();
    const executable = await this.executable;
    const protocols = input.protocol ? [input.protocol] : ['tcp', 'udp'] as const;
    const rows = await Promise.all(protocols.map(async (protocol) => {
      const flag = protocol === 'tcp' ? '-t' : '-u';
      const result = await this.command(executable, ['-H', '-l', '-n', '-p', flag], { timeoutMs: 5000, maxBytes: 1024 * 1024, signal });
      return parseSocketOutput(protocol, result.stdout);
    }));
    let items = rows.flat();
    if (input.port !== undefined) items = items.filter((item) => item.port === input.port);
    if (input.address) items = items.filter((item) => item.address === input.address);
    if (input.process_query) { const query = input.process_query.toLowerCase(); items = items.filter((item) => (item.process || '').toLowerCase().includes(query)); }
    items.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address));
    const original = items.length; const partial = items.some((item) => item.ownership_status !== 'available');
    return { items: items.slice(0, input.limit), original_count: original, omitted_count: Math.max(0, original - input.limit), partial, health: { collector: 'sockets', status: partial ? 'partial' : 'ok', message: partial ? 'Some process ownership was unavailable' : undefined, duration_ms: Date.now() - started } };
  }
}
