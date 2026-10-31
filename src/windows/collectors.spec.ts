import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scripts } from './scripts.js';
import { collectorEnvironment, collectorCommand, parseCollectorResult, WindowsCollectorRunner } from './runner.js';
import { isFailedService } from './service-health.js';
import { WindowsLiveHost } from './live.js';

describe('fixed Windows collectors', () => {
  it('keeps hostile Unicode filter text solely in stdin and clears preload/credential environment', () => {
    const data = { query: "日本語';$(Start-Process x);`\n" };
    const command = collectorCommand('services', data);
    expect(command.stdin).toBe(JSON.stringify(data));
    expect(command.args.join(' ')).not.toContain('Start-Process x');
    expect(command.args).toContain('-NoProfile');
    expect(command.args.join(' ').length).toBeLessThan(30000);
    expect(collectorEnvironment('C:\\Windows\\System32')).toEqual({ SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0', PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' });
    for (const script of Object.values(scripts)) expect(script).not.toMatch(/Invoke-Expression|iex |-Command \$/i);
  });
  it('rejects malformed results and reports denied/partial data without manufacturing healthy evidence', () => {
    expect(() => parseCollectorResult('not json')).toThrow('invalid');
    expect(() => parseCollectorResult('{"items":[],"truncated":false,"status":"unexpected"}')).toThrow('invalid');
    expect(parseCollectorResult('{"items":[],"truncated":false,"status":"permission_denied"}').status).toBe('permission_denied');
    expect(parseCollectorResult('{"items":[],"truncated":true,"status":"partial"}').truncated).toBe(true);
  });
  it('validates native fields, nulls irrelevant service-specific codes and bounds rows', async () => {
    const runner = { run: async () => ({ items: [{ name: '示例;$(x)', display_name: '示例', state: 'Stopped', start_mode: 'Manual', process_id: 0, exit_code: 1067, service_specific_exit_code: 99 }], status: 'partial' as const, truncated: true }), stop: async () => undefined };
    const host = new WindowsLiveHost([], runner);
    const result = await host.listServices({ limit: 1 });
    expect(result.items[0].service_specific_exit_code).toBeNull();
    expect(result.health.status).toBe('partial'); expect(result.omitted_count).toBeGreaterThan(0);
    runner.run = async () => ({ items: [{ name: 'bad' }] as never, status: 'partial' as const, truncated: true });
    await expect(host.listServices({ limit: 1 })).rejects.toThrow('invalid');
  });
  it('normalizes the explicitly synthetic SCM fixture without false failures', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/synthetic-services.json', import.meta.url), 'utf8'));
    expect(fixture.provenance.native_qualification).toBe(false);
    const host = new WindowsLiveHost([], { run: async () => parseCollectorResult(JSON.stringify(fixture.result)), stop: async () => undefined });
    const result = await host.listServices({ limit: 200 });
    expect(result.items.filter(isFailedService).map((item) => item.name)).toEqual(['SyntheticAborted', 'SyntheticSpecific']);
    expect(result.items.find((item) => item.name === 'SyntheticSpecific')!.service_specific_exit_code).toBe(42);
  });
  it('rejects unsupported live hosts and aborts already-cancelled collection', async () => {
    if (process.platform !== 'win32') expect(() => new WindowsCollectorRunner()).toThrow('Windows');
    const controller = new AbortController(); controller.abort();
    const host = new WindowsLiveHost([], { run: async (_script, _data, signal) => { if (signal?.aborted) throw new Error('cancelled'); return { items: [], status: 'ok', truncated: false }; }, stop: async () => undefined });
    await expect(host.listServices({ limit: 1 }, controller.signal)).rejects.toThrow('cancelled');
    await expect(host.queryLogs({ channel: 'Application', limit: 1, byte_limit: 1024 })).rejects.toThrow('locally allowed');
  });
});
