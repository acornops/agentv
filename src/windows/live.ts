import { z } from 'zod';
import { ToolExecutionError } from '../tools/errors.js';
import { redactValue } from '../redaction.js';
import { WindowsCollectorRunner, type CollectorRunner } from './runner.js';
import type { ScriptId } from './scripts.js';
import { hostSchema, listenerSchema, logSchema, processSchema, serviceSchema, volumeSchema, type LogChannel, type WindowsHost, type WindowsList, type WindowsLogsInput, type WindowsQuery } from './types.js';
import { isFailedService } from './service-health.js';

/** Collect local native Windows facts with explicit partial/denied evidence. */
export class WindowsLiveHost implements WindowsHost {
  constructor(private readonly channels: readonly LogChannel[], private readonly runner: CollectorRunner = new WindowsCollectorRunner()) {}
  private async collect<T>(id: ScriptId, schema: z.ZodType<T>, input: WindowsQuery, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<WindowsList<T>> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows row limit must be between 1 and 1000');
    const started = Date.now(); const result = await this.runner.run(id, data, signal);
    let items: T[]; try { items = z.array(schema).parse(result.items); } catch { throw new ToolExecutionError('HOST_UNAVAILABLE', 'Windows collector returned invalid native fields'); }
    // Denied/unavailable results must not contain authoritative rows.
    if (result.status === 'permission_denied' || result.status === 'unavailable') items = [];
    const original = items.length + (result.truncated ? 1 : 0); const retained = items.slice(0, input.limit);
    return { items: redactValue(retained) as T[], original_count: original, omitted_count: original - retained.length, health: { collector: `windows_${id}`, status: result.truncated && result.status === 'ok' ? 'partial' : result.status, duration_ms: Date.now() - started } };
  }
  private requireEvidence(status: string): void { if (status !== 'ok') throw new ToolExecutionError(status === 'permission_denied' ? 'PERMISSION_DENIED' : 'HOST_UNAVAILABLE', 'Windows native evidence is unavailable or incomplete'); }
  async getHostSummary(signal?: AbortSignal) { const result = await this.collect('host', hostSchema, { limit: 1 }, {}, signal); this.requireEvidence(result.health.status); const host = result.items[0]; if (!host || !['20348', '26100'].includes(host.build)) throw new ToolExecutionError('HOST_UNAVAILABLE', 'Only Windows Server 2022/2025 builds are supported'); return { ...host, collector_health: [result.health] }; }
  async listFilesystems(input: WindowsQuery, signal?: AbortSignal) { return this.collect('volumes', volumeSchema, input, {}, signal); }
  async listProcesses(input: WindowsQuery, signal?: AbortSignal) { const result = await this.collect('processes', processSchema, { limit: 1000 }, {}, signal); return this.filter(result, input, (item) => item.name); }
  async getProcess(pid: number, signal?: AbortSignal) { const result = await this.collect('processes', processSchema, { limit: 1 }, { pid }, signal); this.requireEvidence(result.health.status); const item = result.items[0]; if (!item) throw new ToolExecutionError('RESOURCE_NOT_FOUND', 'Process not found'); return item; }
  async listServices(input: WindowsQuery & { state?: 'all' | 'Running' | 'Stopped' | 'failed' }, signal?: AbortSignal) {
    const result = await this.collect('services', serviceSchema, { limit: 1000 }, {}, signal);
    result.items = result.items.map((item) => ({ ...item, service_specific_exit_code: item.exit_code === 1066 ? item.service_specific_exit_code : null }));
    result.items = result.items.filter((item) => !input.state || input.state === 'all' || (input.state === 'failed' ? isFailedService(item) : item.state === input.state));
    return this.filter(result, input, (item) => `${item.name} ${item.display_name}`);
  }
  async getService(name: string, signal?: AbortSignal) { const result = await this.collect('services', serviceSchema, { limit: 1 }, { name }, signal); this.requireEvidence(result.health.status); const item = result.items[0]; if (!item) throw new ToolExecutionError('RESOURCE_NOT_FOUND', 'Service not found'); return { ...item, service_specific_exit_code: item.exit_code === 1066 ? item.service_specific_exit_code : null }; }
  async listListeners(input: WindowsQuery & { protocol?: 'tcp' | 'udp'; port?: number }, signal?: AbortSignal) { const result = await this.collect('listeners', listenerSchema, { limit: 1000 }, { protocol: input.protocol }, signal); result.items = result.items.filter((item) => (!input.protocol || item.protocol === input.protocol) && (!input.port || item.port === input.port)); return this.filter(result, input, (item) => item.address); }
  private filter<T>(result: WindowsList<T>, input: WindowsQuery, text: (item: T) => string): WindowsList<T> {
    const filtered = result.items.filter((item) => !input.query || text(item).toLowerCase().includes(input.query.toLowerCase()));
    return { ...result, items: filtered.slice(0, input.limit), original_count: filtered.length + result.omitted_count, omitted_count: result.omitted_count + Math.max(0, filtered.length - input.limit) };
  }
  async queryLogs(input: WindowsLogsInput, signal?: AbortSignal) {
    if (!['Application', 'System'].includes(input.channel) || !this.channels.includes(input.channel)) throw new ToolExecutionError('PERMISSION_DENIED', 'Log channel is not locally allowed');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows log row limit is invalid');
    const until = input.until ? Date.parse(input.until) : Date.now(); const since = input.since ? Date.parse(input.since) : until - 3600_000;
    if (!Number.isFinite(since) || !Number.isFinite(until) || until < since || until - since > 86400_000 || until > Date.now() + 60_000) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows logs require a valid window no larger than 24 hours');
    if (!Number.isInteger(input.byte_limit) || input.byte_limit < 1024 || input.byte_limit > 1024 * 1024) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows log byte limit is invalid');
    const result = await this.collect('events', logSchema, { limit: 1000 }, { channel: input.channel, since: new Date(since).toISOString(), until: new Date(until).toISOString(), limit: input.limit, byte_limit: input.byte_limit }, signal);
    const filtered = result.items.filter((item) => item.channel === input.channel && (!input.query || item.message.toLowerCase().includes(input.query.toLowerCase())));
    const entries = filtered.slice(0, input.limit); while (entries.length && Buffer.byteLength(JSON.stringify(entries)) > input.byte_limit) entries.pop();
    return { entries, returned_count: entries.length, original_count: filtered.length, byte_count: Buffer.byteLength(JSON.stringify(entries)), truncated: result.omitted_count > 0 || entries.length < filtered.length || result.health.status !== 'ok', health: result.health };
  }
  async stop(): Promise<void> { await this.runner.stop(); }
}
