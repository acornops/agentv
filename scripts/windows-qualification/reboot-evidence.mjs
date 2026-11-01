import { pathToFileURL } from 'node:url';

const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const time = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;

/** Evaluate sanitized observations only; never confer installation or recovery authority. */
export function evaluateRebootEvidence(mode, current, before) {
  const checks = [];
  const check = (id, value) => checks.push({ id, passed: Boolean(value) });
  const healthy = (o, prefix) => {
    check(`${prefix}.identity`, o?.schema === 'acornops.agentv-reboot-observation.v1'
      && matches(hash, o.machineId) && matches(uuid, o.ownerId)
      && matches(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, o.version)
      && matches(/^[a-f0-9]{40}$/, o.sourceRevision)
      && ['packageSha256', 'configSha256', 'nodeSha256'].every((key) => matches(hash, o[key])));
    const observed = time(o?.observedAt); const boot = time(o?.bootAt);
    check(`${prefix}.time`, Number.isFinite(boot) && Number.isFinite(observed) && observed >= boot);
    check(`${prefix}.settled`, o?.settled === true);
    check(`${prefix}.service`, o?.service?.state === 'Running' && o.service.startMode === 'Auto'
      && typeof o.service.startName === 'string' && o.service.startName.toLowerCase() === 'nt authority\\localservice' && matches(hash, o.service.imageSha256));
    check(`${prefix}.launch`, matches(uuid, o?.launch?.launchId) && matches(hash, o?.configSha256)
      && o?.launch?.configSha256 === o?.configSha256);
    const auth = o?.authentication; const authenticated = time(auth?.authenticatedAt);
    check(`${prefix}.authentication`, auth?.version === 1 && auth.authenticated === true && auth.phase === 'active'
      && matches(uuid, auth.launchId) && auth.launchId === o?.launch?.launchId
      && matches(hash, auth.configSha256) && auth.configSha256 === o?.configSha256
      && Number.isFinite(authenticated) && authenticated >= boot && authenticated <= observed + 5000);
  };
  check('mode', mode === 'prepare' || mode === 'verify');
  healthy(current, 'current');
  if (mode === 'verify') {
    healthy(before, 'before');
    check('later-boot', time(current?.bootAt) > time(before?.observedAt));
    check('later-observation', time(current?.observedAt) > time(before?.observedAt));
    check('same-installation', ['machineId', 'ownerId', 'version', 'sourceRevision', 'packageSha256', 'configSha256', 'nodeSha256']
      .every((key) => typeof current?.[key] === 'string' && current[key] === before?.[key])
      && matches(hash, current?.service?.imageSha256) && current.service.imageSha256 === before?.service?.imageSha256);
    check('new-launch', matches(uuid, current?.launch?.launchId) && current.launch.launchId !== before?.launch?.launchId);
  }
  return { schema: 'acornops.agentv-reboot-report.v1', scope: 'local-service-authentication-evidence',
    status: checks.every((item) => item.passed) ? (mode === 'prepare' ? 'prepared' : 'observed-reboot-pass') : 'failed', checks };
}

// The native probe supplies bounded sanitized observations over stdin, never config or credentials.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = ''; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 32768) throw new Error('Oversized evidence');
      input += chunk.toString('utf8');
    }
    // Windows PowerShell can prefix native stdin with the UTF-8 BOM. Accept
    // exactly that optional prefix, retaining the original byte-size bound.
    const { mode, current, before } = JSON.parse(input.startsWith('\uFEFF') ? input.slice(1) : input);
    const result = evaluateRebootEvidence(mode, current, before);
    process.stdout.write(JSON.stringify(result));
    if (result.status === 'failed') process.exitCode = 1;
  } catch {
    process.stdout.write(JSON.stringify({ schema: 'acornops.agentv-reboot-report.v1', status: 'failed', checks: [{ id: 'input', passed: false }] }));
    process.exitCode = 1;
  }
}
