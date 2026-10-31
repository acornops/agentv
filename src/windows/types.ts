import { z } from 'zod';
import type { CollectorHealth } from '../adapters/types.js';

const count = z.number().int().nonnegative();
const amount = z.number().nonnegative();
const text = z.string().max(4096);
export const serviceSchema = z.object({ name: text, display_name: text, state: text.nullable(), start_mode: text.nullable(), process_id: count.nullable(), exit_code: count.nullable(), service_specific_exit_code: count.nullable() }).strict();
export const volumeSchema = z.object({ volume: text, filesystem: text.nullable(), total_bytes: amount.nullable(), free_bytes: amount.nullable(), used_bytes: amount.nullable(), used_percent: amount.nullable() }).strict();
export const processSchema = z.object({ pid: count, ppid: count.nullable(), name: text, cpu_percent: amount.nullable(), memory_bytes: amount.nullable(), start_time: text.nullable() }).strict();
export const listenerSchema = z.object({ protocol: z.enum(['tcp', 'udp']), address: text, port: count.max(65535), pid: count.nullable(), ownership_status: z.enum(['available', 'unavailable', 'permission_denied']) }).strict();
export const logSchema = z.object({ channel: z.enum(['Application', 'System']), record_id: count, timestamp: text, level: count.nullable(), provider: text.nullable(), event_id: count, message: z.string().max(16384) }).strict();
export const healthSchema = z.object({ collector: z.string(), status: z.enum(['ok', 'partial', 'unavailable', 'permission_denied', 'timed_out', 'unsupported']), duration_ms: count, message: z.string().optional() }).strict();
export const hostSchema = z.object({ os_family: z.literal('windows'), hostname: text, version: text, build: text, product_type: z.number().int().min(2).max(3), architecture: text, system_volume: text, uptime_seconds: amount, cpu: z.object({ usage_percent: amount.max(100).nullable(), sampled_ms: count }).strict(), memory: z.object({ total_bytes: amount, available_bytes: amount, used_bytes: amount, used_percent: amount.max(100) }).strict(), collector_health: z.array(healthSchema) }).strict();
export type WindowsService = z.infer<typeof serviceSchema>;
export type WindowsHostSummary = z.infer<typeof hostSchema>;
export type WindowsVolume = z.infer<typeof volumeSchema>;
export type WindowsProcess = z.infer<typeof processSchema>;
export type WindowsListener = z.infer<typeof listenerSchema>;
export type WindowsLog = z.infer<typeof logSchema>;
export type LogChannel = WindowsLog['channel'];
export interface WindowsList<T> { items: T[]; original_count: number; omitted_count: number; health: CollectorHealth; }
export interface WindowsLogs { entries: WindowsLog[]; returned_count: number; original_count: number; byte_count: number; truncated: boolean; health: CollectorHealth; }
export interface WindowsQuery { limit: number; query?: string; }
export interface WindowsLogsInput extends WindowsQuery { channel: LogChannel; since?: string; until?: string; byte_limit: number; }
export interface WindowsHost {
  getHostSummary(signal?: AbortSignal): Promise<WindowsHostSummary>;
  listFilesystems(input: WindowsQuery, signal?: AbortSignal): Promise<WindowsList<WindowsVolume>>;
  listProcesses(input: WindowsQuery, signal?: AbortSignal): Promise<WindowsList<WindowsProcess>>;
  getProcess(pid: number, signal?: AbortSignal): Promise<WindowsProcess>;
  listServices(input: WindowsQuery & { state?: 'all' | 'Running' | 'Stopped' | 'failed' }, signal?: AbortSignal): Promise<WindowsList<WindowsService>>;
  getService(name: string, signal?: AbortSignal): Promise<WindowsService>;
  listListeners(input: WindowsQuery & { protocol?: 'tcp' | 'udp'; port?: number }, signal?: AbortSignal): Promise<WindowsList<WindowsListener>>;
  queryLogs(input: WindowsLogsInput, signal?: AbortSignal): Promise<WindowsLogs>;
  stop(): Promise<void>;
}
