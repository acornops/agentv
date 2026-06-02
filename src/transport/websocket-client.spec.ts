import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../config.js';
import type { HostCollector } from '../collectors/types.js';
import { mockSnapshot } from '../collectors/mock.js';
import type { Logger } from '../logger.js';

const { MockWebSocket, socketInstances } = vi.hoisted(() => {
  class SimpleEmitter {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, listener: (...args: unknown[]) => void): this {
      const handlers = this.listeners.get(event) ?? [];
      handlers.push(listener);
      this.listeners.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const handlers = this.listeners.get(event) ?? [];
      handlers.forEach((listener) => listener(...args));
      return handlers.length > 0;
    }
  }

  const socketInstances: Array<InstanceType<typeof MockWebSocket>> = [];

  class MockWebSocket extends SimpleEmitter {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readonly url: string;
    readonly options: Record<string, unknown>;
    readyState = MockWebSocket.OPEN;
    send = vi.fn();
    close = vi.fn((code?: number, reason?: string) => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', code, reason);
    });

    constructor(url: string, options: Record<string, unknown>) {
      super();
      this.url = url;
      this.options = options;
      socketInstances.push(this);
    }
  }

  return { MockWebSocket, socketInstances };
});

vi.mock('ws', () => ({ default: MockWebSocket }));

import { VmAgentClient } from './websocket-client.js';

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    platformUrl: 'http://127.0.0.1:8081/',
    targetId: 'vm-1',
    agentKey: 'agent-key-12345678',
    targetType: 'virtual_machine',
    snapshotIntervalMs: 5000,
    maxSnapshotBytes: 1_048_576,
    logLevel: 'info',
    osFamily: 'linux',
    serviceManager: 'systemd',
    allowedLogSources: ['journald', 'syslog'],
    collectorMode: 'mock',
    allowInsecureTransport: true,
    ...overrides
  };
}

function testLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function testCollector(): HostCollector {
  return {
    collectSnapshot: vi.fn(async () => mockSnapshot()),
    getLogs: vi.fn(async () => ({ entries: [] }))
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function sentJson(socket: InstanceType<typeof MockWebSocket>, index: number) {
  return JSON.parse(String(socket.send.mock.calls[index]?.[0])) as {
    jsonrpc: string;
    id?: string | number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
  };
}

describe('VmAgentClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    socketInstances.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('connects to the VM agent endpoint with agent headers and sends a VM handshake', () => {
    const client = new VmAgentClient(baseConfig(), testCollector(), testLogger());

    client.start();
    socketInstances[0]?.emit('open');

    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0]?.url).toBe('http://127.0.0.1:8081/api/v1/agent/connect');
    expect(socketInstances[0]?.options).toEqual({
      headers: {
        'x-agent-key': 'agent-key-12345678',
        'x-agent-version': 'vm-agent/0.0.1-experimental.1'
      }
    });
    expect(sentJson(socketInstances[0]!, 0)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'lifecycle/handshake',
      params: {
        agentKey: 'agent-key-12345678',
        targetId: 'vm-1',
        targetType: 'virtual_machine',
        agentType: 'vm_agent',
        osFamily: 'linux',
        serviceManager: 'systemd',
        supportedCapabilities: ['read', 'logs', 'mcp', 'chat', 'systemd', 'linux']
      }
    });
  });

  it('starts heartbeats and sends an immediate bounded snapshot after handshake acknowledgement', async () => {
    const collector = testCollector();
    const client = new VmAgentClient(baseConfig({ snapshotIntervalMs: 60000 }), collector, testLogger());

    client.start();
    socketInstances[0]!.emit('open');
    socketInstances[0]!.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await flushPromises();

    expect(collector.collectSnapshot).toHaveBeenCalledTimes(1);
    expect(sentJson(socketInstances[0]!, 1)).toMatchObject({
      jsonrpc: '2.0',
      method: 'notify/snapshot',
      params: { data: { host: { osFamily: 'linux', serviceManager: 'systemd' } } }
    });

    vi.advanceTimersByTime(15000);
    expect(sentJson(socketInstances[0]!, 2)).toMatchObject({
      jsonrpc: '2.0',
      method: 'lifecycle/heartbeat',
      params: { timestamp: expect.any(String) }
    });

    await vi.advanceTimersByTimeAsync(60000);
    await flushPromises();
    expect(collector.collectSnapshot).toHaveBeenCalledTimes(2);
    expect(socketInstances[0]!.send.mock.calls.map((_, index) => sentJson(socketInstances[0]!, index).method)
      .filter((method) => method === 'notify/snapshot')).toHaveLength(2);
  });

  it('routes control-plane JSON-RPC tool requests back over the same socket', async () => {
    const client = new VmAgentClient(baseConfig(), testCollector(), testLogger());

    client.start();
    socketInstances[0]!.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/call',
      params: { name: 'list_services', arguments: {} }
    }));
    await flushPromises();

    expect(sentJson(socketInstances[0]!, 0)).toMatchObject({
      jsonrpc: '2.0',
      id: 'tools-1',
      result: { services: expect.any(Array) }
    });
  });

  it('logs malformed control-plane messages without tearing down the client', async () => {
    const logger = testLogger();
    const client = new VmAgentClient(baseConfig(), testCollector(), logger);

    client.start();
    socketInstances[0]!.emit('message', '{not-json');
    await flushPromises();

    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(String) },
      'Failed handling control-plane message'
    );
    expect(socketInstances[0]?.close).not.toHaveBeenCalled();
  });

  it('logs websocket errors without scheduling reconnect until close', () => {
    const logger = testLogger();
    const client = new VmAgentClient(baseConfig(), testCollector(), logger);

    client.start();
    socketInstances[0]!.emit('error', new Error('socket boom'));

    expect(logger.error).toHaveBeenCalledWith(
      { err: 'socket boom' },
      'Control-plane websocket error'
    );
    vi.advanceTimersByTime(60000);
    expect(socketInstances).toHaveLength(1);
  });

  it('logs snapshot collection failures without sending a snapshot notification', async () => {
    const logger = testLogger();
    const collector: HostCollector = {
      collectSnapshot: vi.fn(async () => {
        throw 'snapshot failed';
      }),
      getLogs: vi.fn(async () => ({ entries: [] }))
    };
    const client = new VmAgentClient(baseConfig(), collector, logger);

    client.start();
    socketInstances[0]!.emit('open');
    socketInstances[0]!.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'snapshot failed' },
      'Snapshot collection failed'
    );
    expect(socketInstances[0]!.send.mock.calls.map((_, index) => sentJson(socketInstances[0]!, index).method))
      .not.toContain('notify/snapshot');
  });

  it('clears timers on close and reconnects once after the reconnect delay', async () => {
    const client = new VmAgentClient(baseConfig({ snapshotIntervalMs: 5000 }), testCollector(), testLogger());

    client.start();
    socketInstances[0]!.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    await flushPromises();

    socketInstances[0]!.emit('close');
    const sendCountAfterClose = socketInstances[0]!.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4999);
    expect(socketInstances[0]!.send).toHaveBeenCalledTimes(sendCountAfterClose);

    expect(socketInstances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(socketInstances).toHaveLength(2);
  });

  it('suppresses reconnects after stop and closes the socket with a shutdown reason', () => {
    const client = new VmAgentClient(baseConfig(), testCollector(), testLogger());

    client.start();
    client.stop();

    expect(socketInstances[0]!.close).toHaveBeenCalledWith(1000, 'agent shutdown');
    vi.advanceTimersByTime(60000);
    expect(socketInstances).toHaveLength(1);
  });

  it('does not send payloads while the websocket is not open', () => {
    const client = new VmAgentClient(baseConfig(), testCollector(), testLogger());

    client.start();
    socketInstances[0]!.readyState = MockWebSocket.CLOSED;
    socketInstances[0]!.emit('open');

    expect(socketInstances[0]!.send).not.toHaveBeenCalled();
  });
});
