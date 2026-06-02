import { describe, expect, it } from 'vitest';
import { MockHostCollector } from '../collectors/mock.js';
import type { HostCollector } from '../collectors/types.js';
import { handleAgentRequest } from './router.js';

describe('MCP router', () => {
  it('lists read-only VM tools', async () => {
    const response = await handleAgentRequest(new MockHostCollector(), { id: 1, method: 'tools/list', params: {} });
    expect(response).toMatchObject({ result: { tools: expect.any(Array) } });
  });

  it('calls VM diagnostic tools', async () => {
    const response = await handleAgentRequest(new MockHostCollector(), {
      id: 2,
      method: 'tools/call',
      params: { name: 'list_services', arguments: {} }
    });
    expect(response).toMatchObject({ result: { services: expect.any(Array) } });
  });

  it('uses null ids and method-not-found errors for unsupported methods', async () => {
    const response = await handleAgentRequest(new MockHostCollector(), { method: 'target/delete', params: {} });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32601, message: 'Method not found' }
    });
  });

  it('defaults non-object tool arguments to an empty argument object', async () => {
    const response = await handleAgentRequest(new MockHostCollector(), {
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'get_host_summary', arguments: 'not-an-object' }
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'call-1',
      result: { host: { osFamily: 'linux', serviceManager: 'systemd' } }
    });
  });

  it('returns JSON-RPC tool errors without leaking stack traces', async () => {
    const response = await handleAgentRequest(new MockHostCollector(), {
      id: 3,
      method: 'tools/call',
      params: { name: 'restart_service', arguments: {} }
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32000, message: 'Unknown tool restart_service' }
    });
  });

  it('returns the generic tool failure message for non-Error throwables', async () => {
    const collector: HostCollector = {
      collectSnapshot: async () => {
        throw 'collector failed';
      },
      getLogs: async () => ({ entries: [] })
    };

    const response = await handleAgentRequest(collector, {
      id: 4,
      method: 'tools/call',
      params: { name: 'get_host_summary', arguments: {} }
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -32000, message: 'Tool failed' }
    });
  });
});
