import type { AgentConfig } from './config.js';
import { LifecycleManager } from './core/lifecycle.js';
import { createLogger } from './logger.js';
import { McpRouter } from './mcp/router.js';
import { Observability } from './observability.js';
import { ToolExecutor } from './tools/executor.js';
import { WindowsLiveHost } from './windows/live.js';
import { WindowsMockHost } from './windows/mock.js';
import { WindowsCollectorRunner } from './windows/runner.js';
import { WindowsSnapshotManager } from './windows/snapshot.js';
import { registerWindowsTools } from './windows/tools.js';
import type { WindowsHost } from './windows/types.js';

export interface WindowsRuntimeOptions {
  /** Only the trusted native host may supply its OS-API-discovered directory. */
  trustedSystemDirectory?: string;
  sessionState?: { authenticated: () => void; disconnected: () => void };
}
export interface WindowsStopHandle { stop(): Promise<void>; }

/** Select an explicit Windows mock independently from the machine running it. */
export function createWindowsHost(config: Pick<AgentConfig, 'collectorMode' | 'allowedLogChannels'>, options: WindowsRuntimeOptions = {}): WindowsHost {
  return config.collectorMode === 'mock' ? new WindowsMockHost(config.allowedLogChannels) : new WindowsLiveHost(config.allowedLogChannels, new WindowsCollectorRunner(options.trustedSystemDirectory));
}

/** Compose the Windows read-only runtime without Linux entrypoint side effects. */
export async function startWindowsAgent(config: AgentConfig, options: WindowsRuntimeOptions = {}): Promise<WindowsStopHandle> {
  if (config.osFamily !== 'windows' || config.serviceManager !== 'scm' || config.writeEnabled || config.mockActionsEnabled) throw new Error('Windows runtime requires read-only Windows/scm configuration');
  const host = createWindowsHost(config, options);
  try { await host.getHostSummary(); } catch (error) { await host.stop(); throw error; }
  const logger = createLogger(config.logLevel); const metrics = new Observability();
  registerWindowsTools(host);
  const router = new McpRouter(new ToolExecutor({ localWriteEnabled: () => false, metrics }), logger);
  const lifecycle = LifecycleManager.forWindows(config, { kind: 'windows', logsEnabled: config.allowedLogChannels.length > 0, createSnapshots: (send) => new WindowsSnapshotManager(host, send, logger, metrics) }, router, logger, metrics, options.sessionState);
  lifecycle.start(); let stopped: Promise<void> | undefined;
  return { stop: () => stopped ??= (async () => { lifecycle.stop(); await host.stop(); })() };
}
