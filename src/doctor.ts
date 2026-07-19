import type { ActionClient } from './actions/types.js';
import type { HostAdapter } from './adapters/types.js';
import type { AgentConfig } from './config.js';
import { resolveExecutable } from './adapters/command-runner.js';

interface Check { name: string; status: 'ok' | 'degraded' | 'failed'; message: string; }
interface DoctorDependencies { resolveExecutable: typeof resolveExecutable; }

/** Run local, outbound-free production readiness checks. */
export async function runDoctor(
  config: AgentConfig,
  host: HostAdapter,
  actions: ActionClient,
  dependencies: DoctorDependencies = { resolveExecutable },
): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  for (const binary of [
    { name: 'systemctl', paths: ['/bin/systemctl'] },
    { name: 'systemd-notify', paths: ['/usr/bin/systemd-notify'] },
    { name: 'journalctl', paths: ['/bin/journalctl'] },
    { name: 'df', paths: ['/bin/df'] },
    { name: 'ss', paths: ['/usr/bin/ss', '/usr/sbin/ss'] }
  ]) {
    try { const resolved = await dependencies.resolveExecutable(binary.paths); checks.push({ name: `binary:${binary.name}`, status: 'ok', message: resolved }); }
    catch { checks.push({ name: `binary:${binary.name}`, status: 'failed', message: 'missing or not executable' }); }
  }
  try { await host.getHostSummary(); checks.push({ name: 'host', status: 'ok', message: 'Linux host facts are readable' }); }
  catch { checks.push({ name: 'host', status: 'failed', message: 'Linux host facts are unavailable' }); }
  try { await host.listFilesystems({ include_pseudo: false, limit: 1 }); checks.push({ name: 'filesystems', status: 'ok', message: 'Filesystem facts are readable' }); }
  catch { checks.push({ name: 'filesystems', status: 'failed', message: 'Filesystem facts are unavailable' }); }
  try { await host.queryLogs({ limit: 1, byte_limit: 1024 }); checks.push({ name: 'journald', status: 'ok', message: 'Journal is readable' }); }
  catch { checks.push({ name: 'journald', status: 'degraded', message: 'Journal is not readable; add the agent user to systemd-journal when available' }); }
  if (config.writeEnabled) {
    try { const capabilities = await actions.capabilities(); checks.push({ name: 'helper', status: capabilities.policy_valid && capabilities.restart_services.length ? 'ok' : 'degraded', message: `${capabilities.restart_services.length} restart service(s) allowlisted` }); }
    catch { checks.push({ name: 'helper', status: 'degraded', message: 'Write is locally enabled but the helper is unavailable' }); }
  } else checks.push({ name: 'helper', status: 'ok', message: 'Write helper intentionally disabled' });
  checks.push({ name: 'tls', status: config.platformUrl.startsWith('https://') ? 'ok' : 'degraded', message: config.platformUrl.startsWith('https://') ? 'Secure platform transport configured' : 'Insecure local-development transport configured' });
  return { ok: !checks.some((check) => check.status === 'failed'), checks };
}
