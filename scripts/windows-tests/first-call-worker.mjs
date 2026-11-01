// Standalone disposable diagnostic, supervised by first-call-native.ps1.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { WindowsCollectorRunner } from '../../dist/windows/runner.js';
import { scripts, COLLECTOR_STAGES } from '../../dist/windows/scripts.js';
import { createEventLoopSummary } from '../windows-collector-timing.mjs';
import { createFirstCallEvidence } from './first-call-evidence.mjs';
assert.equal(process.platform, 'win32');
assert.equal(process.env.CI, 'true');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.AGENTV_FIRST_CALL_ALLOW, 'true');
let authorized = false;
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  if (line !== 'GO') process.exit(2);
  authorized = true; input.close(); process.stdin.destroy(); break;
}
assert.ok(authorized);
const evidence = createFirstCallEvidence(COLLECTOR_STAGES);
const loop = createEventLoopSummary();
const emit = () => process.stdout.write(`${JSON.stringify(evidence.result())}\n`);
const runner = new WindowsCollectorRunner(undefined, (event) => {
  // TypeScript-private map is inspected only in this diagnostic. A spawn event
  // follows synchronous map registration; no production seam/command is changed.
  if (event.event === 'spawn') {
    const children = [...runner.children.keys()];
    if (children.length === 1 && Number.isSafeInteger(children[0].pid)) process.stdout.write(`PID:${children[0].pid}\n`);
  }
  evidence.observe(event); emit();
});
const interval = setInterval(() => loop.sample(), 100);
let passed = false;
try { await runner.run('host', {}); passed = true; }
catch (error) { evidence.fail(error); emit(); }
finally {
  clearInterval(interval);
  try { await runner.stop(); } catch { evidence.cleanupFailed(); }
  const report = { ...evidence.result(), completed: true, gate_passed: passed, event_loop: loop.result(), script_sha256: createHash('sha256').update(scripts.host).digest('hex'), node: process.versions.node };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = passed && !report.cleanup_failure ? 0 : 1;
}
