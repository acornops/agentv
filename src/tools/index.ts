import { z } from 'zod';
import type { ActionClient } from '../actions/types.js';
import type { HostAdapter } from '../adapters/types.js';
import { ToolExecutionError } from './errors.js';
import { boundedProjection, fullToolResultOutputSchema } from './model-context.js';
import { toolRegistry, type ToolDefinition } from './registry.js';

export const SERVICE_UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,254}\.service$/;
const exactUnit = z.string().min(9).max(263).regex(SERVICE_UNIT, 'Must be an exact .service unit name');
const empty = z.object({}).strict();
const objectSchema = (required: string[], properties: Record<string, unknown>) => ({ type: 'object', required, properties, additionalProperties: false });
const output = (required: string[], properties: Record<string, unknown>) => fullToolResultOutputSchema(objectSchema(required, properties));
const nullableString = { type: ['string', 'null'] };
const healthOutput = objectSchema(['collector', 'status', 'duration_ms'], {
  collector: { type: 'string' }, status: { enum: ['ok', 'partial', 'unavailable', 'permission_denied', 'timed_out', 'unsupported'] },
  message: { type: 'string' }, duration_ms: { type: 'integer', minimum: 0 },
});
const listOutput = (itemSchema: Record<string, unknown>, extra: Record<string, unknown> = {}) => output(
  ['items', 'original_count', 'omitted_count', 'health', ...Object.keys(extra)],
  { items: { type: 'array', items: itemSchema }, original_count: { type: 'integer', minimum: 0 }, omitted_count: { type: 'integer', minimum: 0 }, health: healthOutput, ...extra },
);
const filesystemOutput = objectSchema(['filesystem', 'mount', 'type', 'total_bytes', 'used_bytes', 'free_bytes', 'used_percent', 'inode_used_percent', 'read_only'], {
  filesystem: { type: 'string' }, mount: { type: 'string' }, type: { type: 'string' }, total_bytes: { type: 'number', minimum: 0 }, used_bytes: { type: 'number', minimum: 0 }, free_bytes: { type: 'number', minimum: 0 },
  used_percent: { type: 'number' }, inode_used_percent: { type: ['number', 'null'] }, read_only: { type: 'boolean' },
});
const processOutput = objectSchema(['pid', 'ppid', 'user', 'state', 'name', 'cpu_percent', 'memory_bytes', 'memory_percent', 'start_time', 'executable', 'command_line'], {
  pid: { type: 'integer', minimum: 1 }, ppid: { type: 'integer', minimum: 0 }, user: { type: 'string' }, state: { type: 'string' }, name: { type: 'string' },
  cpu_percent: { type: 'number', minimum: 0 }, memory_bytes: { type: 'number', minimum: 0 }, memory_percent: { type: 'number', minimum: 0 }, start_time: nullableString, executable: nullableString, command_line: { type: 'string' },
});
const serviceSummaryOutput = objectSchema(['unit', 'description', 'load_state', 'active_state', 'sub_state'], {
  unit: { type: 'string' }, description: { type: 'string' }, load_state: { type: 'string' }, active_state: { type: 'string' }, sub_state: { type: 'string' },
});
const listenerOutput = objectSchema(['protocol', 'address', 'port', 'pid', 'process', 'ownership_status'], {
  protocol: { enum: ['tcp', 'udp'] }, address: { type: 'string' }, port: { type: 'integer', minimum: 1, maximum: 65535 }, pid: { type: ['integer', 'null'] }, process: nullableString,
  ownership_status: { enum: ['available', 'permission_denied', 'unavailable'] },
});
const logEntryOutput = objectSchema(['cursor', 'timestamp', 'priority', 'unit', 'pid', 'identifier', 'message'], {
  cursor: nullableString, timestamp: { type: 'string' }, priority: { type: ['integer', 'null'], minimum: 0, maximum: 7 }, unit: nullableString,
  pid: { type: ['integer', 'null'] }, identifier: nullableString, message: { type: 'string' },
});
const restartStateOutput = objectSchema(['active_state', 'sub_state', 'invocation_id'], {
  active_state: { type: 'string' }, sub_state: { type: 'string' }, invocation_id: nullableString,
});

const filesystemInput = z.object({ mount: z.string().min(1).max(4096).optional(), include_pseudo: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }).strict();
const processesInput = z.object({ sort_by: z.enum(['cpu', 'memory', 'pid', 'start_time']).default('cpu'), order: z.enum(['asc', 'desc']).default('desc'), user: z.string().min(1).max(128).optional(), query: z.string().min(1).max(256).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const processInput = z.object({ pid: z.number().int().positive() }).strict();
const servicesInput = z.object({ state: z.enum(['all', 'active', 'failed', 'inactive']).default('all'), query: z.string().min(1).max(256).optional(), limit: z.number().int().min(1).max(200).default(100) }).strict();
const serviceInput = z.object({ unit: exactUnit }).strict();
const logsInput = z.object({
  unit: exactUnit.optional(), priority: z.number().int().min(0).max(7).optional(),
  since: z.string().datetime({ offset: true }).optional(), until: z.string().datetime({ offset: true }).optional(),
  query: z.string().min(1).max(512).optional(), cursor: z.string().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(500).default(100), byte_limit: z.number().int().min(1024).max(1024 * 1024).default(256 * 1024),
}).strict().superRefine((value, context) => {
  if (value.since && value.until && Date.parse(value.since) > Date.parse(value.until)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['until'], message: 'until must not be earlier than since' });
});
const listenersInput = z.object({ protocol: z.enum(['tcp', 'udp']).optional(), port: z.number().int().min(1).max(65535).optional(), address: z.string().min(1).max(256).optional(), process_query: z.string().min(1).max(256).optional(), limit: z.number().int().min(1).max(200).default(100) }).strict();
const restartInput = z.object({ unit: exactUnit, reason: z.string().min(1).max(512).refine((value) => value.trim().length > 0, 'reason must not be blank'), expected_active_state: z.string().min(1).max(64), expected_sub_state: z.string().min(1).max(64), expected_invocation_id: z.string().min(1).max(128).optional() }).strict();
type FilesystemInput = z.infer<typeof filesystemInput>;
type ProcessesInput = z.infer<typeof processesInput>;
type ServicesInput = z.infer<typeof servicesInput>;
type LogsInput = z.infer<typeof logsInput>;
type ListenersInput = z.infer<typeof listenersInput>;
type ProcessInput = z.infer<typeof processInput>;
type ServiceInput = z.infer<typeof serviceInput>;
type RestartInput = z.infer<typeof restartInput>;

/** Register the complete, intentionally breaking AgentV v2 tool catalog. */
export function registerAllTools(host: HostAdapter, actions: ActionClient): void {
  toolRegistry.resetForTests();
  const hostScope = () => ({ type: 'host' as const });
  const define = <TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>) => toolRegistry.register(definition);
  define({ name: 'get_host_summary', description: 'Return bounded Linux host identity, load, CPU, memory, swap, pressure availability, and collector health.', capability: 'read', schema: empty, outputSchema: output(['hostname', 'distro', 'kernel', 'architecture', 'boot_id', 'uptime_seconds', 'load', 'cpu', 'memory', 'swap', 'pressure_available', 'collector_health'], { hostname: { type: 'string' }, distro: objectSchema(['id', 'version', 'pretty_name'], { id: { type: 'string' }, version: { type: 'string' }, pretty_name: { type: 'string' } }), kernel: { type: 'string' }, architecture: { type: 'string' }, boot_id: { type: 'string' }, uptime_seconds: { type: 'number', minimum: 0 }, load: objectSchema(['one', 'five', 'fifteen'], { one: { type: 'number' }, five: { type: 'number' }, fifteen: { type: 'number' } }), cpu: objectSchema(['usage_percent', 'sampled_ms'], { usage_percent: { type: ['number', 'null'] }, sampled_ms: { type: 'integer', minimum: 0 } }), memory: objectSchema(['total_bytes', 'available_bytes', 'used_bytes', 'used_percent'], { total_bytes: { type: 'number' }, available_bytes: { type: 'number' }, used_bytes: { type: 'number' }, used_percent: { type: 'number' } }), swap: objectSchema(['total_bytes', 'free_bytes', 'used_bytes', 'used_percent'], { total_bytes: { type: 'number' }, free_bytes: { type: 'number' }, used_bytes: { type: 'number' }, used_percent: { type: 'number' } }), pressure_available: { type: 'boolean' }, collector_health: { type: 'array', items: healthOutput } }), timeoutMs: 5000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (_input, context) => host.getHostSummary(context.signal), projectForModel: (result) => boundedProjection('get_host_summary', result, `Host ${result.hostname} is running ${result.distro.pretty_name}.`) });
  define({ name: 'list_filesystems', description: 'List bounded mounted filesystem byte and inode capacity with read-only state.', capability: 'read', schema: filesystemInput, outputSchema: listOutput(filesystemOutput, { truncated: { type: 'boolean' } }), timeoutMs: 8000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (input: FilesystemInput, context) => host.listFilesystems(input, context.signal), projectForModel: (result) => boundedProjection('list_filesystems', result, `Returned ${result.items.length} filesystems; ${result.omitted_count} omitted.`) });
  define({ name: 'list_processes', description: 'List bounded redacted Linux process summaries with exact sorting and filters.', capability: 'read', schema: processesInput, outputSchema: listOutput(processOutput), timeoutMs: 8000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (input: ProcessesInput, context) => host.listProcesses(input, context.signal), projectForModel: (result) => boundedProjection('list_processes', result, `Returned ${result.items.length} processes; ${result.omitted_count} omitted.`) });
  define({ name: 'get_process', description: 'Get one exact process by positive PID without collecting environment variables.', capability: 'read', schema: processInput, outputSchema: fullToolResultOutputSchema(processOutput), timeoutMs: 5000, artifactPolicy: 'never', version: '2.0.0', scopeResolver: hostScope, handler: (input: ProcessInput, context) => host.getProcess(input.pid, context.signal), projectForModel: (result) => boundedProjection('get_process', result, `Process ${result.pid} is ${result.state}.`) });
  define({ name: 'list_services', description: 'List bounded systemd service unit summaries by state and query.', capability: 'read', schema: servicesInput, outputSchema: listOutput(serviceSummaryOutput), timeoutMs: 10000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (input: ServicesInput, context) => host.listServices(input, context.signal), projectForModel: (result) => boundedProjection('list_services', result, `Returned ${result.items.length} services; ${result.omitted_count} omitted.`) });
  define({ name: 'get_service', description: 'Get one exact systemd service and capability-safe restart preconditions.', capability: 'read', schema: serviceInput, outputSchema: output(['unit', 'description', 'load_state', 'active_state', 'sub_state', 'unit_file_state', 'main_pid', 'result', 'exec_main_status', 'restart_count', 'invocation_id', 'fragment_path', 'active_enter_timestamp', 'inactive_enter_timestamp', 'restart_preconditions'], { ...serviceSummaryOutput.properties as Record<string, unknown>, unit_file_state: nullableString, main_pid: { type: ['integer', 'null'] }, result: nullableString, exec_main_status: { type: ['integer', 'null'] }, restart_count: { type: 'integer', minimum: 0 }, invocation_id: nullableString, fragment_path: nullableString, active_enter_timestamp: nullableString, inactive_enter_timestamp: nullableString, restart_preconditions: objectSchema(['active_state', 'sub_state'], { active_state: { type: 'string' }, sub_state: { type: 'string' }, invocation_id: { type: 'string' } }) }), timeoutMs: 8000, artifactPolicy: 'never', version: '2.0.0', scopeResolver: (input: ServiceInput) => ({ type: 'service', unit: input.unit }), handler: (input: ServiceInput, context) => host.getService(input.unit, context.signal), projectForModel: (result) => boundedProjection('get_service', result, `${result.unit} is ${result.active_state}/${result.sub_state}.`) });
  define({ name: 'query_logs', description: 'Query bounded normalized journald entries from locally allowed service units.', capability: 'read', schema: logsInput, outputSchema: output(['entries', 'next_cursor', 'returned_count', 'original_count', 'byte_count', 'truncated', 'health'], { entries: { type: 'array', items: logEntryOutput }, next_cursor: nullableString, returned_count: { type: 'integer', minimum: 0 }, original_count: { type: 'integer', minimum: 0 }, byte_count: { type: 'integer', minimum: 0 }, truncated: { type: 'boolean' }, health: healthOutput }), timeoutMs: 12000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (input: LogsInput, context) => host.queryLogs(input, context.signal), projectForModel: (result) => boundedProjection('query_logs', result, `Returned ${result.returned_count} journal entries${result.truncated ? ' with truncation' : ''}.`) });
  define({ name: 'list_listeners', description: 'List bounded TCP or UDP listeners with partial ownership represented explicitly.', capability: 'read', schema: listenersInput, outputSchema: listOutput(listenerOutput, { partial: { type: 'boolean' } }), timeoutMs: 8000, artifactPolicy: 'if_detailed', version: '2.0.0', scopeResolver: hostScope, handler: (input: ListenersInput, context) => host.listListeners(input, context.signal), projectForModel: (result) => boundedProjection('list_listeners', result, `Returned ${result.items.length} listeners; ownership partial=${result.partial}.`) });
  define({ name: 'restart_service', description: 'Restart one exact locally allowlisted systemd service through the privileged helper after checking supplied preconditions.', capability: 'write', schema: restartInput, outputSchema: output(['operation_id', 'unit', 'outcome', 'before', 'after', 'started_at', 'completed_at', 'systemd_job_result'], { operation_id: { type: 'string' }, unit: { type: 'string' }, outcome: { enum: ['success', 'failed', 'not_started', 'unknown'] }, before: restartStateOutput, after: { oneOf: [restartStateOutput, { type: 'null' }] }, started_at: { type: 'string' }, completed_at: nullableString, systemd_job_result: nullableString }), timeoutMs: 30_000, artifactPolicy: 'always', version: '2.0.0', scopeResolver: (input: RestartInput) => ({ type: 'service', unit: input.unit }), handler: async (input: RestartInput, context) => {
    const result = await actions.restart({ protocol_version: 1, action: 'restart_service', operation_id: context.operationId, ...input }, context.signal);
    if (result.outcome === 'unknown') throw new ToolExecutionError('HOST_UNAVAILABLE', 'Service restart outcome is unknown', { outcome: 'unknown', operationId: context.operationId, receipt: result });
    if (result.outcome === 'not_started') throw new ToolExecutionError('PRECONDITION_FAILED', 'Service restart was not started', { outcome: 'not_started', operationId: context.operationId, receipt: result });
    if (result.outcome === 'failed') throw new ToolExecutionError('HOST_UNAVAILABLE', 'Service restart failed verification', { outcome: 'failed', operationId: context.operationId, receipt: result });
    return result;
  }, projectForModel: (result) => boundedProjection('restart_service', result, `Restart ${result.outcome} for ${result.unit}; verify with get_service.`) });
}
