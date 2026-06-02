import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters messages below the configured level', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger('warn');

    logger.info({ targetId: 'vm-1' }, 'ignored');
    logger.warn({ targetId: 'vm-1' }, 'kept');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(writeSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'warn',
      message: 'kept',
      targetId: 'vm-1'
    });
  });

  it('redacts secret-like fields and nested values before writing logs', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger('debug');

    logger.info({
      agentKey: 'agent-key-12345678',
      nested: {
        Authorization: 'Bearer secret-token',
        safe: 'visible'
      },
      args: ['--token=secret-value', 'plain']
    }, 'sanitized');

    const payload = JSON.parse(String(writeSpy.mock.calls[0]?.[0])) as Record<string, unknown>;

    expect(payload).toMatchObject({
      level: 'info',
      message: 'sanitized',
      agentKey: '<redacted>',
      nested: {
        Authorization: '<redacted>',
        safe: 'visible'
      },
      args: ['--to...alue', 'plain']
    });
    expect(JSON.stringify(payload)).not.toContain('agent-key-12345678');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
    expect(JSON.stringify(payload)).not.toContain('secret-value');
  });

  it('preserves non-secret scalar fields and writes all enabled levels', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger('debug');

    logger.debug({ count: 1, enabled: true, nothing: null }, 'debug message');
    logger.error({ reason: 'failed' }, 'error message');

    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(writeSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'debug',
      message: 'debug message',
      count: 1,
      enabled: true,
      nothing: null
    });
    expect(JSON.parse(String(writeSpy.mock.calls[1]?.[0]))).toMatchObject({
      level: 'error',
      message: 'error message',
      reason: 'failed'
    });
  });
});
