import { redactString } from '../redaction.js';
import { ToolExecutionError } from '../tools/errors.js';
import { runCommand } from './command-runner.js';
import type { CollectorHealth, LogEntry } from './types.js';

/** Normalize newline-delimited journal JSON with deterministic entry and byte bounds. */
export function parseJournalOutput(text: string, limit: number, byteLimit: number): {
  entries: LogEntry[]; parsedCount: number; invalidCount: number; byteCount: number;
} {
  const lines = text.split('\n').filter(Boolean);
  let invalidCount = 0;
  const parsed = lines.flatMap((line): Record<string, unknown>[] => { try { const value = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) return [value]; } catch { /* count below */ } invalidCount++; return []; });
  const entries: LogEntry[] = [];
  let bytes = 0;
  for (const value of parsed) {
    const timestampMicros = Number(value.__REALTIME_TIMESTAMP) || 0;
    const entry: LogEntry = {
      cursor: typeof value.__CURSOR === 'string' ? value.__CURSOR : null,
      timestamp: timestampMicros ? new Date(timestampMicros / 1000).toISOString() : new Date(0).toISOString(),
      priority: Number.isInteger(Number(value.PRIORITY)) ? Number(value.PRIORITY) : null,
      unit: typeof value._SYSTEMD_UNIT === 'string' ? value._SYSTEMD_UNIT : null,
      pid: Number(value._PID) || null, identifier: typeof value.SYSLOG_IDENTIFIER === 'string' ? value.SYSLOG_IDENTIFIER : null,
      message: redactString(String(value.MESSAGE || '')).slice(0, 16 * 1024),
    };
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (entries.length >= limit || bytes + entryBytes > byteLimit) break;
    entries.push(entry); bytes += entryBytes;
  }
  return { entries, parsedCount: parsed.length, invalidCount, byteCount: bytes };
}

/** Build a journalctl query that can never escape the compiled local unit scope. */
export function journalArgs(
  allowedUnits: ReadonlySet<string>,
  input: { unit?: string; priority?: number; since?: string; until?: string; query?: string; cursor?: string; limit: number },
): string[] {
  if (allowedUnits.size === 0) throw new ToolExecutionError('PERMISSION_DENIED', 'No journal units are locally allowed');
  if (input.unit && !allowedUnits.has(input.unit)) throw new ToolExecutionError('PERMISSION_DENIED', `Log unit is not locally allowed: ${input.unit}`);
  const args = ['--output=json', '--no-pager', '--reverse', '--lines', String(Math.min(1000, input.limit + 1))];
  for (const unit of input.unit ? [input.unit] : [...allowedUnits].sort()) args.push('--unit', unit);
  if (input.priority !== undefined) args.push('--priority', String(input.priority));
  if (input.since) args.push('--since', input.since);
  if (input.until) args.push('--until', input.until);
  if (input.cursor) args.push('--after-cursor', input.cursor);
  if (input.query) args.push('--grep', input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return args;
}

/** Query journald as normalized JSON records with explicit count and byte bounds. */
export class JournalAdapter {
  constructor(private readonly allowedUnits: ReadonlySet<string>) {}

  async query(input: { unit?: string; priority?: number; since?: string; until?: string; query?: string; cursor?: string; limit: number; byte_limit: number }, signal?: AbortSignal): Promise<{ entries: LogEntry[]; next_cursor: string | null; returned_count: number; original_count: number; byte_count: number; truncated: boolean; health: CollectorHealth }> {
    const started = Date.now();
    const args = journalArgs(this.allowedUnits, input);
    const result = await runCommand('/bin/journalctl', args, { timeoutMs: 12000, maxBytes: Math.min(2 * 1024 * 1024, Math.max(64 * 1024, input.byte_limit * 2)), signal });
    if (/permission denied|no journal files were (?:found|opened)/i.test(result.stderr)) {
      throw new ToolExecutionError('PERMISSION_DENIED', 'Journald is not readable by the AgentV user');
    }
    const parsed = parseJournalOutput(result.stdout, input.limit, input.byte_limit);
    return {
      entries: parsed.entries, next_cursor: parsed.entries.at(-1)?.cursor || null, returned_count: parsed.entries.length, original_count: parsed.parsedCount,
      byte_count: parsed.byteCount, truncated: parsed.entries.length < parsed.parsedCount,
      health: { collector: 'journald', status: parsed.invalidCount ? 'partial' : 'ok', message: parsed.invalidCount ? `${parsed.invalidCount} malformed journal record(s) omitted` : undefined, duration_ms: Date.now() - started },
    };
  }
}
