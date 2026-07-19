import { EventEmitter } from 'node:events';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionError } from '../tools/errors.js';
import { SocketActionClient } from './client.js';
import type { RestartRequest } from './types.js';

class FakeSocket extends EventEmitter {
  destroyed = false;
  constructor(private readonly reply: (request: Record<string, unknown>) => string) {
    super();
    queueMicrotask(() => { if (!this.destroyed) this.emit('connect'); });
  }
  write(payload: string): boolean {
    const response = this.reply(JSON.parse(payload.trim()) as Record<string, unknown>);
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.emit('data', Buffer.from(response));
      this.emit('end');
    });
    return true;
  }
  destroy(): this { this.destroyed = true; return this; }
}

afterEach(() => vi.restoreAllMocks());

function mockSocket(reply: (request: Record<string, unknown>) => unknown): void {
  vi.spyOn(net, 'createConnection').mockImplementation(() => new FakeSocket((request) => {
    const response = reply(request);
    return typeof response === 'string' ? response : `${JSON.stringify(response)}\n`;
  }) as unknown as net.Socket);
}

const restartRequest: RestartRequest = {
  protocol_version: 1,
  action: 'restart_service',
  operation_id: '0123456789abcdef01234567',
  unit: 'disposable-worker.service',
  reason: 'Recover the approved disposable worker',
  expected_active_state: 'active',
  expected_sub_state: 'running',
};
const receipt = {
  operation_id: restartRequest.operation_id,
  unit: restartRequest.unit,
  outcome: 'success',
  before: { active_state: 'active', sub_state: 'running', invocation_id: 'before' },
  after: { active_state: 'active', sub_state: 'running', invocation_id: 'after' },
  started_at: '2026-07-19T00:00:00.000Z',
  completed_at: '2026-07-19T00:00:01.000Z',
  systemd_job_result: 'done',
};

describe('SocketActionClient', () => {
  it('exchanges strict capability and restart results over the bounded protocol', async () => {
    const requests: Record<string, unknown>[] = [];
    mockSocket((request) => {
      requests.push(request);
      return request.action === 'capabilities'
        ? { ok: true, result: { protocol_version: 1, policy_valid: true, restart_services: [restartRequest.unit] } }
        : { ok: true, result: receipt };
    });
    const client = new SocketActionClient('/run/acornops-agentv/actions.sock');
    await expect(client.capabilities()).resolves.toMatchObject({ policy_valid: true, restart_services: [restartRequest.unit] });
    await expect(client.restart(restartRequest)).resolves.toEqual(receipt);
    expect(requests).toEqual([{ protocol_version: 1, action: 'capabilities' }, restartRequest]);
  });

  it('rejects malformed success results on both sides of the mutation boundary', async () => {
    mockSocket(() => ({ ok: true, result: { protocol_version: 2 } }));
    const client = new SocketActionClient('/run/acornops-agentv/actions.sock');
    await expect(client.capabilities()).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'HOST_UNAVAILABLE', data: { outcome: 'not_started' } });
    await expect(client.restart(restartRequest)).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'HOST_UNAVAILABLE', data: { outcome: 'unknown' } });
  });

  it('maps bounded helper failures without trusting helper-provided error codes', async () => {
    mockSocket(() => ({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'denied', outcome: 'not_started' } }));
    await expect(new SocketActionClient('/actions.sock').capabilities()).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'PERMISSION_DENIED' });
    vi.restoreAllMocks();
    mockSocket(() => ({ ok: false, error: { code: 'ARBITRARY_CODE', message: 'nope' } }));
    await expect(new SocketActionClient('/actions.sock').capabilities()).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'INTERNAL_ERROR' });
    vi.restoreAllMocks();
    mockSocket(() => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: { secret: true }, outcome: 'success' } }));
    await expect(new SocketActionClient('/actions.sock').restart(restartRequest)).rejects.toMatchObject<ToolExecutionError>({
      message: 'Action helper rejected the request', data: { outcome: 'not_started' },
    });
  });

  it('rejects malformed and oversized helper responses', async () => {
    mockSocket(() => 'not-json\n');
    await expect(new SocketActionClient('/actions.sock').capabilities()).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'HOST_UNAVAILABLE' });
    vi.restoreAllMocks();
    mockSocket(() => `${'x'.repeat(33 * 1024)}\n`);
    await expect(new SocketActionClient('/actions.sock').capabilities()).rejects.toMatchObject<ToolExecutionError>({ toolCode: 'OUTPUT_TOO_LARGE' });
  });

  it('marks a pre-connect abort as not started', async () => {
    mockSocket(() => ({ ok: true, result: {} }));
    const controller = new AbortController();
    controller.abort();
    await expect(new SocketActionClient('/actions.sock').capabilities(controller.signal))
      .rejects.toMatchObject<ToolExecutionError>({ toolCode: 'TOOL_TIMEOUT', data: { outcome: 'not_started' } });
  });
});
