import type { Logger } from '../logger.js';
import { ToolExecutionError } from '../tools/errors.js';
import type { ToolExecutor, ToolSessionPolicy } from '../tools/executor.js';
import { zodToJsonSchema } from '../tools/json-schema.js';
import { buildCallToolResult } from '../tools/model-context.js';
import { toolRegistry } from '../tools/registry.js';
import { createErrorResponse, createResponse, RPC_ERRORS, type JsonRpcRequest, type JsonRpcResponse } from './protocol.js';

const RETRYABLE = new Set(['TOOL_BUSY', 'HOST_UNAVAILABLE']);

/** Route authenticated JSON-RPC tool requests through the bounded executor. */
export class McpRouter {
  private policy: ToolSessionPolicy | null = null;
  constructor(private readonly executor: ToolExecutor, private readonly logger: Logger) {}

  setSessionPolicy(policy: ToolSessionPolicy): void { this.policy = { ...policy, allowedTools: new Set(policy.allowedTools) }; this.executor.setActiveGeneration(policy.generation); }
  clearSessionPolicy(): void { this.policy = null; this.executor.clearActiveGeneration(); }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.policy) return createErrorResponse(request.id, -32001, 'Tool session is not ready', { code: 'TOOL_NOT_ALLOWED' });
    if (request.method === 'tools/list') {
      const tools = toolRegistry.getAll().filter((tool) => this.policy!.allowedTools.has(tool.name)).map((tool) => ({
        name: tool.name, description: tool.description, capability: tool.capability,
        inputSchema: zodToJsonSchema(tool.schema), outputSchema: tool.outputSchema,
        artifactPolicy: tool.artifactPolicy, timeout_ms: tool.timeoutMs,
        version: tool.version, deprecated: Boolean(tool.deprecated),
      }));
      return createResponse(request.id, { tools });
    }
    if (request.method !== 'tools/call') return createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
    const params = request.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Tool call params must be an object');
    const { name, arguments: args } = params as Record<string, unknown>;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(name)) return createErrorResponse(request.id, RPC_ERRORS.INVALID_PARAMS, 'Invalid tool name');
    const tool = toolRegistry.get(name);
    if (!tool) return createErrorResponse(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${name}`);
    try {
      const result = await this.executor.execute({ name, arguments: args, requestId: request.id, policy: this.policy });
      return createResponse(request.id, buildCallToolResult(tool.projectForModel(result, args), result, tool.artifactPolicy));
    } catch (error) {
      const known = error instanceof ToolExecutionError;
      const code = known ? error.toolCode : 'INTERNAL_ERROR';
      const data = known ? error.data : {};
      const retryable = known && RETRYABLE.has(code)
        && (tool.capability === 'read' || data.outcome === 'not_started');
      const failure = { code, message: known ? error.message : 'Internal error during tool execution', ...data, retryable };
      this.logger.error({ tool: name, code, retryable }, 'Tool execution failed');
      return createResponse(request.id, buildCallToolResult({
        schemaVersion: 'acornops.model-context.v1', tool: name, status: 'error',
        summary: failure.message.slice(0, 500), data: failure, omissions: [],
      }, failure, tool.artifactPolicy, true));
    }
  }
}
