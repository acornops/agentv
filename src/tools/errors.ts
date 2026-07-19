export const TOOL_RPC_ERRORS = {
  INVALID_ARGUMENTS: -32602,
  TOOL_NOT_ALLOWED: -32001,
  WRITE_DISABLED: -32002,
  TOOL_TIMEOUT: -32003,
  TOOL_BUSY: -32004,
  PRECONDITION_FAILED: -32005,
  OUTPUT_TOO_LARGE: -32006,
  RESOURCE_NOT_FOUND: -32009,
  PERMISSION_DENIED: -32010,
  COMMAND_UNAVAILABLE: -32011,
  HOST_UNAVAILABLE: -32012,
  INTERNAL_ERROR: -32603,
} as const;

export type ToolErrorCode = keyof typeof TOOL_RPC_ERRORS;

/** A sanitized, stable failure that may cross the AgentV RPC boundary. */
export class ToolExecutionError extends Error {
  constructor(
    readonly toolCode: ToolErrorCode,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }

  get rpcCode(): number {
    return TOOL_RPC_ERRORS[this.toolCode];
  }
}

/** Map host and command errors to stable boundary-safe errors. */
export function mapHostError(error: unknown): ToolExecutionError {
  if (error instanceof ToolExecutionError) return error;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = String(value.code || '').toUpperCase();
  if (code === 'ENOENT') return new ToolExecutionError('COMMAND_UNAVAILABLE', 'A required host command is unavailable');
  if (code === 'EACCES' || code === 'EPERM') return new ToolExecutionError('PERMISSION_DENIED', 'Host access was denied');
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return new ToolExecutionError('HOST_UNAVAILABLE', 'The host service is unavailable');
  }
  return new ToolExecutionError('INTERNAL_ERROR', 'Host operation failed');
}
