import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateRebootEvidence } from './reboot-evidence.mjs';

// Synthetic observations test decisions only; they never qualify a host reboot.
function observation(reboot = false) {
  const launchId = reboot ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111';
  return {
    schema: 'acornops.agentv-reboot-observation.v1',
    machineId: 'a'.repeat(64), ownerId: '33333333-3333-4333-8333-333333333333',
    bootAt: reboot ? '2026-11-01T01:00:00.000Z' : '2026-11-01T00:00:00.000Z',
    observedAt: reboot ? '2026-11-01T01:05:00.000Z' : '2026-11-01T00:05:00.000Z',
    version: '0.0.1-experimental.14', sourceRevision: 'b'.repeat(40),
    packageSha256: 'c'.repeat(64), configSha256: 'd'.repeat(64), nodeSha256: 'e'.repeat(64),
    service: { state: 'Running', startMode: 'Auto', startName: 'NT AUTHORITY\\LocalService', imageSha256: 'f'.repeat(64) },
    settled: true,
    launch: { launchId, configSha256: 'd'.repeat(64) },
    authentication: { version: 1, launchId, configSha256: 'd'.repeat(64), authenticated: true, phase: 'active',
      authenticatedAt: reboot ? '2026-11-01T01:01:00.000Z' : '2026-11-01T00:01:00.000Z' },
  };
}

test('preparation records healthy observations without declaring a reboot pass', () => {
  const result = evaluateRebootEvidence('prepare', observation());
  assert.equal(result.status, 'prepared');
  assert.equal(result.scope, 'local-service-authentication-evidence');
  assert.ok(result.checks.every((check) => check.passed));
});
test('verification accepts a later boot, unchanged installation and new active launch', () => {
  assert.equal(evaluateRebootEvidence('verify', observation(true), observation()).status, 'observed-reboot-pass');
});
test('same boot is rejected even after a service restart and reauthentication', () => {
  const current = observation(true); current.bootAt = observation().bootAt;
  assert.equal(evaluateRebootEvidence('verify', current, observation()).status, 'failed');
});
for (const [name, change] of [
  ['different machine', (o) => { o.machineId = '0'.repeat(64); }],
  ['changed owner', (o) => { o.ownerId = '44444444-4444-4444-8444-444444444444'; }],
  ['changed credentials', (o) => { o.configSha256 = '0'.repeat(64); o.launch.configSha256 = o.configSha256; o.authentication.configSha256 = o.configSha256; }],
  ['changed release', (o) => { o.packageSha256 = '0'.repeat(64); }],
  ['changed revision', (o) => { o.sourceRevision = '0'.repeat(40); }],
  ['changed version', (o) => { o.version = '0.0.1-experimental.15'; }],
  ['changed Node', (o) => { o.nodeSha256 = '0'.repeat(64); }],
  ['changed SCM image', (o) => { o.service.imageSha256 = '0'.repeat(64); }],
  ['stopped service', (o) => { o.service.state = 'Stopped'; }],
  ['manual service', (o) => { o.service.startMode = 'Manual'; }],
  ['wrong service identity', (o) => { o.service.startName = 'LocalSystem'; }],
  ['malformed service identity', (o) => { o.service.startName = 19; }],
  ['pending recovery', (o) => { o.settled = false; }],
  ['missing launch', (o) => { delete o.launch; }],
  ['old launch', (o) => { o.launch.launchId = observation().launch.launchId; o.authentication.launchId = o.launch.launchId; }],
  ['missing authentication', (o) => { delete o.authentication; }],
  ['preboot authentication', (o) => { o.authentication.authenticatedAt = '2026-11-01T00:59:59.000Z'; }],
  ['future authentication', (o) => { o.authentication.authenticatedAt = '2026-11-01T02:00:00.000Z'; }],
  ['provisional authentication', (o) => { o.authentication.phase = 'provisional'; }],
  ['unauthenticated', (o) => { o.authentication.authenticated = false; }],
  ['wrong launch binding', (o) => { o.authentication.launchId = observation().launch.launchId; }],
  ['wrong config binding', (o) => { o.authentication.configSha256 = '0'.repeat(64); }],
  ['wrong launch config', (o) => { o.launch.configSha256 = '0'.repeat(64); }],
  ['invalid time', (o) => { o.bootAt = 'invalid'; }],
  ['observation before boot', (o) => { o.observedAt = '2026-11-01T00:59:59.000Z'; }],
  ['unknown schema', (o) => { o.schema = 'other'; }],
  ['incomplete hash', (o) => { o.configSha256 = ''; }],
]) test(`verification rejects ${name}`, () => {
  const current = observation(true); change(current);
  const result = evaluateRebootEvidence('verify', current, observation());
  assert.equal(result.status, 'failed');
  assert.ok(result.checks.some((check) => !check.passed));
});
test('invalid or missing baseline and unknown modes fail closed without echoing input', () => {
  for (const before of [undefined, {}, null, { ...observation(), configSha256: 'secret' }]) {
    const result = evaluateRebootEvidence('verify', observation(true), before);
    assert.equal(result.status, 'failed');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(evaluateRebootEvidence('other', observation()).status, 'failed');
  assert.equal(evaluateRebootEvidence('prepare', null).status, 'failed');
});
test('CLI reads bounded stdin and returns preparation or rejection with the correct exit code', () => {
  for (const [input, code, status] of [
    [JSON.stringify({ mode: 'prepare', current: observation() }), 0, 'prepared'],
    ['\uFEFF' + JSON.stringify({ mode: 'prepare', current: observation() }), 0, 'prepared'],
    [JSON.stringify({ mode: 'verify', current: observation(), before: observation() }), 1, 'failed'],
    ['private-invalid-input', 1, 'failed'],
    ['x'.repeat(32769), 1, 'failed'],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./reboot-evidence.mjs', import.meta.url))], { input, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, code);
    assert.equal(JSON.parse(result.stdout).status, status);
    assert.ok(!result.stdout.includes('private-invalid-input'));
  }
});
