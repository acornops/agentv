// Fixed-size summaries only. Never retain native rows, messages, IDs or paths.
const kinds = ['host', 'volumes', 'services', 'processes', 'listeners'];
const tools = ['get_host_summary', 'list_filesystems', 'list_processes', 'list_services'];
const healthStatuses = ['ok', 'partial', 'unavailable', 'permission_denied', 'timed_out', 'unsupported'];
const codes = ['TOOL_TIMEOUT', 'TOOL_NOT_ALLOWED', 'COMMAND_UNAVAILABLE', 'HOST_UNAVAILABLE', 'OUTPUT_TOO_LARGE', 'PERMISSION_DENIED'];
const status = (value) => healthStatuses.includes(value) ? value : 'unavailable';
const failure = (error) => codes.includes(error?.toolCode) ? error.toolCode : 'DIAGNOSTIC_FAILURE';
const health = (entries) => kinds.flatMap((kind) => {
  const matches = Array.isArray(entries) ? entries.filter((entry) => entry?.collector === `windows_${kind}`) : [];
  return matches.length ? [{ collector: `windows_${kind}`, status: matches.length === 1 ? status(matches[0].status) : 'unavailable' }] : [];
});

export function createOverlapEvidence(now = () => performance.now()) {
  const origin = now();
  const at = () => Math.max(0, Math.min(1_000_000, Math.round(now() - origin))) || 0;
  const report = { schema_version: 'acornops.overlap-worker.v1', minimum_vm_representative: 'unknown', completed: false, cleanup_complete: false, pending_call_peak: 0, observed_child_peak: 0, observed_multi_child_ms: 0, observed_nine_child_ms: 0, invocations: [], tools: [], snapshot: null };
  const active = new Set();
  let pending = 0; let last = 0;
  const accrue = (time) => { if (active.size >= 2) report.observed_multi_child_ms += time - last; if (active.size === 9) report.observed_nine_child_ms += time - last; last = time; };
  return {
    start(kind) {
      if (report.invocations.length >= 9 || !kinds.includes(kind)) throw new Error('INVOCATION_LIMIT');
      const ordinal = report.invocations.length + 1;
      report.invocations.push({ ordinal, kind, start_ms: at(), status: 'pending' });
      report.pending_call_peak = Math.max(report.pending_call_peak, ++pending);
      return ordinal;
    },
    observe(ordinal, event) {
      const call = report.invocations[ordinal - 1];
      if (!call || event?.collector !== call.kind || !['spawn', 'exit', 'close'].includes(event.event)) return;
      const field = `${event.event}_ms`;
      if (Object.hasOwn(call, field)) return;
      const time = at(); accrue(time); call[field] = time;
      if (event.event === 'spawn' && !Object.hasOwn(call, 'exit_ms') && !Object.hasOwn(call, 'close_ms')) active.add(ordinal);
      else active.delete(ordinal);
      report.observed_child_peak = Math.max(report.observed_child_peak, active.size);
    },
    finish(ordinal, result, error) {
      const call = report.invocations[ordinal - 1];
      if (!call || call.status !== 'pending') return;
      call.settled_ms = at(); call.status = error ? failure(error) : healthStatuses.includes(result?.status) ? result.status : 'DIAGNOSTIC_FAILURE';
      pending--;
    },
    snapshot(result, error) {
      if (report.snapshot) return;
      report.snapshot = { status: error ? failure(error) : 'resolved', health: health(result?.collector_health), coverage: { filesystems: result?.finding_coverage?.filesystems === 'complete' ? 'complete' : 'incomplete', services: result?.finding_coverage?.services === 'complete' ? 'complete' : 'incomplete' } };
    },
    tool(name, result, error) {
      if (!tools.includes(name) || report.tools.some((entry) => entry.name === name)) return;
      const expected = { get_host_summary: 'windows_host', list_filesystems: 'windows_volumes', list_processes: 'windows_processes', list_services: 'windows_services' }[name];
      const entries = health(name === 'get_host_summary' ? result?.collector_health : [result?.health]);
      report.tools.push({ name, status: error ? failure(error) : entries.length === 1 && entries[0].collector === expected ? entries[0].status : 'unavailable', settled_ms: at() });
    },
    complete(cleanup) { report.completed = true; report.cleanup_complete = cleanup === true; },
    result() {
      accrue(at());
      const snapshot = report.snapshot;
      const healthy = snapshot?.status === 'resolved' && snapshot.health.length === 5 && snapshot.health.every((entry) => entry.status === 'ok') && Object.values(snapshot.coverage).every((value) => value === 'complete') && report.tools.length === 4 && report.tools.every((entry) => entry.status === 'ok') && report.invocations.length === 9 && report.invocations.every((call) => call.status === 'ok');
      const observed = report.observed_child_peak === 9 && report.invocations.every((call) => Object.hasOwn(call, 'spawn_ms') && Object.hasOwn(call, 'close_ms')) && active.size === 0;
      return structuredClone({ ...report, tools: tools.flatMap((name) => report.tools.filter((entry) => entry.name === name)), active_children: active.size, status: !report.completed ? 'incomplete' : !healthy || !report.cleanup_complete ? 'failed' : !observed ? 'inconclusive' : 'passed' });
    },
  };
}
