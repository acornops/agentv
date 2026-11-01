// Allowlisted first-call diagnostic only; never serialize error messages or results.
import { WINDOWS_HOST_COLLECTOR_TIMEOUT_MS } from '../../dist/windows/runner.js';
const names = new Set(['trust_start', 'trust_end', 'trust_failed', 'spawn_before', 'spawn_after', 'spawn', 'stdin_finish', 'stage', 'stdout_first', 'stderr_first', 'timer_fired', 'kill_requested', 'exit', 'close']);
const codes = new Set(['TOOL_TIMEOUT', 'COMMAND_UNAVAILABLE', 'HOST_UNAVAILABLE', 'OUTPUT_TOO_LARGE', 'PERMISSION_DENIED']);
const numbers = ['stdout_bytes', 'stderr_bytes', 'stdout_first_ms', 'stdout_last_ms', 'stderr_first_ms', 'stderr_last_ms'];
const bounded = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
export function createFirstCallEvidence(allowedStages) {
  const stages = new Set(['spawn_pending', 'spawned', ...allowedStages]);
  const report = { production_timeout_ms: WINDOWS_HOST_COLLECTOR_TIMEOUT_MS, events: [] };
  return {
    observe(event) {
      if (report.events.length >= 64 || !names.has(event?.event) || event.collector !== 'host' || !bounded(event.at_ms)) return;
      const safe = { event: event.event, collector: 'host', at_ms: event.at_ms };
      if (stages.has(event.stage)) safe.stage = event.stage;
      for (const key of numbers) if (bounded(event[key])) safe[key] = event[key];
      if (event.exit_code === null || bounded(event.exit_code)) safe.exit_code = event.exit_code;
      report.events.push(safe);
    },
    fail(error) {
      const failure = { code: codes.has(error?.toolCode) ? error.toolCode : 'DIAGNOSTIC_FAILURE' };
      if (stages.has(error?.data?.stage)) failure.stage = error.data.stage;
      if (bounded(error?.data?.elapsed_ms)) failure.elapsed_ms = error.data.elapsed_ms;
      report.failure ??= failure;
    },
    cleanupFailed() { report.cleanup_failure = true; },
    result() { return structuredClone(report); },
  };
}
