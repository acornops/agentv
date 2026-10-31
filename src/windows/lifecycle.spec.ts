import { gunzipSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../config.js';
import { startWindowsAgent } from '../windows-runtime.js';

describe('Windows lifecycle uses common authenticated transport', () => {
  it('publishes native identity, schemas and bounded snapshots and keeps hostile writes disabled', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const config: AgentConfig = { osFamily: 'windows', serviceManager: 'scm', allowedLogChannels: [], platformUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, targetId: 'windows-vm', agentKey: 'synthetic-test', targetType: 'virtual_machine', connectorVersion: '0.0.1-experimental.14', snapshotIntervalMs: 10000, minSnapshotIntervalMs: 10000, maxSnapshotIntervalMs: 3600000, maxSnapshotBytes: 16384, minSnapshotBytes: 16384, maxRemoteSnapshotBytes: 1048576, logLevel: 'error', collectorMode: 'mock', allowedLogUnits: [], writeEnabled: false, mockActionsEnabled: false, helperSocketPath: '/unused', allowInsecureTransport: true };
    let handshake: any; let descriptors: any[] = [];
    const authenticated = vi.fn(); const disconnected = vi.fn();
    const evidence = new Promise<any>((resolve, reject) => server.on('connection', (socket) => socket.on('message', (raw, binary) => {
      try {
        if (binary) { const bytes = gunzipSync(Buffer.from(raw as Buffer)); expect(bytes.length).toBeLessThanOrEqual(16384); resolve(JSON.parse(bytes.toString())); return; }
        const message = JSON.parse(raw.toString());
        if (message.method === 'lifecycle/handshake') {
          handshake = message.params;
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { workspaceId: 'ws', targetId: 'windows-vm', targetType: 'virtual_machine', sessionPolicy: { allowedTools: ['get_service', 'query_logs', 'restart_service'], writeEnabled: true } } }));
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
        } else if (message.id === 1) descriptors = message.result.tools;
      } catch (error) { reject(error); }
    })));
    const runtime = await startWindowsAgent(config, { sessionState: { authenticated, disconnected } });
    try {
      const snapshot = await evidence;
      expect(handshake.hostFeatures).toEqual({ osFamily: 'windows', serviceManager: 'scm' });
      expect(handshake.supportedCapabilities).toEqual(['read', 'mcp', 'scm', 'windows']);
      expect(handshake.advertisedTools).toHaveLength(8);
      expect(descriptors.map((item) => item.name)).toEqual(['get_service']);
      expect(snapshot.params.data.schema_version).toBe('acornops.agentv-windows-snapshot.v1');
      expect(authenticated).toHaveBeenCalledTimes(1);
      expect(runtime.stop()).toBe(runtime.stop());
      await runtime.stop(); expect(disconnected).toHaveBeenCalled();
    } finally { await runtime.stop(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
