import { writeFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';

const marker = process.argv[2];
if (!marker) throw new Error('Usage: systemd-smoke-server.mjs <marker-file>');
const allowedTools = [
  'get_host_summary', 'list_filesystems', 'list_processes', 'get_process',
  'list_services', 'get_service', 'query_logs', 'list_listeners', 'restart_service',
];
const server = new WebSocketServer({ host: '127.0.0.1', port: 18081, maxPayload: 1024 * 1024 });

server.on('connection', (socket, request) => {
  if (request.url !== '/api/v1/agent/connect' || request.headers['x-agent-key'] !== 'systemd-smoke-key') {
    socket.close(1008, 'invalid smoke credentials');
    return;
  }
  socket.on('message', async (raw, binary) => {
    if (binary) return;
    const message = JSON.parse(raw.toString());
    if (message.method === 'lifecycle/handshake') {
      if (message.id !== 'agentv-handshake-v2' || message.params?.targetId !== 'agentv-systemd-smoke') {
        socket.close(1008, 'invalid handshake');
        return;
      }
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          workspaceId: 'systemd-smoke-workspace',
          targetId: 'agentv-systemd-smoke',
          targetType: 'virtual_machine',
          sessionPolicy: { allowedTools, writeEnabled: true },
          config: { snapshotInterval: 10, maxSnapshotBytes: 65_536 },
        },
      }));
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'smoke-tools', method: 'tools/list', params: {} }));
      return;
    }
    if (message.id === 'smoke-tools') {
      const names = message.result?.tools?.map((tool) => tool.name);
      if (!Array.isArray(names) || !names.includes('restart_service') || !names.includes('get_host_summary')) {
        throw new Error('Installed AgentV did not advertise expected read/write tools');
      }
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'smoke-call', method: 'tools/call', params: { name: 'get_host_summary', arguments: {} } }));
      return;
    }
    if (message.id === 'smoke-call') {
      if (message.result?.isError || !Array.isArray(message.result?.content) || message.result?.structuredContent?.schemaVersion !== 'acornops.full-tool-result.v1') {
        throw new Error('Installed AgentV returned an invalid MCP result envelope');
      }
      await writeFile(marker, JSON.stringify({ ready: true, tools: allowedTools.length }), 'utf8');
    }
  });
});

await new Promise((resolve) => server.once('listening', resolve));
process.stdout.write('AgentV systemd smoke control plane listening on 127.0.0.1:18081.\n');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
