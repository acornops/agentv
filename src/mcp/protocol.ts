import { z } from 'zod';

export const JsonRpcIdSchema = z.union([z.string().max(256), z.number().finite()]);
export const JsonRpcRequestSchema = z.object({ jsonrpc: z.literal('2.0'), id: JsonRpcIdSchema, method: z.string().min(1).max(128), params: z.unknown().optional() }).strict();
export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'), id: JsonRpcIdSchema.nullable(), result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional(),
}).strict();
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export const RPC_ERRORS = { PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603 } as const;
/** Build a JSON-RPC request. */
export function createRequest(method: string, params: unknown, id: string | number): Record<string, unknown> { return { jsonrpc: '2.0', id, method, params }; }
/** Build a JSON-RPC notification. */
export function createNotification(method: string, params: unknown): Record<string, unknown> { return { jsonrpc: '2.0', method, params }; }
/** Build a successful JSON-RPC response. */
export function createResponse(id: string | number, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result }; }
/** Build an error JSON-RPC response. */
export function createErrorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
