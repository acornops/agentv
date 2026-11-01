import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../config.js';
import { MockHostAdapter } from '../adapters/mock.js';
import { createLogger } from '../logger.js';
import { McpRouter } from '../mcp/router.js';
import { ToolExecutor } from '../tools/executor.js';
import { Observability } from '../observability.js';
import { LifecycleManager } from './lifecycle.js';

const dependencies = vi.hoisted(() => ({ transport: null as unknown, snapshots: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('../transport/websocket-client.js', () => ({ WebSocketClient: vi.fn(function () { return dependencies.transport; }) }));
vi.mock('./snapshot-manager.js', () => ({ SnapshotManager: vi.fn(function () { return dependencies.snapshots; }) }));
let wire: EventEmitter & { forceReconnect: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  wire = Object.assign(new EventEmitter(), { connect: vi.fn(), close: vi.fn(), send: vi.fn(() => true), isOpen: () => true, markReady: vi.fn(), forceReconnect: vi.fn() });
  dependencies.transport = wire;
});
afterEach(() => vi.useRealTimers());

function start(osFamily: 'linux' | 'windows') {
  const config: AgentConfig = { osFamily, serviceManager: osFamily === 'linux' ? 'systemd' : 'scm', allowedLogChannels: [], platformUrl: 'http://127.0.0.1', targetId: 'vm-test', agentKey: 'synthetic', targetType: 'virtual_machine', connectorVersion: 'test', snapshotIntervalMs: 10000, minSnapshotIntervalMs: 10000, maxSnapshotIntervalMs: 3600000, maxSnapshotBytes: 16384, minSnapshotBytes: 16384, maxRemoteSnapshotBytes: 1048576, logLevel: 'error', collectorMode: 'mock', allowedLogUnits: [], writeEnabled: false, mockActionsEnabled: false, helperSocketPath: '/unused', allowInsecureTransport: true };
  const logger = createLogger('error'); const router = new McpRouter(new ToolExecutor(), logger);
  const state = { authenticated: vi.fn(), disconnected: vi.fn(), provisionalAuthenticated: vi.fn() };
  const actions = { capabilities: async () => ({ protocol_version: 1 as const, policy_valid: false, restart_services: [] }), restart: async () => { throw new Error('disabled'); } };
  const lifecycle = osFamily === 'windows'
    ? LifecycleManager.forWindows(config, { kind: 'windows', logsEnabled: false, createSnapshots: () => dependencies.snapshots }, router, logger, new Observability(), state)
    : new LifecycleManager(config, new MockHostAdapter(), actions, router, logger, new Observability(), state);
  lifecycle.start(); wire.emit('open');
  return { lifecycle, state };
}
function authenticate(provisional: boolean) {
  wire.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'agentv-handshake-v2', result: { workspaceId: 'ws', targetId: 'vm-test', targetType: 'virtual_machine', provisional, sessionPolicy: { allowedTools: [], writeEnabled: false } } })));
}

describe.each(['linux', 'windows'] as const)('%s provisional reconnect ownership', (osFamily) => {
  it('keeps the one-second retry for its own provisional connection', async () => {
    const { lifecycle, state } = start(osFamily);
    try {
      authenticate(true);
      await vi.advanceTimersByTimeAsync(999); expect(wire.forceReconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(wire.forceReconnect).toHaveBeenCalledTimes(1);
      expect(state.authenticated).not.toHaveBeenCalled(); expect(dependencies.snapshots.start).not.toHaveBeenCalled();
    } finally { lifecycle.stop(); }
  });
  it.each([false, true])('cannot interrupt a replacement connection (authenticated=%s)', async (active) => {
    const { lifecycle, state } = start(osFamily);
    try {
      authenticate(true); await vi.advanceTimersByTimeAsync(900);
      wire.emit('close', 1006, 'prior connection ended'); wire.emit('open');
      if (active) authenticate(false);
      expect(state.authenticated).toHaveBeenCalledTimes(active ? 1 : 0);
      await vi.advanceTimersByTimeAsync(100);
      expect(wire.forceReconnect).not.toHaveBeenCalled();
    } finally { lifecycle.stop(); }
  });
});
