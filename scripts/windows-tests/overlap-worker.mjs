import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { WindowsCollectorRunner } from '../../dist/windows/runner.js';
import { WindowsLiveHost } from '../../dist/windows/live.js';
import { buildWindowsSnapshot } from '../../dist/windows/snapshot.js';
import { registerWindowsTools } from '../../dist/windows/tools.js';
import { ToolExecutor } from '../../dist/tools/executor.js';
import { scripts } from '../../dist/windows/scripts.js';
import { createOverlapEvidence } from './overlap-evidence.mjs';

// This lower-level composition deliberately bypasses runtime host preflight.
// It is neither normal startup nor service/backend/reboot qualification.
export async function runOverlap({ createRunner = (observe) => new WindowsCollectorRunner(undefined, observe), onEvidence = () => {} } = {}) {
  const evidence = createOverlapEvidence();
  const context = new AsyncLocalStorage();
  const executor = new ToolExecutor();
  const controller = new AbortController();
  const emit = () => onEvidence(evidence.result());
  let host; let runner; let settled = false; let cleanup = false;
  try {
    runner = createRunner((event) => { evidence.observe(context.getStore(), event); if (['spawn', 'exit', 'close'].includes(event.event)) emit(); });
    const delegate = {
      async run(kind, data, signal) {
        const ordinal = evidence.start(kind); emit();
        try {
          // Every async observer callback inherits this call's ordinal, including
          // duplicate kinds. No matching by collector kind or production hook.
          const result = await context.run(ordinal, () => runner.run(kind, data, signal));
          evidence.finish(ordinal, result); return result;
        } catch (error) { evidence.finish(ordinal, undefined, error); throw error; }
        finally { emit(); }
      },
      stop: () => runner.stop(),
    };
    host = new WindowsLiveHost([], delegate);
    registerWindowsTools(host);
    const calls = [['get_host_summary', {}], ['list_filesystems', { limit: 1 }], ['list_processes', { limit: 1 }], ['list_services', { limit: 1, state: 'all' }]];
    const policy = { allowedTools: new Set(calls.map(([name]) => name)), writeEnabled: false, generation: 1, targetId: 'composition-fixture' };
    executor.setActiveGeneration(1);
    await Promise.all([
      buildWindowsSnapshot(host, controller.signal).then((result) => evidence.snapshot(result), (error) => evidence.snapshot(undefined, error)).finally(emit),
      ...calls.map(([name, args], index) => executor.execute({ name, arguments: args, requestId: index + 1, policy }).then((result) => evidence.tool(name, result), (error) => evidence.tool(name, undefined, error)).finally(emit)),
    ]);
    settled = true;
  } catch { /* Fixed incomplete status, never an exception message. */ }
  finally {
    executor.clearActiveGeneration(); controller.abort();
    try { if (host) await host.stop(); else if (runner) await runner.stop(); cleanup = Boolean(runner); } catch { cleanup = false; }
    if (settled) evidence.complete(cleanup);
    emit();
  }
  return evidence.result();
}

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AGENTV_OVERLAP_ALLOW, 'true');
  let authorized = false;
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line !== 'GO') process.exit(2);
    authorized = true; input.close(); process.stdin.destroy(); break;
  }
  assert.ok(authorized);
  const script_sha256 = Object.fromEntries(['host', 'volumes', 'services', 'processes', 'listeners'].map((kind) => [kind, createHash('sha256').update(scripts[kind]).digest('hex')]));
  const emit = (report) => process.stdout.write(`${JSON.stringify({ ...report, node: process.versions.node, script_sha256 })}\n`);
  const report = await runOverlap({ onEvidence: emit });
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
