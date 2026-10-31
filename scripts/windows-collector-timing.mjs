import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { win32 } from 'node:path';
import { createHash } from 'node:crypto';

// At most 120 samples; the final bin includes lag of ten seconds or more.
export function createEventLoopSummary(clock = () => performance.now()) {
  let previous = clock(); let count = 0; let maximum = 0;
  const bins = Array(101).fill(0);
  return {
    sample() {
      if (count >= 120) return;
      const now = clock(); const lag = Math.max(0, now - previous - 100); previous = now;
      bins[Math.min(100, Math.floor(lag / 100))]++; count++; maximum = Math.max(maximum, lag);
    },
    result() { return { resolution_ms: 100, sample_count: count, max_lag_ms: Math.round(maximum), lag_bins: [...bins] }; },
  };
}

// Keep fixed stage names/times only: no raw stderr, stdout, identities or input.
export function createStageTimeline(allowedStages, clock = () => performance.now()) {
  const events = []; let line = ''; let oversized = false;
  const allowed = new Set(allowedStages);
  return {
    events,
    observe(chunk) {
      for (const byte of chunk) {
        if (byte === 10) {
          if (!oversized && line.startsWith('agentv-stage:')) {
            const stage = line.slice(13).replace(/\r$/, '');
            if (allowed.has(stage) && events.length < 32) events.push({ stage, elapsed_ms: Math.round(clock()) });
          }
          line = ''; oversized = false;
        } else if (!oversized && line.length < 96) line += String.fromCharCode(byte);
        else oversized = true;
      }
    },
  };
}

// Diagnostic only: the original 8-second gate failure remains a failure.
export async function probeCollectorTiming(script, data) {
  if (process.platform !== 'win32' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') return [];
  const [{ COLLECTOR_STAGES, scripts }, { collectorCommand, collectorEnvironment }] = await Promise.all([import('../dist/windows/scripts.js'), import('../dist/windows/runner.js')]);
  const system = 'C:\\Windows\\System32';
  const command = collectorCommand(script, data);
  const trials = [];
  for (let trial = 1; trial <= 2; trial++) {
    trials.push(await new Promise((resolve) => {
      const beforeSpawn = performance.now();
      const child = spawn(win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), command.args, { env: collectorEnvironment(system), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const start = performance.now(); const elapsed = () => performance.now() - start;
      const timeline = createStageTimeline(COLLECTOR_STAGES, elapsed);
      const result = { trial, collector: script, script_sha256: createHash('sha256').update(scripts[script]).digest('hex'), diagnostic_ceiling_ms: 20000, spawn_call_ms: Math.round(start - beforeSpawn), stdout_bytes: 0, stderr_bytes: 0, stdin_finished_ms: null, spawned_ms: null, events: timeline.events, outcome: 'running' };
      let done = false;
      const finish = (outcome, exitCode = null) => { if (done) return; done = true; clearTimeout(deadline); clearTimeout(closeDeadline); result.outcome = outcome; result.exit_code = exitCode; result.elapsed_ms = Math.round(elapsed()); resolve(result); };
      let closeDeadline;
      const terminate = (outcome) => { if (result.outcome !== 'running') return; result.outcome = outcome; child.kill(); closeDeadline = setTimeout(() => { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(`${outcome}_close_deadline`); }, 2000); };
      const deadline = setTimeout(() => terminate('diagnostic_timeout'), 20000);
      child.once('spawn', () => { result.spawned_ms = Math.round(elapsed()); });
      child.stdin.once('finish', () => { result.stdin_finished_ms = Math.round(elapsed()); });
      child.stdin.on('error', () => undefined);
      child.stdout.on('data', (chunk) => { result.stdout_bytes += chunk.length; if (result.stdout_bytes + result.stderr_bytes > 1048576) terminate('output_limit'); });
      child.stderr.on('data', (chunk) => { result.stderr_bytes += chunk.length; if (result.stdout_bytes + result.stderr_bytes > 1048576) terminate('output_limit'); else timeline.observe(chunk); });
      child.once('error', () => finish('spawn_error'));
      child.once('close', (code) => finish(result.outcome === 'running' ? 'closed' : result.outcome, code));
      child.stdin.end(command.stdin, 'utf8');
    }));
  }
  return trials;
}
