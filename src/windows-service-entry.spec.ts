import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runWindowsServiceEntry, parseWindowsServiceConfig } from './windows-service-entry.js';

describe('bounded private SCM child gate', () => {
  it('imports runtime only after START and retains STOP during asynchronous startup', async () => {
    const input = new PassThrough(); let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
    const stop = vi.fn(async () => undefined); const load = vi.fn(async () => { await waiting; return { stop }; });
    const result = runWindowsServiceEntry({ input, configPath: 'C:\\protected\\config.json', start: load });
    expect(load).not.toHaveBeenCalled();
    input.write('{"command":"START","trustedSystemDirectory":"C:\\\\Windows\\\\System32"}\n');
    await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
    input.write('{"command":"STOP"}\n'); release(); await result;
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('fails boundedly on EOF/oversized or invalid commands before runtime import', async () => {
    for (const command of ['', 'x'.repeat(4097), '{"command":"START","extra":true}\n']) {
      const input = new PassThrough(); const start = vi.fn(); const result = runWindowsServiceEntry({ input, configPath: 'C:\\config.json', start });
      input.end(command); await expect(result).rejects.toThrow(); expect(start).not.toHaveBeenCalled();
    }
  });
  it('treats EOF during startup as a retained stop and permits STOP before START without loading', async () => {
    const before = new PassThrough(); const unused = vi.fn(); const stopped = runWindowsServiceEntry({ input: before, configPath: 'C:\\config.json', start: unused }); before.end('{"command":"STOP"}\n'); await stopped; expect(unused).not.toHaveBeenCalled();
    const input = new PassThrough(); let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; }); const stop = vi.fn(async () => undefined);
    const result = runWindowsServiceEntry({ input, configPath: 'C:\\config.json', start: async () => { await pending; return { stop }; } });
    input.end('{"command":"START","trustedSystemDirectory":"C:\\\\Windows\\\\System32"}\n');
    await new Promise((resolve) => setImmediate(resolve)); release(); await result; expect(stop).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary keys, writes, mock mode and non-string protected settings', () => {
    expect(parseWindowsServiceConfig('{"version":1,"settings":{"ACORNOPS_AGENT_KEY":"secret"}}')).toMatchObject({ ACORNOPS_VM_OS_FAMILY: 'windows', ACORNOPS_VM_SERVICE_MANAGER: 'scm' });
    for (const settings of [{ NODE_OPTIONS: '--import=x' }, { ACORNOPS_AGENT_WRITE_ENABLED: 'true' }, { ACORNOPS_VM_COLLECTOR_MODE: 'mock' }, { ACORNOPS_TARGET_ID: 42 }]) expect(() => parseWindowsServiceConfig(JSON.stringify({ version: 1, settings }))).toThrow();
  });
});
