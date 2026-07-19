import { execFile } from 'node:child_process';

function notifyEnvironment(): NodeJS.ProcessEnv | null {
  if (!process.env.NOTIFY_SOCKET) return null;
  return {
    NOTIFY_SOCKET: process.env.NOTIFY_SOCKET,
    ...(process.env.WATCHDOG_USEC ? { WATCHDOG_USEC: process.env.WATCHDOG_USEC } : {}),
    ...(process.env.WATCHDOG_PID ? { WATCHDOG_PID: process.env.WATCHDOG_PID } : {}),
  };
}

async function notify(args: string[]): Promise<boolean> {
  const env = notifyEnvironment();
  if (!env) return false;
  return await new Promise((resolve) => {
    execFile('/usr/bin/systemd-notify', args, { env, timeout: 5_000, windowsHide: true }, (error) => resolve(!error));
  });
}

/** Tell systemd the Node main process has completed runtime initialization. */
export async function notifyReady(): Promise<boolean> {
  return notify(['--ready', '--status=AgentV runtime started']);
}

/** Send one bounded watchdog notification from the systemd-owned main process. */
export async function notifyWatchdog(): Promise<boolean> {
  return notify(['--watchdog']);
}
