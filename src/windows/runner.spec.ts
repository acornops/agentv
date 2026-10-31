import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dependencies = vi.hoisted(() => ({ spawn: vi.fn(), lstat: vi.fn(), realpath: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: dependencies.spawn }));
vi.mock('node:fs/promises', () => ({ lstat: dependencies.lstat, realpath: dependencies.realpath }));
import { WindowsCollectorRunner } from './runner.js';
const originalPlatform = process.platform; const originalArch = process.arch; const originalNode = process.versions.node;
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true }); Object.defineProperty(process, 'arch', { value: 'x64', configurable: true }); Object.defineProperty(process.versions, 'node', { value: '22.20.0', configurable: true });
  dependencies.lstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true }); dependencies.realpath.mockImplementation(async (path: string) => path);
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => { queueMicrotask(() => child.emit('close', 1)); return true; }) });
  dependencies.spawn.mockReturnValue(child);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); Object.defineProperty(process, 'platform', { value: originalPlatform }); Object.defineProperty(process, 'arch', { value: originalArch }); Object.defineProperty(process.versions, 'node', { value: originalNode }); });
async function spawned() { await vi.waitFor(() => expect(dependencies.spawn).toHaveBeenCalledTimes(1)); }
describe('Windows bounded process boundary', () => {
  it('launches a fixed trusted executable with data stdin and no inherited credentials', async () => {
    const runner = new WindowsCollectorRunner(); const pending = runner.run('services', { name: '日本語;$(x)' }); await spawned();
    const [path, args, options] = dependencies.spawn.mock.calls[0];
    expect(path).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'); expect(options.shell).toBe(false); expect(options.env).not.toHaveProperty('ACORNOPS_AGENT_KEY'); expect(options.env).not.toHaveProperty('NODE_OPTIONS'); expect(args.join(' ')).not.toContain('日本語');
    child.stdout.write('{"items":[],"status":"ok","truncated":false}'); child.emit('close', 0); expect((await pending).status).toBe('ok'); await runner.stop();
  });
  it('kills collectors at the shared stdout/stderr byte ceiling', async () => {
    const runner = new WindowsCollectorRunner(); const pending = runner.run('services', {}); const rejected = expect(pending).rejects.toThrow('output exceeds'); await spawned();
    child.stderr.write(Buffer.alloc(1024 * 1024 + 1)); await rejected; expect(child.kill).toHaveBeenCalled(); await runner.stop();
  });
  it('cancels active children and refuses future collection after idempotent shutdown', async () => {
    const runner = new WindowsCollectorRunner(); const controller = new AbortController(); const pending = runner.run('services', {}, controller.signal); const rejected = expect(pending).rejects.toThrow('cancelled'); await spawned(); controller.abort(); await rejected;
    await runner.stop(); await runner.stop(); await expect(runner.run('services', {})).rejects.toThrow('cancelled');
  });
  it('refuses executable redirection before spawning', async () => {
    dependencies.lstat.mockResolvedValue({ isSymbolicLink: () => true });
    await expect(new WindowsCollectorRunner().run('services', {})).rejects.toThrow('unavailable or unsupported'); expect(dependencies.spawn).not.toHaveBeenCalled();
  });
  it('maps nonzero exit and invalid JSON without exposing stderr or raw output', async () => {
    const runner = new WindowsCollectorRunner(); const pending = runner.run('services', {}); const rejected = expect(pending).rejects.toThrow('unsuccessfully'); await spawned(); child.stderr.write('secret raw native diagnostic'); child.emit('close', 5); await rejected;
  });
});
