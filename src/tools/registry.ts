import { z } from 'zod';

export type ToolCapability = 'read' | 'write';
export type ArtifactPolicy = 'never' | 'if_detailed' | 'always';

export interface ModelContextEnvelope {
  schemaVersion: 'acornops.model-context.v1';
  tool: string;
  status: 'success' | 'error';
  summary: string;
  data: Record<string, unknown>;
  omissions: Array<Record<string, unknown>>;
}

export interface ToolExecutionContext {
  operationId: string;
  requestId: string | number;
  sessionGeneration: number;
  signal: AbortSignal;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  capability: ToolCapability;
  schema: z.ZodTypeAny;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  artifactPolicy: ArtifactPolicy;
  version: string;
  deprecated?: boolean;
  scopeResolver: (params: TInput) => { type: 'host' } | { type: 'service'; unit: string };
  handler: (params: TInput, context: ToolExecutionContext) => Promise<TOutput>;
  projectForModel: (result: TOutput, params: TInput) => ModelContextEnvelope;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition<any, any>[] {
    return [...this.tools.values()];
  }

  resetForTests(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
