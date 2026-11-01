import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirstCallEvidence } from './first-call-evidence.mjs';

test('reports the current production host bound for new diagnostics', () => {
  assert.equal(createFirstCallEvidence([]).result().production_timeout_ms, 10000);
});

test('redacts untrusted event fields and rejects oversized and unknown observations', () => {
  const evidence = createFirstCallEvidence(['script_started']);
  evidence.observe({ event: 'stage', collector: 'host', at_ms: 4, stage: 'script_started', raw: 'private-command', pid: 123 });
  evidence.observe({ event: 'stage', collector: 'secret', at_ms: 5 });
  evidence.observe({ event: 'stage', collector: 'host', at_ms: Infinity });
  for (let i = 0; i < 100; i++) evidence.observe({ event: 'stage', collector: 'host', at_ms: i, stage: 'private-stage' });
  const report = evidence.result();
  assert.equal(report.events.length, 64);
  assert.deepEqual(report.events[0], { event: 'stage', collector: 'host', at_ms: 4, stage: 'script_started' });
  assert.doesNotMatch(JSON.stringify(report), /private|secret|pid/);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 65536);
});

test('failure survives cleanup failure, with no error messages or raw output', () => {
  const evidence = createFirstCallEvidence(['input_ready']);
  evidence.fail({ toolCode: 'TOOL_TIMEOUT', message: 'secret', data: { stage: 'input_ready', elapsed_ms: 8001, stderr: 'private' } });
  evidence.cleanupFailed();
  assert.deepEqual(evidence.result().failure, { code: 'TOOL_TIMEOUT', stage: 'input_ready', elapsed_ms: 8001 });
  assert.equal(evidence.result().cleanup_failure, true);
  assert.doesNotMatch(JSON.stringify(evidence.result()), /secret|private/);
});
