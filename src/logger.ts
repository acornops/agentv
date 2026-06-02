import { redact } from './config.js';

export interface Logger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const levels = ['debug', 'info', 'warn', 'error'] as const;

/** Recursively sanitize log fields before serialization. */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return /agent[_-]?key|authorization|token|secret/i.test(value) ? redact(value) : value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        /agent[_-]?key|authorization|token|secret/i.test(key) ? '<redacted>' : sanitize(entry)
      ])
    );
  }
  return value;
}

/** Create a structured stdout logger at the configured minimum level. */
export function createLogger(minLevel: typeof levels[number]): Logger {
  const min = levels.indexOf(minLevel);
  /** Write one structured log event if it meets the minimum level. */
  function write(level: typeof levels[number], fields: Record<string, unknown>, message: string): void {
    if (levels.indexOf(level) < min) return;
    process.stdout.write(`${JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...sanitize(fields) as Record<string, unknown>
    })}\n`);
  }
  return {
    debug: (fields, message) => write('debug', fields, message),
    info: (fields, message) => write('info', fields, message),
    warn: (fields, message) => write('warn', fields, message),
    error: (fields, message) => write('error', fields, message)
  };
}
