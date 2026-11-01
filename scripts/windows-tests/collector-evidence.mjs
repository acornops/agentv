// Owned SCM test fixture only. Never retain raw output, arguments or identities.
const eventNames = new Set(['trust_start', 'trust_end', 'trust_failed', 'spawn_before', 'spawn_after', 'spawn', 'stdin_finish', 'stage', 'stdout_first', 'stderr_first', 'timer_fired', 'kill_requested', 'exit', 'close']);
const codes = new Set(['TOOL_TIMEOUT', 'COMMAND_UNAVAILABLE', 'HOST_UNAVAILABLE', 'OUTPUT_TOO_LARGE', 'PERMISSION_DENIED', 'INVALID_ARGUMENTS']);
const numericFields = ['stdout_bytes', 'stderr_bytes', 'stdout_first_ms', 'stdout_last_ms', 'stderr_first_ms', 'stderr_last_ms'];
const boundedNumber = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;

export async function collectServiceEvidence({ createHost, allowedScripts, allowedStages, clock = () => performance.now() }) {
  const scripts = new Set(allowedScripts); const stages = new Set(['spawn_pending', 'spawned', ...allowedStages]);
  const evidence = { collections: {}, operations: [] };
  let operation = 'initialization'; let started = clock(); let active; let host;
  const observe = (event) => {
    if (!active || active.events.length >= 64 || !eventNames.has(event?.event) || !scripts.has(event.collector) || !boundedNumber(event.at_ms)) return;
    const safe = { event: event.event, collector: event.collector, at_ms: event.at_ms };
    if (stages.has(event.stage)) safe.stage = event.stage;
    for (const name of numericFields) if (boundedNumber(event[name])) safe[name] = event[name];
    if (event.exit_code === null || boundedNumber(event.exit_code)) safe.exit_code = event.exit_code;
    active.events.push(safe);
  };
  const execute = async (name, action) => {
    operation = name; started = clock(); active = { operation: name, elapsed_ms: 0, events: [] }; evidence.operations.push(active);
    try {
      const result = await action();
      // Successful calls retain duration only; the failed call keeps at most
      // 64 detailed events, so seven operations cannot multiply the trace cap.
      active.events = [];
      return result;
    } finally { active.elapsed_ms = Math.max(0, Math.round(clock() - started)); }
  };
  try {
    host = createHost(observe);
    const summary = await execute('host', () => host.getHostSummary());
    evidence.host = { os: summary.os_family, productType: summary.product_type, build: summary.build };
    for (const [name, action] of [
      ['volumes', () => host.listFilesystems({ limit: 1000 })],
      ['processes', () => host.listProcesses({ limit: 1000 })],
      ['services', () => host.listServices({ limit: 1000 })],
      ['listeners', () => host.listListeners({ limit: 1000 })],
      ['application', () => host.queryLogs({ channel: 'Application', limit: 10, byte_limit: 16384 })],
      ['system', () => host.queryLogs({ channel: 'System', limit: 10, byte_limit: 16384 })],
    ]) {
      const result = await execute(name, action);
      evidence.collections[name] = { status: result.health.status, count: (result.items || result.entries).length };
    }
  } catch (error) {
    const data = error?.data || {};
    const failure = { operation, code: codes.has(error?.toolCode) ? error.toolCode : 'FIXTURE_FAILURE', elapsed_ms: Math.max(0, Math.round(clock() - started)) };
    const last = active?.events.at(-1);
    if (scripts.has(data.collector)) failure.collector = data.collector;
    else if (last?.collector) failure.collector = last.collector;
    if (stages.has(data.stage)) failure.stage = data.stage;
    if (boundedNumber(data.elapsed_ms)) failure.runner_elapsed_ms = data.elapsed_ms;
    for (const name of ['stdout_bytes', 'stderr_bytes']) if (boundedNumber(data[name])) failure[name] = data[name];
    evidence.failure = failure;
  } finally {
    if (host) {
      try { await host.stop(); }
      catch { evidence.cleanup_failure = 'FIXTURE_STOP_FAILED'; evidence.failure ??= { operation: 'shutdown', code: 'FIXTURE_STOP_FAILED' }; }
    }
  }
  return evidence;
}
