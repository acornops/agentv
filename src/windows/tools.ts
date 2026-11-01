import { z } from 'zod';
import { fullToolResultOutputSchema, boundedProjection } from '../tools/model-context.js';
import { toolRegistry } from '../tools/registry.js';
import { hostSchema, healthSchema, listenerSchema, logSchema, processSchema, serviceSchema, volumeSchema, type WindowsHost } from './types.js';

const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);
const query = z.string().min(1).max(256).optional();
const list = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), original_count: z.number().int().nonnegative(), omitted_count: z.number().int().nonnegative(), health: healthSchema }).strict();

/** Register only native Windows read contracts; no policy can add a write tool. */
export function registerWindowsTools(host: WindowsHost): void {
  toolRegistry.resetForTests();
  const define = <I, O>(name: string, schema: z.ZodType<I>, result: z.ZodType<O>, handler: (input: I, signal: AbortSignal) => Promise<O>) => toolRegistry.register<I, O>({ name, description: `Read bounded native Windows ${name.replaceAll('_', ' ')} facts. Synthetic mode is explicitly configured; event channels require a local allowlist.`, capability: 'read', schema, outputSchema: fullToolResultOutputSchema(z.toJSONSchema(result) as Record<string, unknown>), timeoutMs: 12000, artifactPolicy: 'if_detailed', version: '1.0.0', scopeResolver: () => ({ type: 'host' }), handler: (input, context) => handler(input, context.signal), projectForModel: (data) => boundedProjection(name, data, `Windows ${name} completed.`) });
  define('get_host_summary', z.object({}).strict(), hostSchema, (_input, signal) => host.getHostSummary(signal));
  define('list_filesystems', z.object({ limit: limit(100, 50) }).strict(), list(volumeSchema), (input, signal) => host.listFilesystems(input, signal));
  define('list_processes', z.object({ query, limit: limit(100, 50) }).strict(), list(processSchema), (input, signal) => host.listProcesses(input, signal));
  define('get_process', z.object({ pid: z.number().int().positive().max(4294967295) }).strict(), processSchema, (input, signal) => host.getProcess(input.pid, signal));
  define('list_services', z.object({ query, state: z.enum(['all', 'Running', 'Stopped', 'failed']).default('all'), limit: limit(200, 100) }).strict(), list(serviceSchema), (input, signal) => host.listServices(input, signal));
  define('get_service', z.object({ name: z.string().min(1).max(256).refine((name) => !/[\u0000-\u001f/\\]/.test(name), 'Must be one exact native service name') }).strict(), serviceSchema, (input, signal) => host.getService(input.name, signal));
  define('list_listeners', z.object({ protocol: z.enum(['tcp', 'udp']).optional(), port: z.number().int().min(1).max(65535).optional(), limit: limit(200, 100) }).strict(), list(listenerSchema), (input, signal) => host.listListeners(input, signal));
  define('query_logs', z.object({ channel: z.enum(['Application', 'System']), since: z.string().datetime({ offset: true }).optional(), until: z.string().datetime({ offset: true }).optional(), query, limit: limit(500, 100), byte_limit: limit(1024 * 1024, 256 * 1024).refine((bytes) => bytes >= 1024) }).strict(), z.object({ entries: z.array(logSchema), returned_count: z.number().int().nonnegative(), original_count: z.number().int().nonnegative(), byte_count: z.number().int().nonnegative(), truncated: z.boolean(), health: healthSchema }).strict(), (input, signal) => host.queryLogs(input, signal));
}
