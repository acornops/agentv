import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { startWindowsAgent } from './windows-runtime.js';
import { createWindowsReadiness } from './windows-readiness.js';
import { LifecycleManager } from './core/lifecycle.js';
import { MockHostAdapter } from './adapters/mock.js';
import { createLogger } from './logger.js';
import { McpRouter } from './mcp/router.js';
import { ToolExecutor } from './tools/executor.js';
import { Observability } from './observability.js';
import type { AgentConfig } from './config.js';

function config(port: number): AgentConfig {
  return { osFamily: 'windows', serviceManager: 'scm', allowedLogChannels: [], platformUrl: `http://127.0.0.1:${port}`, targetId: 'vm-test', agentKey: 'synthetic', targetType: 'virtual_machine', connectorVersion: '0.0.1-experimental.14', snapshotIntervalMs: 10000, minSnapshotIntervalMs: 10000, maxSnapshotIntervalMs: 3600000, maxSnapshotBytes: 16384, minSnapshotBytes: 16384, maxRemoteSnapshotBytes: 1048576, logLevel: 'error', collectorMode: 'mock', allowedLogUnits: [], writeEnabled: false, mockActionsEnabled: false, helperSocketPath: '/unused', allowInsecureTransport: true };
}
const response = (provisional: boolean) => ({ jsonrpc: '2.0', id: 'agentv-handshake-v2', result: { workspaceId: 'ws', targetId: 'vm-test', targetType: 'virtual_machine', provisional, sessionPolicy: { allowedTools: ['get_service'], writeEnabled: false } } });

describe('provisional authentication evidence', () => {
  it('records Windows provisional evidence without snapshots, clears on disconnect, then records active evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentv-provisional-'));
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    let binaryCount = 0; let connections = 0;
    let activate!: () => void; const activation = new Promise<void>((resolve) => { activate = resolve; });
    server.on('connection', (socket) => {
      const connection = ++connections;
      socket.on('message', async (raw, binary) => { if (binary) { binaryCount++; return; } if (JSON.parse(raw.toString()).method === 'lifecycle/handshake') { if (connection > 1) await activation; socket.send(JSON.stringify(response(connection === 1))); } });
    });
    const state = createWindowsReadiness({ directory, launchId: 'a747fa58-2486-4fb3-a050-a46eece839b0', configSha256: 'a'.repeat(64) });
    const runtime = await startWindowsAgent(config((server.address() as { port: number }).port), { sessionState: state });
    try {
      await vi.waitFor(async () => expect(JSON.parse(await readFile(join(directory, 'authenticated.json'), 'utf8'))).toMatchObject({ phase: 'provisional' }), { timeout: 2000 });
      expect(binaryCount).toBe(0);
      for (const socket of server.clients) socket.close();
      await vi.waitFor(async () => expect(readFile(join(directory, 'authenticated.json'))).rejects.toMatchObject({ code: 'ENOENT' }));
      activate();
      await vi.waitFor(async () => expect(JSON.parse(await readFile(join(directory, 'authenticated.json'), 'utf8'))).toMatchObject({ phase: 'active' }), { timeout: 3000 });
      await vi.waitFor(() => expect(binaryCount).toBeGreaterThan(0));
      await runtime.stop();
      await expect(readFile(join(directory, 'authenticated.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await runtime.stop(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  });
  it('leaves Linux provisional reconnect and no-ready behavior unchanged', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    let binaryCount = 0; let provisionalCount = 0; let activeCount = 0;
    const closed = new Promise<void>((resolve) => server.on('connection', (socket) => {
      socket.once('close', resolve);
      socket.on('message', (raw, binary) => { if (binary) { binaryCount++; return; } if (JSON.parse(raw.toString()).method === 'lifecycle/handshake') socket.send(JSON.stringify(response(true))); });
    }));
    const settings = { ...config((server.address() as { port: number }).port), osFamily: 'linux' as const, serviceManager: 'systemd' as const };
    const state = { authenticated: () => { activeCount++; }, disconnected: () => {}, provisionalAuthenticated: () => { provisionalCount++; } };
    const actions = { capabilities: async () => ({ protocol_version: 1 as const, policy_valid: false, restart_services: [] }), restart: async () => { throw new Error('disabled'); } };
    const lifecycle = new LifecycleManager(settings, new MockHostAdapter(), actions, new McpRouter(new ToolExecutor(), createLogger('error')), createLogger('error'), new Observability(), state);
    const started = Date.now(); lifecycle.start();
    try { await closed; expect(Date.now() - started).toBeGreaterThanOrEqual(900); expect(binaryCount).toBe(0); expect(activeCount).toBe(0); expect(provisionalCount).toBe(0); }
    finally { lifecycle.stop(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
