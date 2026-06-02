export type CollectorMode = 'live' | 'mock';
export type OsFamily = 'linux';
export type ServiceManager = 'systemd';

export interface AgentConfig {
  platformUrl: string;
  targetId: string;
  agentKey: string;
  targetType: 'virtual_machine';
  snapshotIntervalMs: number;
  maxSnapshotBytes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  osFamily: OsFamily;
  serviceManager: ServiceManager;
  allowedLogSources: string[];
  collectorMode: CollectorMode;
  allowInsecureTransport: boolean;
}

/** Read a required environment value with an optional fallback. */
function env(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Read and validate an integer environment value. */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

/** Read a comma-separated environment value as a trimmed list. */
function csvEnv(name: string, fallback: string): string[] {
  return (process.env[name] || fallback)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Read a boolean environment value. */
function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Read and validate the platform URL according to transport policy. */
function platformUrlEnv(allowInsecureTransport: boolean): string {
  const value = env('ACORNOPS_AGENT_PLATFORM_URL');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('ACORNOPS_AGENT_PLATFORM_URL must be a valid URL');
  }
  if (parsed.protocol === 'https:') return value;
  if (parsed.protocol === 'http:' && allowInsecureTransport) return value;
  if (parsed.protocol === 'http:') {
    throw new Error('ACORNOPS_AGENT_PLATFORM_URL must use https://; set ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT=true only for local development');
  }
  throw new Error('ACORNOPS_AGENT_PLATFORM_URL must be an https:// base URL');
}

/** Redact a sensitive string for logs. */
export function redact(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '<redacted>';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Load and validate VM agent configuration from the environment. */
export function loadConfig(): AgentConfig {
  const allowInsecureTransport = boolEnv('ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT');
  const targetType = env('ACORNOPS_AGENT_TARGET_TYPE', 'virtual_machine');
  if (targetType !== 'virtual_machine') {
    throw new Error('ACORNOPS_AGENT_TARGET_TYPE must be virtual_machine');
  }
  const osFamily = env('ACORNOPS_VM_OS_FAMILY', 'linux');
  if (osFamily !== 'linux') {
    throw new Error('Only ACORNOPS_VM_OS_FAMILY=linux is supported in v1');
  }
  const serviceManager = env('ACORNOPS_VM_SERVICE_MANAGER', 'systemd');
  if (serviceManager !== 'systemd') {
    throw new Error('Only ACORNOPS_VM_SERVICE_MANAGER=systemd is supported in v1');
  }
  const collectorMode = env('ACORNOPS_VM_COLLECTOR_MODE', 'live');
  if (collectorMode !== 'live' && collectorMode !== 'mock') {
    throw new Error('ACORNOPS_VM_COLLECTOR_MODE must be live or mock');
  }

  return {
    platformUrl: platformUrlEnv(allowInsecureTransport),
    targetId: env('ACORNOPS_TARGET_ID'),
    agentKey: env('ACORNOPS_AGENT_KEY'),
    targetType,
    snapshotIntervalMs: intEnv('ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS', 30_000, 5_000, 86_400_000),
    maxSnapshotBytes: intEnv('ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES', 1_048_576, 4096, 10 * 1024 * 1024),
    logLevel: (process.env.ACORNOPS_AGENT_LOG_LEVEL || 'info') as AgentConfig['logLevel'],
    osFamily,
    serviceManager,
    allowedLogSources: csvEnv('ACORNOPS_VM_ALLOWED_LOG_SOURCES', 'journald,syslog'),
    collectorMode,
    allowInsecureTransport
  };
}
