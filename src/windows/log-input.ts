import { ToolExecutionError } from '../tools/errors.js';
import type { LogChannel, WindowsLogsInput } from './types.js';

/** Validate local log bounds and normalize the window against an explicit clock. */
export function validateWindowsLogInput(input: WindowsLogsInput, channels: readonly LogChannel[], now: number): { since: string; until: string } {
  if (!['Application', 'System'].includes(input.channel) || !channels.includes(input.channel)) throw new ToolExecutionError('PERMISSION_DENIED', 'Log channel is not locally allowed');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows log row limit is invalid');
  const until = input.until ? Date.parse(input.until) : now; const since = input.since ? Date.parse(input.since) : until - 3600_000;
  if (!Number.isFinite(since) || !Number.isFinite(until) || until < since || until - since > 86400_000 || until > now + 60_000) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows logs require a valid window no larger than 24 hours');
  if (!Number.isInteger(input.byte_limit) || input.byte_limit < 1024 || input.byte_limit > 1024 * 1024) throw new ToolExecutionError('INVALID_ARGUMENTS', 'Windows log byte limit is invalid');
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
}
