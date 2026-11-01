import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowsLiveHost } from './live.js';
import { WindowsMockHost } from './mock.js';
import type { CollectorResult } from './runner.js';
import type { LogChannel, WindowsLog, WindowsLogsInput } from './types.js';

const now = Date.parse('2026-11-01T12:00:00.000Z');
const entry: WindowsLog = { channel: 'Application', record_id: 1, timestamp: '2026-11-01T11:30:00.000Z', level: 4, provider: 'Synthetic', event_id: 10, message: 'Synthetic needle' };
const nativeResult: CollectorResult = { items: [entry, { ...entry, record_id: 2, message: 'Other event' }, { ...entry, channel: 'System', record_id: 3 }], status: 'ok', truncated: false };
const base: WindowsLogsInput = { channel: 'Application', limit: 10, byte_limit: 1024, query: 'SyNtHeTiC NeEdLe' };
const defaultWindow = { since: '2026-11-01T11:00:00.000Z', until: '2026-11-01T12:00:00.000Z' };
const channelError = { toolCode: 'PERMISSION_DENIED', message: 'Log channel is not locally allowed' };
const rowError = { toolCode: 'INVALID_ARGUMENTS', message: 'Windows log row limit is invalid' };
const windowError = { toolCode: 'INVALID_ARGUMENTS', message: 'Windows logs require a valid window no larger than 24 hours' };
const byteError = { toolCode: 'INVALID_ARGUMENTS', message: 'Windows log byte limit is invalid' };
interface LogCase {
  name: string;
  input?: Partial<WindowsLogsInput>;
  channels?: readonly LogChannel[];
  window?: { since: string; until: string };
  error?: { toolCode: string; message: string };
}

// Each row catches a skipped bound, changed default or reordered validation.
// Expected windows are hand-derived from the fixed clock, not the validator.
const cases: LogCase[] = [
  { name: 'defaults to the preceding hour' },
  { name: 'accepts the other supported channel', input: { channel: 'System' } },
  { name: 'denies an unconfigured channel', channels: ['System'], error: channelError },
  { name: 'denies channels when none are configured', channels: [], error: channelError },
  { name: 'denies unsupported channels even if configured', channels: ['Security' as LogChannel], input: { channel: 'Security' as LogChannel }, error: channelError },
  { name: 'checks channels before other invalid fields', channels: [], input: { limit: 0, since: 'invalid', byte_limit: 0 }, error: channelError },
  { name: 'accepts the minimum row limit', input: { limit: 1 } },
  { name: 'accepts the maximum row limit', input: { limit: 500 } },
  { name: 'rejects zero rows', input: { limit: 0 }, error: rowError },
  { name: 'rejects more than 500 rows', input: { limit: 501 }, error: rowError },
  { name: 'rejects fractional rows', input: { limit: 1.5 }, error: rowError },
  { name: 'rejects nonfinite rows', input: { limit: NaN }, error: rowError },
  { name: 'checks rows before window and bytes', input: { limit: 0, since: 'invalid', byte_limit: 0 }, error: rowError },
  { name: 'accepts exactly 24 hours', input: { since: '2026-10-31T12:00:00.000Z' }, window: { since: '2026-10-31T12:00:00.000Z', until: '2026-11-01T12:00:00.000Z' } },
  { name: 'rejects a window one millisecond over 24 hours', input: { since: '2026-10-31T11:59:59.999Z' }, error: windowError },
  { name: 'rejects a 48-hour window before native collection', input: { since: '2026-10-30T12:00:00.000Z', until: '2026-11-01T12:00:00.000Z' }, error: windowError },
  { name: 'rejects reversed dates', input: { since: '2026-11-01T12:00:00.000Z', until: '2026-11-01T11:00:00.000Z' }, error: windowError },
  { name: 'rejects an invalid start', input: { since: 'invalid' }, error: windowError },
  { name: 'rejects an invalid end', input: { until: 'invalid' }, error: windowError },
  { name: 'accepts an empty window', input: { since: '2026-11-01T12:00:00.000Z' }, window: { since: '2026-11-01T12:00:00.000Z', until: '2026-11-01T12:00:00.000Z' } },
  { name: 'accepts exactly 60 seconds of future skew', input: { until: '2026-11-01T12:01:00.000Z' }, window: { since: '2026-11-01T11:01:00.000Z', until: '2026-11-01T12:01:00.000Z' } },
  { name: 'rejects one millisecond over future skew', input: { until: '2026-11-01T12:01:00.001Z' }, error: windowError },
  { name: 'normalizes supplied date offsets', input: { since: '2026-11-01T18:00:00+08:00', until: '2026-11-01T19:00:00+08:00' }, window: { since: '2026-11-01T10:00:00.000Z', until: '2026-11-01T11:00:00.000Z' } },
  { name: 'retains defaults for empty date strings', input: { since: '', until: '' } },
  { name: 'checks the window before bytes', input: { since: 'invalid', byte_limit: 0 }, error: windowError },
  { name: 'accepts the maximum byte limit', input: { byte_limit: 1048576 } },
  { name: 'rejects fewer than 1024 bytes', input: { byte_limit: 1023 }, error: byteError },
  { name: 'rejects more than one MiB', input: { byte_limit: 1048577 }, error: byteError },
  { name: 'rejects fractional bytes', input: { byte_limit: 1024.5 }, error: byteError },
  { name: 'rejects nonfinite bytes', input: { byte_limit: Infinity }, error: byteError },
];

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

describe.each(['live', 'mock'] as const)('Windows %s log validation', (mode) => {
  it.each(cases)('$name', async ({ input: overrides, channels = ['Application', 'System'], window = defaultWindow, error }) => {
    // Only native I/O is substituted: schema validation, filtering, bounds and
    // result construction all execute in the actual WindowsLiveHost.
    const run = vi.fn(async () => nativeResult);
    const host = mode === 'live'
      ? new WindowsLiveHost(channels, { run, stop: async () => undefined })
      : new WindowsMockHost(channels);
    const input = { ...base, ...overrides };
    const pending = host.queryLogs(input);
    if (error) {
      await expect(pending).rejects.toMatchObject(error);
      if (mode === 'live') expect(run).not.toHaveBeenCalled();
    } else {
      const result = await pending;
      const expectedEntries = mode === 'live' ? [{ ...entry, channel: input.channel, record_id: input.channel === 'System' ? 3 : 1 }] : [];
      expect(result).toEqual({ entries: expectedEntries, returned_count: expectedEntries.length, original_count: expectedEntries.length, byte_count: Buffer.byteLength(JSON.stringify(expectedEntries)), truncated: false, health: { collector: 'windows_events', status: 'ok', duration_ms: 0 } });
      if (mode === 'live') expect(run).toHaveBeenCalledExactlyOnceWith('events', { channel: input.channel, ...window, limit: input.limit, byte_limit: input.byte_limit }, undefined);
    }
  });
});

describe('Windows live log output bounds', () => {
  it('filters the channel before applying the requested row limit and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    const run = vi.fn(async () => ({ ...nativeResult, items: [...nativeResult.items].reverse() }));
    const result = await new WindowsLiveHost(['Application'], { run, stop: async () => undefined }).queryLogs({ ...base, query: undefined, limit: 1 }, signal);
    expect(result.entries).toEqual([{ ...entry, record_id: 2, message: 'Other event' }]);
    expect(result).toMatchObject({ returned_count: 1, original_count: 2, truncated: true });
    expect(run).toHaveBeenCalledExactlyOnceWith('events', { channel: 'Application', ...defaultWindow, limit: 1, byte_limit: 1024 }, signal);
  });
  it('trims whole entries by UTF-8 bytes and retains truncation evidence', async () => {
    const run = async () => ({ ...nativeResult, items: [entry, { ...entry, record_id: 2, message: 'é'.repeat(600) }] });
    const result = await new WindowsLiveHost(['Application'], { run, stop: async () => undefined }).queryLogs({ ...base, query: undefined });
    expect(result.entries).toEqual([entry]);
    expect(result).toMatchObject({ returned_count: 1, original_count: 2, byte_count: Buffer.byteLength(JSON.stringify([entry])), truncated: true });
  });
});
