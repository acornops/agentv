import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { WindowsCollectorRunner } from '../dist/windows/runner.js';
import { WindowsLiveHost } from '../dist/windows/live.js';
import { scripts, WINDOWS_COLLECTOR_SCRIPT_VERSION } from '../dist/windows/scripts.js';

// Read-only native parsing gate. Never emit host/service/process identities or logs.
assert.equal(process.platform, 'win32', 'Native collector smoke requires Windows');
assert.equal(process.arch, 'x64');
assert.ok([22, 24].includes(Number(process.versions.node.split('.')[0])));
const runner = new WindowsCollectorRunner();
const host = new WindowsLiveHost(['Application', 'System'], runner);
const evidence = {
  schema_version: 'acornops.agentv-windows-native-structure.v1', source: 'native-hosted-runner',
  provenance: { runner_os: process.env.RUNNER_OS || null, runner_image: process.env.ImageOS || null, runner_image_version: process.env.ImageVersion || null, github_run_id: process.env.GITHUB_RUN_ID || null, github_run_attempt: process.env.GITHUB_RUN_ATTEMPT || null, revision: process.env.GITHUB_SHA || null, node: process.versions.node, architecture: process.arch, collected_at: new Date().toISOString() },
  script_contract: WINDOWS_COLLECTOR_SCRIPT_VERSION,
  script_sha256: Object.fromEntries(Object.entries(scripts).map(([name, script]) => [name, createHash('sha256').update(script).digest('hex')])),
  host: {}, collections: {},
};
try {
  const summary = await host.getHostSummary();
  assert.equal(summary.os_family, 'windows'); assert.ok([2, 3].includes(summary.product_type));
  assert.ok(['20348', '26100'].includes(summary.build)); assert.ok(summary.memory.total_bytes > 0);
  assert.ok(!Object.hasOwn(summary, 'load') && !Object.hasOwn(summary, 'swap'));
  evidence.host = { build: summary.build, version: summary.version, product_type: summary.product_type, keys: Object.keys(summary).sort(), cpu_available: summary.cpu.usage_percent !== null, system_volume_format_valid: /^[A-Za-z]:$/.test(summary.system_volume), health: summary.collector_health };
  for (const [name, operation] of [
    ['volumes', () => host.listFilesystems({ limit: 1000 })],
    ['processes', () => host.listProcesses({ limit: 1000 })],
    ['services', () => host.listServices({ limit: 1000 })],
    ['listeners', () => host.listListeners({ limit: 1000 })],
    ['application_events', () => host.queryLogs({ channel: 'Application', limit: 10, byte_limit: 16384 })],
    ['system_events', () => host.queryLogs({ channel: 'System', limit: 10, byte_limit: 16384 })],
  ]) {
    const result = await operation();
    assert.ok(['ok', 'partial', 'permission_denied'].includes(result.health.status), `${name} collector unavailable`);
    const rows = result.items || result.entries;
    if (['volumes', 'processes', 'services'].includes(name)) { assert.equal(result.health.status, 'ok', `${name} must be readable on hosted runner`); assert.ok(rows.length > 0); }
    evidence.collections[name] = { status: result.health.status, original_count: result.original_count, returned_count: rows.length, omitted_count: result.omitted_count ?? null, truncated: result.truncated ?? (result.omitted_count > 0), row_keys: rows[0] ? Object.keys(rows[0]).sort() : [] };
    if (name === 'services') {
      evidence.collections[name].state_evidence = [...new Map(rows.map((item) => [JSON.stringify([item.state, item.start_mode, item.exit_code, item.service_specific_exit_code]), { state: item.state, start_mode: item.start_mode, exit_code: item.exit_code, service_specific_exit_code: item.service_specific_exit_code }])).values()].slice(0, 50);
      for (const service of rows) if (service.exit_code !== 1066) assert.equal(service.service_specific_exit_code, null);
      const exact = await host.getService(rows[0].name); assert.equal(exact.name, rows[0].name);
    }
    if (name === 'processes') { const own = await host.getProcess(process.pid); assert.equal(own.pid, process.pid); }
  }
  const shaped = await runner.run('services', { name: "日本語';$(Write-Output injected);`" });
  assert.equal(shaped.status, 'ok'); assert.deepEqual(shaped.items, []);
  await assert.rejects(host.queryLogs({ channel: 'Security', limit: 1, byte_limit: 1024 }), /locally allowed/);
  await assert.rejects(host.queryLogs({ channel: 'System', since: '2020-01-01T00:00:00Z', until: '2020-01-03T00:00:00Z', limit: 1, byte_limit: 1024 }), /24 hours/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(host.listServices({ limit: 1 }, controller.signal), /cancelled/);
  evidence.boundary_checks = { command_shaped_unicode_input: true, denied_channel: true, maximum_time_window: true, cancellation: true };
  await mkdir(new URL('../artifacts/windows-collectors/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/windows-collectors/native-structure.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write('Native Windows collector structure and bounded read boundaries passed; sanitized evidence saved.\n');
} finally { await host.stop(); }
