import { describe, expect, it } from 'vitest';
import { notifyWatchdog } from './systemd-notify.js';

describe('systemd watchdog notification', () => {
  it('returns false without invoking a command when no notify socket is installed', async () => {
    const before = process.env.NOTIFY_SOCKET; delete process.env.NOTIFY_SOCKET;
    try { await expect(notifyWatchdog()).resolves.toBe(false); }
    finally { if (before === undefined) delete process.env.NOTIFY_SOCKET; else process.env.NOTIFY_SOCKET = before; }
  });
});
