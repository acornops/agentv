import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolExecutionError } from './errors.js';
import { ToolExecutor } from './executor.js';
import { toolRegistry } from './registry.js';

const projection = { schemaVersion: 'acornops.model-context.v1' as const, tool: 'test', status: 'success' as const, summary: 'ok', data: {}, omissions: [] };
describe('ToolExecutor', () => {
  it('derives stable write operation IDs independent of generation', async () => {
    const seen: string[] = []; toolRegistry.resetForTests();
    toolRegistry.register({ name: 'write_test', description: 'test', capability: 'write', schema: z.object({}).strict(), outputSchema: {}, timeoutMs: 100, artifactPolicy: 'always', version: '1', scopeResolver: () => ({ type: 'host' }), handler: async (_input, context) => { seen.push(context.operationId); return {}; }, projectForModel: () => projection });
    const executor = new ToolExecutor({ localWriteEnabled: () => true });
    for (const generation of [1, 2]) { executor.setActiveGeneration(generation); await executor.execute({ name: 'write_test', arguments: {}, requestId: 'call-1', policy: { allowedTools: new Set(['write_test']), writeEnabled: true, generation, targetId: 'vm-1' } }); }
    expect(seen[0]).toBe(seen[1]);
  });
  it('revokes queued calls on generation changes', async () => {
    let finish!: () => void; const blocked = new Promise<void>((resolve) => { finish = resolve; }); toolRegistry.resetForTests();
    toolRegistry.register({ name: 'read_test', description: 'test', capability: 'read', schema: z.object({}).strict(), outputSchema: {}, timeoutMs: 200, artifactPolicy: 'never', version: '1', scopeResolver: () => ({ type: 'host' }), handler: async () => { await blocked; return {}; }, projectForModel: () => projection });
    const executor = new ToolExecutor({ readConcurrency: 1 }); executor.setActiveGeneration(1);
    const policy = { allowedTools: new Set(['read_test']), writeEnabled: false, generation: 1, targetId: 'vm-1' };
    const first = executor.execute({ name: 'read_test', arguments: {}, requestId: 1, policy });
    await Promise.resolve();
    const queued = executor.execute({ name: 'read_test', arguments: {}, requestId: 2, policy });
    await Promise.resolve();
    executor.setActiveGeneration(2);
    await expect(queued).rejects.toMatchObject({ toolCode: 'TOOL_NOT_ALLOWED' }); finish();
    await expect(first).rejects.toMatchObject({ toolCode: 'TOOL_NOT_ALLOWED' });
  });
  it('aborts active handlers when the session generation changes', async () => {
    let observed = false; toolRegistry.resetForTests();
    toolRegistry.register({ name: 'read_test', description: 'test', capability: 'read', schema: z.object({}).strict(), outputSchema: {}, timeoutMs: 200, artifactPolicy: 'never', version: '1', scopeResolver: () => ({ type: 'host' }), handler: async (_input, context) => await new Promise((resolve, reject) => {
      context.signal.addEventListener('abort', () => { observed = true; reject(new ToolExecutionError('TOOL_NOT_ALLOWED', 'revoked')); }, { once: true });
    }), projectForModel: () => projection });
    const executor = new ToolExecutor(); executor.setActiveGeneration(1);
    const active = executor.execute({ name: 'read_test', arguments: {}, requestId: 1, policy: { allowedTools: new Set(['read_test']), writeEnabled: false, generation: 1, targetId: 'vm-1' } });
    await Promise.resolve(); executor.setActiveGeneration(2);
    await expect(active).rejects.toMatchObject({ toolCode: 'TOOL_NOT_ALLOWED' }); expect(observed).toBe(true);
  });
  it('marks timed-out writes unknown and non-releasable until the handler settles', async () => {
    let finish!: () => void; const blocked = new Promise<void>((resolve) => { finish = resolve; }); toolRegistry.resetForTests();
    toolRegistry.register({ name: 'write_test', description: 'test', capability: 'write', schema: z.object({}).strict(), outputSchema: {}, timeoutMs: 20, artifactPolicy: 'always', version: '1', scopeResolver: () => ({ type: 'host' }), handler: async () => blocked, projectForModel: () => projection });
    const executor = new ToolExecutor({ writeConcurrency: 1, localWriteEnabled: () => true }); executor.setActiveGeneration(1);
    const policy = { allowedTools: new Set(['write_test']), writeEnabled: true, generation: 1, targetId: 'vm-1' };
    await expect(executor.execute({ name: 'write_test', arguments: {}, requestId: 1, policy })).rejects.toMatchObject({ toolCode: 'TOOL_TIMEOUT', data: expect.objectContaining({ outcome: 'unknown' }) });
    await expect(executor.execute({ name: 'write_test', arguments: {}, requestId: 2, policy })).rejects.toBeInstanceOf(ToolExecutionError); finish();
  });
});
