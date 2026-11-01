import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlapEvidence } from './overlap-evidence.mjs';
import { runOverlap } from './overlap-worker.mjs';
import { ToolExecutionError } from '../../dist/tools/errors.js';

const secret = 'PRIVATE-host-command-credential';
const host = { os_family: 'windows', hostname: secret, version: '2022', build: '20348', product_type: 3, architecture: 'x64', system_volume: secret, uptime_seconds: 1, cpu: { usage_percent: null, sampled_ms: 0 }, memory: { total_bytes: 100, available_bytes: 75, used_bytes: 25, used_percent: 25 }, collector_health: [] };

// Inject only the external native boundary. Snapshot, live host, registrations,
// policy, executor limits, result parsing and health aggregation remain real.
function nativeBoundary(overrides = {}, lifecycle = {}) {
  return (observe) => ({
    async run(kind, data, signal) {
      assert.deepEqual(data, kind === 'listeners' ? { protocol: undefined } : {});
      assert.ok(signal instanceof AbortSignal);
      observe({ event: 'spawn', collector: kind });
      await new Promise((resolve) => setImmediate(resolve));
      observe({ event: 'exit', collector: kind });
      observe({ event: 'close', collector: kind });
      const result = overrides[kind];
      if (result instanceof Error) throw result;
      return { items: kind === 'host' ? [host] : [], truncated: false, status: 'ok', ...result };
    },
    async stop() { lifecycle.stopped = true; if (lifecycle.fail) throw new Error(secret); },
  });
}

test('actual production composition starts nine distinct invocations and checks health before passing', async () => {
  const lifecycle = {};
  const report = await runOverlap({ createRunner: nativeBoundary({}, lifecycle) });
  assert.equal(report.status, 'passed');
  assert.equal(report.pending_call_peak, 9);
  assert.equal(report.observed_child_peak, 9);
  assert.deepEqual(report.invocations.map((call) => call.ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(report.invocations.map((call) => call.kind), ['host', 'volumes', 'services', 'processes', 'listeners', 'host', 'volumes', 'processes', 'services']);
  assert.deepEqual(report.tools.map((tool) => tool.name), ['get_host_summary', 'list_filesystems', 'list_processes', 'list_services']);
  assert.equal(report.snapshot.health.length, 5);
  assert.deepEqual(report.snapshot.coverage, { filesystems: 'complete', services: 'complete' });
  assert.equal(report.minimum_vm_representative, 'unknown');
  assert.equal(lifecycle.stopped, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|hostname|system_volume|items/);
});

test('resolved snapshot with timed-out collectors and rejected tool remains failed', async () => {
  const report = await runOverlap({ createRunner: nativeBoundary({ volumes: new ToolExecutionError('TOOL_TIMEOUT', secret) }) });
  assert.equal(report.completed, true);
  assert.equal(report.status, 'failed');
  assert.equal(report.snapshot.coverage.filesystems, 'incomplete');
  assert.equal(report.snapshot.health.find((entry) => entry.collector === 'windows_volumes').status, 'timed_out');
  assert.equal(report.tools[1].status, 'TOOL_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
});

for (const status of ['partial', 'permission_denied', 'unavailable']) {
  test(`fulfilled ${status} tool results cannot manufacture a pass`, async () => {
    const report = await runOverlap({ createRunner: nativeBoundary({ services: { status } }) });
    assert.equal(report.status, 'failed');
    assert.equal(report.tools[3].status, status);
    assert.equal(report.snapshot.coverage.services, 'incomplete');
  });
}

test('cleanup failure survives successful reads and setup failure stays incomplete', async () => {
  const report = await runOverlap({ createRunner: nativeBoundary({}, { fail: true }) });
  assert.equal(report.status, 'failed');
  assert.equal(report.cleanup_complete, false);
  const early = await runOverlap({ createRunner() { throw new Error(secret); } });
  assert.equal(early.completed, false);
  assert.equal(early.status, 'incomplete');
  assert.equal(early.invocations.length, 0);
  assert.doesNotMatch(JSON.stringify([report, early]), /PRIVATE/);
});

test('nine pending calls without nine native starts stay inconclusive', async () => {
  const report = await runOverlap({ createRunner: (observe) => nativeBoundary()((event) => { if (event.collector !== 'listeners') observe(event); }) });
  assert.equal(report.pending_call_peak, 9);
  assert.equal(report.observed_child_peak, 8);
  assert.equal(report.status, 'inconclusive');
});

test('one missing close cannot be hidden by healthy results and successful stop', async () => {
  const report = await runOverlap({ createRunner: (observe) => nativeBoundary()((event) => { if (!(event.event === 'close' && event.collector === 'listeners')) observe(event); }) });
  assert.equal(report.observed_child_peak, 9);
  assert.equal(report.cleanup_complete, true);
  assert.equal(report.status, 'inconclusive');
});

test('allowlisting bounds events, duplicate kinds, arbitrary statuses and secret-bearing results', () => {
  let time = 0;
  const evidence = createOverlapEvidence(() => time);
  const one = evidence.start('host'); const two = evidence.start('host');
  evidence.observe(one, { event: 'spawn', collector: 'host', raw: secret });
  time = 10;
  evidence.observe(two, { event: 'spawn', collector: 'host' });
  for (let i = 0; i < 10000; i++) evidence.observe(two, { event: 'spawn', collector: 'host', message: secret });
  time = 30;
  evidence.observe(one, { event: 'exit', collector: 'host' });
  evidence.observe(one, { event: secret, collector: 'host' });
  evidence.finish(one, { status: secret, items: [secret], message: secret });
  evidence.finish(two, undefined, { toolCode: secret, message: secret, data: { stderr: secret } });
  evidence.snapshot({ collector_health: [{ collector: 'windows_host', status: secret, message: secret }, { collector: secret, status: 'ok' }], finding_coverage: { filesystems: secret, services: 'complete' }, raw: secret });
  evidence.tool('get_host_summary', { collector_health: [{ collector: 'windows_host', status: secret, message: secret }], hostname: secret });
  for (let i = 0; i < 7; i++) evidence.start('services');
  assert.throws(() => evidence.start('host'), /INVOCATION_LIMIT/);
  const report = evidence.result();
  assert.equal(report.observed_child_peak, 2);
  assert.equal(report.observed_multi_child_ms, 20);
  assert.equal(report.invocations[0].status, 'DIAGNOSTIC_FAILURE');
  assert.equal(report.invocations[1].status, 'DIAGNOSTIC_FAILURE');
  assert.equal(report.snapshot.health.length, 1);
  assert.equal(report.snapshot.health[0].status, 'unavailable');
  assert.equal(report.snapshot.coverage.filesystems, 'incomplete');
  assert.equal(report.tools[0].status, 'unavailable');
  assert.equal(report.status, 'incomplete');
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 65536);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|raw|message|hostname|items/);
});
