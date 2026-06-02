import type { HostCollector } from '../collectors/types.js';
import { callTool, toolDefinitions } from '../tools/index.js';

/** Handle one JSON-RPC request from the control plane. */
export async function handleAgentRequest(
  collector: HostCollector,
  request: { id?: string | number; method?: string; params?: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  const id = request.id ?? null;
  try {
    if (request.method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: toolDefinitions } };
    }
    if (request.method === 'tools/call') {
      const params = request.params || {};
      const name = String(params.name || '');
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      return { jsonrpc: '2.0', id, result: await callTool(collector, name, args) };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : 'Tool failed' }
    };
  }
}
