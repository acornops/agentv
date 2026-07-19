import type { ArtifactPolicy, ModelContextEnvelope } from './registry.js';

export const MODEL_CONTEXT_MAX_BYTES = 12 * 1024;
const MODEL_DATA_TARGET_BYTES = 8 * 1024;

const ERROR_RESULT_DATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['code', 'message', 'retryable'],
  properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } },
  additionalProperties: true,
};

/** Wrap one tool data schema in the complete result envelope schema. */
export function fullToolResultOutputSchema(dataSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object', required: ['schemaVersion', 'data'], additionalProperties: false,
    properties: { schemaVersion: { const: 'acornops.full-tool-result.v1' }, data: { oneOf: [dataSchema, ERROR_RESULT_DATA_SCHEMA] } },
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Validate one bounded model context before transport. */
export function validateModelContext(context: ModelContextEnvelope): ModelContextEnvelope {
  if (context.schemaVersion !== 'acornops.model-context.v1') throw new Error('Invalid model context schema version');
  if (!context.summary || context.summary.length > 500) throw new Error('Invalid model context summary');
  if (byteLength(context) > MODEL_CONTEXT_MAX_BYTES) throw new Error('Model context exceeds byte limit');
  return context;
}

/** Build the standard MCP model-context and structured-result envelope. */
export function buildCallToolResult(
  context: ModelContextEnvelope,
  fullResult: unknown,
  artifactPolicy: ArtifactPolicy,
  isError = false,
): Record<string, unknown> {
  const validated = validateModelContext(context);
  const contextText = JSON.stringify(validated);
  return {
    content: [{ type: 'text', text: contextText }],
    structuredContent: { schemaVersion: 'acornops.full-tool-result.v1', data: fullResult },
    isError,
    _meta: {
      'acornops.dev/result': {
        contextSchemaVersion: 'v1', artifactPolicy,
        originalBytes: byteLength(fullResult), contextBytes: Buffer.byteLength(contextText),
      },
    },
  };
}

/** Project a complete result into a compact bounded model view. */
export function boundedProjection(tool: string, result: unknown, summary: string): ModelContextEnvelope {
  const source = result && typeof result === 'object' ? result as Record<string, unknown> : { value: result };
  const omissions: Array<Record<string, unknown>> = [];
  let data: Record<string, unknown> = source;
  if (byteLength(data) > MODEL_DATA_TARGET_BYTES) data = compactObject(source, 'data', omissions, 512, 20, 24);
  if (byteLength(data) > MODEL_DATA_TARGET_BYTES) data = compactObject(source, 'data', omissions, 128, 8, 12);
  if (byteLength(data) > MODEL_DATA_TARGET_BYTES) {
    data = { truncated: true };
    omissions.push({ path: 'data', reason: 'model_context_byte_limit' });
  }
  if (omissions.length > 16) {
    const omittedCount = omissions.length - 15;
    omissions.splice(15, omittedCount, { path: 'omissions', reason: 'metadata_limit', omittedCount });
  }
  return { schemaVersion: 'acornops.model-context.v1', tool, status: 'success', summary: summary.slice(0, 500), data, omissions };
}

function compactObject(
  source: Record<string, unknown>, path: string, omissions: Array<Record<string, unknown>>,
  maxString: number, maxArray: number, maxKeys: number,
): Record<string, unknown> {
  return compactValue(source, path, omissions, { maxString, maxArray, maxKeys }, 0) as Record<string, unknown>;
}

function compactValue(
  value: unknown, path: string, omissions: Array<Record<string, unknown>>,
  limits: { maxString: number; maxArray: number; maxKeys: number }, depth: number,
): unknown {
  if (typeof value === 'string') {
    if (value.length <= limits.maxString) return value;
    omissions.push({ path, reason: 'string_limit', originalCharacters: value.length, retainedCharacters: limits.maxString });
    return value.slice(0, limits.maxString);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) { omissions.push({ path, reason: 'depth_limit' }); return '[omitted]'; }
  if (Array.isArray(value)) {
    const retained = value.slice(0, limits.maxArray).map((item, index) => compactValue(item, `${path}[${index}]`, omissions, limits, depth + 1));
    if (retained.length < value.length) omissions.push({ path, reason: 'item_limit', originalCount: value.length, retainedCount: retained.length });
    return retained;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  const retained = entries.slice(0, limits.maxKeys).map(([key, child]) => [key, compactValue(child, `${path}.${key}`, omissions, limits, depth + 1)]);
  if (retained.length < entries.length) omissions.push({ path, reason: 'key_limit', originalCount: entries.length, retainedCount: retained.length });
  return Object.fromEntries(retained);
}
