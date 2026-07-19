import { describe, expect, it } from 'vitest';
import { MockHostAdapter } from '../adapters/mock.js';
import type { ActionClient } from '../actions/types.js';
import { createLogger } from '../logger.js';
import { McpRouter } from '../mcp/router.js';
import { ToolExecutor } from './executor.js';
import { registerAllTools } from './index.js';
import { toolRegistry } from './registry.js';

const actions: ActionClient = {
  async capabilities() { return { protocol_version: 1, policy_valid: true, restart_services: ['ssh.service'] }; },
  async restart(request) { return { operation_id: request.operation_id, unit: request.unit, outcome: 'success', before: { active_state: 'active', sub_state: 'running', invocation_id: 'old' }, after: { active_state: 'active', sub_state: 'running', invocation_id: 'new' }, started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:01Z', systemd_job_result: 'done' }; },
};

describe('AgentV tool contracts', () => {
  it('registers only the nine canonical production tools', () => {
    registerAllTools(new MockHostAdapter(), actions);
    expect(toolRegistry.getAll().map((tool) => tool.name)).toEqual(['get_host_summary', 'list_filesystems', 'list_processes', 'get_process', 'list_services', 'get_service', 'query_logs', 'list_listeners', 'restart_service']);
  });
  it('requires authenticated readiness and returns canonical metadata and envelope', async () => {
    registerAllTools(new MockHostAdapter(), actions);
    const router = new McpRouter(new ToolExecutor({ localWriteEnabled: () => false }), createLogger('error'));
    const denied = await router.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(denied.error?.data).toEqual({ code: 'TOOL_NOT_ALLOWED' });
    router.setSessionPolicy({ allowedTools: new Set(['get_host_summary']), writeEnabled: false, generation: 1, targetId: 'vm-1' });
    const listed = await router.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as any;
    expect(listed.result.tools[0]).toHaveProperty('inputSchema');
    expect(listed.result.tools[0]).not.toHaveProperty('input_schema');
    expect(listed.result.tools[0]).toMatchObject({ version: '2.0.0', deprecated: false, capability: 'read' });
    const successSchema = listed.result.tools[0].outputSchema.properties.data.oneOf[0];
    expect(successSchema.additionalProperties).toBe(false);
    expect(successSchema.required).toContain('collector_health');
    const called = await router.handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_host_summary', arguments: {} } }) as any;
    expect(called.result.structuredContent.schemaVersion).toBe('acornops.full-tool-result.v1');
    expect(JSON.parse(called.result.content[0].text).schemaVersion).toBe('acornops.model-context.v1');
  });
  it('does not convert missing arguments to an empty object', async () => {
    registerAllTools(new MockHostAdapter(), actions);
    const router = new McpRouter(new ToolExecutor(), createLogger('error'));
    router.setSessionPolicy({ allowedTools: new Set(['get_host_summary']), writeEnabled: false, generation: 1, targetId: 'vm-1' });
    const called = await router.handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_host_summary' } }) as any;
    expect(called.result.isError).toBe(true);
    expect(called.result.structuredContent.data.code).toBe('INVALID_ARGUMENTS');
  });
  it('preserves failed write receipts and never marks a crossed write retryable', async () => {
    const failedActions: ActionClient = {
      ...actions,
      async restart(request) {
        return { operation_id: request.operation_id, unit: request.unit, outcome: 'failed', before: { active_state: 'active', sub_state: 'running', invocation_id: 'old' }, after: { active_state: 'failed', sub_state: 'failed', invocation_id: 'new' }, started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:01Z', systemd_job_result: 'failed' };
      },
    };
    registerAllTools(new MockHostAdapter(), failedActions);
    const router = new McpRouter(new ToolExecutor({ localWriteEnabled: () => true }), createLogger('error'));
    router.setSessionPolicy({ allowedTools: new Set(['restart_service']), writeEnabled: true, generation: 1, targetId: 'vm-1' });
    const called = await router.handleRequest({ jsonrpc: '2.0', id: 'stable-call', method: 'tools/call', params: { name: 'restart_service', arguments: { unit: 'ssh.service', reason: 'Approved recovery', expected_active_state: 'active', expected_sub_state: 'running' } } }) as any;
    expect(called.result.isError).toBe(true);
    expect(called.result.structuredContent.data).toMatchObject({ outcome: 'failed', retryable: false, receipt: { outcome: 'failed', systemd_job_result: 'failed' } });
  });
});
