import { describe, expect, it } from 'vitest';
import { MockHostAdapter } from '../adapters/mock.js';
import type { ActionClient } from '../actions/types.js';
import { JsonRpcRequestSchema, JsonRpcResponseSchema } from '../mcp/protocol.js';
import { registerAllTools } from './index.js';
import { zodToJsonSchema } from './json-schema.js';
import { toolRegistry } from './registry.js';

describe('advertised input contracts', () => {
  // These cases only parse inputs; no host or privileged helper operation runs.
  const actions: ActionClient = {
    async capabilities() { throw new Error('unexpected helper call'); },
    async restart() { throw new Error('unexpected helper call'); },
  };

  it('advertises query_logs fields and limits even with a root refinement', () => {
    registerAllTools(new MockHostAdapter(), actions);
    const schema = zodToJsonSchema(toolRegistry.get('query_logs')!.schema);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, properties: {
      unit: { type: 'string', minLength: 9, maxLength: 263 },
      since: { type: 'string', format: 'date-time' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      byte_limit: { type: 'integer', minimum: 1024, maximum: 1048576 },
    } });
    expect(schema.required ?? []).toEqual([]);
    expect(toolRegistry.get('query_logs')!.schema.parse({})).toEqual({ limit: 100, byte_limit: 262144 });
    expect(toolRegistry.get('query_logs')!.schema.safeParse({ since: '2026-01-02T00:00:00Z', until: '2026-01-01T00:00:00Z' }).success).toBe(false);
  });

  it('keeps explicit restart preconditions required and optional fields optional', () => {
    registerAllTools(new MockHostAdapter(), actions);
    const schema = zodToJsonSchema(toolRegistry.get('restart_service')!.schema);
    expect(schema.required).toEqual(['unit', 'reason', 'expected_active_state', 'expected_sub_state']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('advertises exact read-before-restart guidance to the model', () => {
    registerAllTools(new MockHostAdapter(), actions);
    const tool = toolRegistry.get('restart_service')!;
    const schema = zodToJsonSchema(tool.schema);
    expect(tool.description).toMatch(/get_service.*same unit/);
    expect(tool.description).toMatch(/PRECONDITION_FAILED.*get_service/);
    expect(schema).toMatchObject({ properties: {
      expected_active_state: { description: expect.stringContaining('restart_preconditions.active_state') },
      expected_sub_state: { description: expect.stringContaining('restart_preconditions.sub_state') },
      expected_invocation_id: { description: expect.stringContaining('restart_preconditions.invocation_id') },
    } });
    expect(JSON.stringify(schema)).toMatch(/Never invent/);
    expect(JSON.stringify(schema)).toMatch(/Omit only when.*absent/);
  });

  it('preserves omitted JSON-RPC payloads and explicit null results', () => {
    expect(JsonRpcRequestSchema.parse({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).not.toHaveProperty('params');
    expect(JsonRpcResponseSchema.parse({ jsonrpc: '2.0', id: 1, result: null }).result).toBeNull();
    expect(JsonRpcResponseSchema.parse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } })).not.toHaveProperty('result');
  });
});
