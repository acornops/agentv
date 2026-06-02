import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, redact } from './config.js';

const originalEnv = { ...process.env };

function setBaseEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...originalEnv,
    ACORNOPS_AGENT_PLATFORM_URL: 'https://api.acornops.dev',
    ACORNOPS_TARGET_ID: 'vm-1',
    ACORNOPS_AGENT_KEY: 'agent-key-12345678',
    ...overrides
  };
}

describe('loadConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts secure control-plane URLs', () => {
    setBaseEnv();

    const config = loadConfig();

    expect(config.platformUrl).toBe('https://api.acornops.dev');
    expect(config.allowInsecureTransport).toBe(false);
  });

  it('rejects plaintext control-plane URLs by default', () => {
    setBaseEnv({
      ACORNOPS_AGENT_PLATFORM_URL: 'http://127.0.0.1:8081'
    });

    expect(() => loadConfig()).toThrow('ACORNOPS_AGENT_PLATFORM_URL must use https://');
  });

  it('allows plaintext control-plane URLs only behind the explicit local-development override', () => {
    setBaseEnv({
      ACORNOPS_AGENT_PLATFORM_URL: 'http://127.0.0.1:8081',
      ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT: 'true'
    });

    const config = loadConfig();

    expect(config.platformUrl).toBe('http://127.0.0.1:8081');
    expect(config.allowInsecureTransport).toBe(true);
  });

  it('rejects WebSocket URLs because this setting is the platform base URL', () => {
    setBaseEnv({
      ACORNOPS_AGENT_PLATFORM_URL: 'ws://127.0.0.1:8081/api/v1/agent/connect',
      ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT: 'true'
    });

    expect(() => loadConfig()).toThrow('ACORNOPS_AGENT_PLATFORM_URL must be an https:// base URL');
  });

  it('rejects malformed platform URLs before checking transport policy', () => {
    setBaseEnv({
      ACORNOPS_AGENT_PLATFORM_URL: 'not a url'
    });

    expect(() => loadConfig()).toThrow('ACORNOPS_AGENT_PLATFORM_URL must be a valid URL');
  });

  it('treats explicit false-like insecure transport values as disabled', () => {
    setBaseEnv({
      ACORNOPS_AGENT_PLATFORM_URL: 'http://127.0.0.1:8081',
      ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT: 'off'
    });

    expect(() => loadConfig()).toThrow('ACORNOPS_AGENT_PLATFORM_URL must use https://');
  });

  it('parses VM runtime options and trims allowed log sources', () => {
    setBaseEnv({
      ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS: '60000',
      ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES: '2097152',
      ACORNOPS_AGENT_LOG_LEVEL: 'debug',
      ACORNOPS_VM_ALLOWED_LOG_SOURCES: 'journald, syslog, ,custom',
      ACORNOPS_VM_COLLECTOR_MODE: 'mock',
      ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT: 'yes'
    });

    expect(loadConfig()).toMatchObject({
      snapshotIntervalMs: 60000,
      maxSnapshotBytes: 2097152,
      logLevel: 'debug',
      allowedLogSources: ['journald', 'syslog', 'custom'],
      collectorMode: 'mock',
      osFamily: 'linux',
      serviceManager: 'systemd',
      targetType: 'virtual_machine',
      allowInsecureTransport: true
    });
  });

  it.each([
    ['ACORNOPS_AGENT_TARGET_TYPE', 'kubernetes', 'ACORNOPS_AGENT_TARGET_TYPE must be virtual_machine'],
    ['ACORNOPS_VM_OS_FAMILY', 'windows', 'Only ACORNOPS_VM_OS_FAMILY=linux is supported in v1'],
    ['ACORNOPS_VM_SERVICE_MANAGER', 'launchd', 'Only ACORNOPS_VM_SERVICE_MANAGER=systemd is supported in v1'],
    ['ACORNOPS_VM_COLLECTOR_MODE', 'fixture', 'ACORNOPS_VM_COLLECTOR_MODE must be live or mock']
  ])('rejects unsupported %s values', (name, value, message) => {
    setBaseEnv({ [name]: value });

    expect(() => loadConfig()).toThrow(message);
  });

  it.each([
    ['ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS', '4999', 'ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS must be between 5000 and 86400000'],
    ['ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS', '86400001', 'ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS must be between 5000 and 86400000'],
    ['ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES', '4095', 'ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES must be between 4096 and 10485760'],
    ['ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES', 'not-a-number', 'ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES must be between 4096 and 10485760']
  ])('rejects invalid numeric config %s=%s', (name, value, message) => {
    setBaseEnv({ [name]: value });

    expect(() => loadConfig()).toThrow(message);
  });

  it('requires target identity and agent key', () => {
    setBaseEnv({ ACORNOPS_TARGET_ID: undefined });
    expect(() => loadConfig()).toThrow('ACORNOPS_TARGET_ID is required');

    setBaseEnv({ ACORNOPS_AGENT_KEY: undefined });
    expect(() => loadConfig()).toThrow('ACORNOPS_AGENT_KEY is required');
  });

  it('redacts short and long secret values for logs', () => {
    expect(redact('short')).toBe('<redacted>');
    expect(redact('agent-key-12345678')).toBe('agen...5678');
    expect(redact('')).toBe('');
  });
});
