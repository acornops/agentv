import type { HostCollector, HostSnapshot } from '../collectors/types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  capability: 'read';
  version: string;
  timeout_ms: number;
  input_schema: Record<string, unknown>;
}

export const toolDefinitions: ToolDefinition[] = [
  'get_host_summary',
  'list_processes',
  'get_process',
  'list_services',
  'get_service_status',
  'get_logs',
  'search_logs',
  'check_port',
  'list_listening_ports'
].map((name) => ({
  name,
  description: `Read-only VM diagnostic tool: ${name.replaceAll('_', ' ')}.`,
  capability: 'read',
  version: 'v1',
  timeout_ms: 10000,
  input_schema: { type: 'object', additionalProperties: true }
}));

/** Clamp a numeric tool argument to a safe range. */
function limit(input: unknown, fallback: number, max: number): number {
  const parsed = Number(input ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

/** Execute a read-only VM diagnostic tool. */
export async function callTool(collector: HostCollector, name: string, args: Record<string, unknown>): Promise<unknown> {
  const snapshot = name === 'get_logs' || name === 'search_logs' ? null : await collector.collectSnapshot();
  switch (name) {
    case 'get_host_summary':
      return { host: snapshot!.host, metrics: snapshot!.metrics, findings: snapshot!.findings };
    case 'list_processes':
      return { processes: snapshot!.processes.slice(0, limit(args.limit, 50, 200)) };
    case 'get_process':
      return { process: snapshot!.processes.find((proc) => proc.pid === Number(args.pid)) || null };
    case 'list_services':
      return { services: snapshot!.services.slice(0, limit(args.limit, 100, 500)) };
    case 'get_service_status':
      return { service: snapshot!.services.find((service) => service.name === String(args.name || '')) || null };
    case 'list_listening_ports':
      return { listeners: snapshot!.listeners };
    case 'check_port':
      return { listener: snapshot!.listeners.find((listener) => listener.port === Number(args.port)) || null };
    case 'get_logs':
      return collector.getLogs({
        source: typeof args.source === 'string' ? args.source : undefined,
        tailLines: limit(args.tailLines ?? args.tail_lines, 200, 5000),
        limitBytes: limit(args.limitBytes ?? args.limit_bytes, 262144, 1048576)
      });
    case 'search_logs':
      return collector.getLogs({
        source: typeof args.source === 'string' ? args.source : undefined,
        query: String(args.query || ''),
        tailLines: limit(args.tailLines ?? args.tail_lines, 500, 5000),
        limitBytes: limit(args.limitBytes ?? args.limit_bytes, 262144, 1048576)
      });
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

/** Trim snapshot sections until the payload fits the byte budget. */
export function boundSnapshot(snapshot: HostSnapshot, maxBytes: number): HostSnapshot {
  const copy = structuredClone(snapshot);
  while (Buffer.byteLength(JSON.stringify(copy)) > maxBytes && copy.logs.length > 0) {
    copy.logs.pop();
  }
  while (Buffer.byteLength(JSON.stringify(copy)) > maxBytes && copy.processes.length > 10) {
    copy.processes.pop();
  }
  return copy;
}
