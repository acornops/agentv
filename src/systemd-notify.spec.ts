import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyWatchdog } from './systemd-notify.js';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

describe('systemd watchdog notification', () => {
  beforeEach(() => { execFileMock.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());

  it('returns false without invoking a command when no notify socket is installed', async () => {
    vi.stubEnv('NOTIFY_SOCKET', undefined);
    await expect(notifyWatchdog()).resolves.toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('sends the systemd watchdog notification using the supported variable syntax', async () => {
    vi.stubEnv('NOTIFY_SOCKET', '/run/test-agentv-notify');
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null));
    await expect(notifyWatchdog()).resolves.toBe(true);
    expect(execFileMock).toHaveBeenCalledWith('/usr/bin/systemd-notify', ['WATCHDOG=1'],
      expect.objectContaining({ timeout: 5000, env: expect.objectContaining({ NOTIFY_SOCKET: '/run/test-agentv-notify' }) }),
      expect.any(Function));
  });

  it('reports a failed notification', async () => {
    vi.stubEnv('NOTIFY_SOCKET', '/run/test-agentv-notify');
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(new Error('notification failed')));
    await expect(notifyWatchdog()).resolves.toBe(false);
  });
});
