import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { win32, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectorEnvironment } from '../dist/windows/runner.js';

// CI-only causal observation. This is never imported by the product runtime.
const systemDirectory = 'C:\\Windows\\System32';
const executable = win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const utilityManifest = win32.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1');
const input = JSON.stringify({ probe: '日本語;$(x)' });
const mark = (name) => `[Console]::Error.WriteLine('probe:${name}');`;
const parse = `$p=($raw|ConvertFrom-Json);if($p.probe -cne '日本語;$(x)'){throw 'probe data mismatch'};`;
const qualified = `$p=($raw|Microsoft.PowerShell.Utility\\ConvertFrom-Json);if($p.probe -cne '日本語;$(x)'){throw 'probe data mismatch'};`;
const cases = Object.freeze({
  baseline: { body: parse },
  core_cmdlet: { body: '$null=Microsoft.PowerShell.Core\\Get-Module;' },
  qualified_utility: { body: qualified },
  explicit_utility_import: { body: `Microsoft.PowerShell.Core\\Import-Module -Name '${utilityManifest}' -ErrorAction Stop;${mark('utility_loaded')}${parse}` },
  direct_input_object: { body: `$p=ConvertFrom-Json -InputObject $raw;if($p.probe -cne '日本語;$(x)'){throw 'probe data mismatch'};` },
  cache_disabled: { body: parse, environment: { PSModuleAnalysisCachePath: 'NUL' } },
  os_localappdata: { before: `$env:LOCALAPPDATA=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);${mark('localappdata_ready')}`, body: parse },
  baseline_repeat: { body: parse },
});
export const startupProbeIds = Object.freeze(Object.keys(cases));
const allowedMarkers = new Set(['started', 'stdin_complete', 'localappdata_ready', 'command_started', 'utility_loaded', 'command_complete', 'failure']);

function program(id) {
  const test = cases[id]; assert.ok(test && Object.hasOwn(cases, id), 'Unknown fixed startup probe');
  return `try{${mark('started')}$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$utf8=[System.Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$raw=[Console]::In.ReadToEnd();${mark('stdin_complete')}${test.before || ''}${mark('command_started')}${test.body}${mark('command_complete')}[Console]::Out.WriteLine('probe:success');}catch{${mark('failure')}exit 1;}`;
}

// Dependencies stay in this CI script; no test hooks enter runtime code.
export async function runStartupProbe(id, { spawnChild = spawn, observationMs = 30000 } = {}) {
  const code = program(id); const started = Date.now();
  assert.ok(code.length * 3 < 30000, 'Probe exceeds command-line budget');
  return await new Promise((resolveProbe) => {
    const child = spawnChild(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...collectorEnvironment(systemDirectory), ...cases[id].environment },
    });
    const result = { id, outcome: 'pending', elapsed_ms: 0, stdout_bytes: 0, stderr_bytes: 0, stdin_finished: false, spawned: false, markers: [] };
    let stdoutLine = ''; let stderrLine = ''; let stdoutLong = false; let stderrLong = false; let success = false;
    const observe = (chunk, standardOutput) => {
      result[standardOutput ? 'stdout_bytes' : 'stderr_bytes'] += chunk.length;
      if (result.stdout_bytes + result.stderr_bytes > 32768) { result.outcome = 'output_limit'; child.kill(); return; }
      for (const byte of chunk) {
        let line = standardOutput ? stdoutLine : stderrLine; let long = standardOutput ? stdoutLong : stderrLong;
        if (byte === 10) {
          const value = line.replace(/\r$/, '');
          if (!long && value.startsWith('probe:')) {
            const marker = value.slice(6);
            if (standardOutput && marker === 'success') success = true;
            else if (!standardOutput && allowedMarkers.has(marker) && result.markers.length < 16) result.markers.push({ stage: marker, elapsed_ms: Date.now() - started });
          }
          line = ''; long = false;
        } else if (line.length < 96 && !long) line += String.fromCharCode(byte); else long = true;
        if (standardOutput) { stdoutLine = line; stdoutLong = long; } else { stderrLine = line; stderrLong = long; }
      }
    };
    child.once('spawn', () => { result.spawned = true; });
    child.stdout.on('data', (chunk) => observe(chunk, true)); child.stderr.on('data', (chunk) => observe(chunk, false));
    child.stdin.once('finish', () => { result.stdin_finished = true; }); child.stdin.on('error', () => undefined); child.stdin.end(input, 'utf8');
    child.once('error', () => { result.outcome = 'spawn_failed'; });
    const timer = setTimeout(() => { result.outcome = 'observation_timeout'; child.kill(); }, observationMs);
    child.once('close', (code) => {
      clearTimeout(timer); result.elapsed_ms = Date.now() - started;
      if (result.outcome === 'pending') result.outcome = code === 0 && success ? 'success' : 'command_failed';
      resolveProbe(result);
    });
  });
}

async function validateTrustedPath(path) {
  let current = win32.parse(path).root;
  for (const part of path.slice(current.length).split('\\')) { current = win32.join(current, part); assert.equal((await lstat(current)).isSymbolicLink(), false, 'Probe path redirection rejected'); }
  assert.equal((await realpath(path)).toLowerCase(), path.toLowerCase(), 'Probe path changed');
  assert.equal((await lstat(path)).isFile(), true, 'Probe path is not a file');
}

async function main() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.argv.length, 2);
  await validateTrustedPath(executable);
  const evidence = { schema_version: 'acornops.agentv-windows-startup-probe.v1', source: 'native-ci-diagnostic-only', observation_ms: 30000, production_collector_timeout_ms: 8000, revision: process.env.GITHUB_SHA || null, runner_image: process.env.ImageOS || null, runner_image_version: process.env.ImageVersion || null, node: process.versions.node, probes: [] };
  for (const id of startupProbeIds) {
    process.stdout.write(`${JSON.stringify({ probe: id, status: 'started' })}\n`);
    let result;
    if (id === 'explicit_utility_import') {
      try { await validateTrustedPath(utilityManifest); } catch { result = { id, outcome: 'trusted_manifest_unavailable' }; }
    }
    result ??= await runStartupProbe(id); evidence.probes.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  await mkdir(new URL('../artifacts/windows-collectors/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/windows-collectors/startup-probes.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch { process.stderr.write('Fixed native startup probe could not execute safely.\n'); process.exitCode = 1; }
}
