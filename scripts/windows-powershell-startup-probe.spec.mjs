import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { runStartupProbe, startupProbeIds } from './windows-powershell-startup-probe.mjs';

function child() {
  const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() { queueMicrotask(() => process.emit('close', 1)); } });
  return process;
}

test('fixed probes preserve isolated environment and emit only recognized diagnostics', async () => {
  const process = child(); let launch;
  const pending = runStartupProbe('baseline', { spawnChild: (...args) => { launch = args; return process; } });
  assert.equal(launch[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(launch[2].shell, false); assert.equal(Object.keys(launch[2].env).length, 4);
  assert.equal(launch[2].env.ACORNOPS_AGENT_KEY, undefined); assert.equal(launch[2].env.NODE_OPTIONS, undefined);
  process.emit('spawn'); process.stderr.write('native secret text\nprobe:command_'); process.stderr.write('started\nprobe:secret-unknown\n');
  process.stdout.write('secret output\nprobe:success\n'); process.emit('close', 0);
  const result = await pending; assert.equal(result.outcome, 'success'); assert.equal(result.markers[0].stage, 'command_started'); assert.equal(result.spawned, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('observation bounds time and bytes and accepts only compiled probe ids', async () => {
  const timed = child(); const timeout = await runStartupProbe('baseline', { spawnChild: () => timed, observationMs: 5 }); assert.equal(timeout.outcome, 'observation_timeout');
  const oversized = child(); const pending = runStartupProbe('cache_disabled', { spawnChild: (_path, _args, options) => { assert.equal(options.env.PSModuleAnalysisCachePath, 'NUL'); return oversized; } });
  oversized.stderr.write(Buffer.alloc(32769)); assert.equal((await pending).outcome, 'output_limit');
  await assert.rejects(runStartupProbe('arbitrary-code'), /Unknown fixed/); assert.equal(startupProbeIds.length, 8);
});
