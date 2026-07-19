import { ToolExecutionError } from '../tools/errors.js';
import { runCommand } from './command-runner.js';
import type { CollectorHealth, ServiceDetail, ServiceSummary } from './types.js';
type CommandRunner = typeof runCommand;

function properties(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\n').flatMap((line) => { const index = line.indexOf('='); return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : []; }));
}

/** Parse stable, no-legend systemctl unit rows. */
export function parseSystemdUnits(text: string): ServiceSummary[] {
  return text.split('\n').flatMap((line): ServiceSummary[] => {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    return match ? [{ unit: match[1], load_state: match[2], active_state: match[3], sub_state: match[4], description: match[5] }] : [];
  });
}

/** Query systemd with fixed property sets and exact validated unit names. */
export class SystemdAdapter {
  constructor(private readonly command: CommandRunner = runCommand) {}

  async list(input: { state: string; query?: string; limit: number }, signal?: AbortSignal): Promise<{ items: ServiceSummary[]; original_count: number; omitted_count: number; health: CollectorHealth }> {
    const started = Date.now();
    const result = await this.command('/bin/systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'], { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, signal });
    let items = parseSystemdUnits(result.stdout);
    if (input.state !== 'all') items = items.filter((item) => item.active_state === input.state);
    if (input.query) { const query = input.query.toLowerCase(); items = items.filter((item) => `${item.unit} ${item.description}`.toLowerCase().includes(query)); }
    items.sort((a, b) => a.unit.localeCompare(b.unit));
    const original = items.length;
    return { items: items.slice(0, input.limit), original_count: original, omitted_count: Math.max(0, original - input.limit), health: { collector: 'systemd', status: 'ok', duration_ms: Date.now() - started } };
  }

  async get(unit: string, signal?: AbortSignal): Promise<ServiceDetail> {
    const keys = ['Id', 'Description', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'MainPID', 'Result', 'ExecMainStatus', 'NRestarts', 'InvocationID', 'FragmentPath', 'ActiveEnterTimestamp', 'InactiveEnterTimestamp'];
    const result = await this.command('/bin/systemctl', ['show', unit, '--no-pager', ...keys.map((key) => `--property=${key}`)], { timeoutMs: 8000, maxBytes: 256 * 1024, signal });
    const value = properties(result.stdout);
    if (!value.Id || value.LoadState === 'not-found') throw new ToolExecutionError('RESOURCE_NOT_FOUND', `Service ${unit} was not found`);
    const invocation = value.InvocationID || null;
    return {
      unit: value.Id, description: value.Description || '', load_state: value.LoadState || 'unknown', active_state: value.ActiveState || 'unknown', sub_state: value.SubState || 'unknown',
      unit_file_state: value.UnitFileState || null, main_pid: Number(value.MainPID) || null, result: value.Result || null,
      exec_main_status: value.ExecMainStatus === '' ? null : Number(value.ExecMainStatus), restart_count: Number(value.NRestarts) || 0,
      invocation_id: invocation, fragment_path: value.FragmentPath || null, active_enter_timestamp: value.ActiveEnterTimestamp || null, inactive_enter_timestamp: value.InactiveEnterTimestamp || null,
      restart_preconditions: { active_state: value.ActiveState || 'unknown', sub_state: value.SubState || 'unknown', ...(invocation ? { invocation_id: invocation } : {}) },
    };
  }
}
