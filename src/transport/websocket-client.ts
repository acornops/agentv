import WebSocket from 'ws';
import type { AgentConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { HostCollector } from '../collectors/types.js';
import { handleAgentRequest } from '../mcp/router.js';
import { boundSnapshot } from '../tools/index.js';

export class VmAgentClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private stopped = false;

  /** Initialize the outbound VM agent client. */
  constructor(
    private readonly config: AgentConfig,
    private readonly collector: HostCollector,
    private readonly logger: Logger
  ) {}

  /** Start the outbound control-plane connection. */
  start(): void {
    this.connect();
  }

  /** Stop timers and close the outbound control-plane connection. */
  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'agent shutdown');
  }

  private connect(): void {
    const url = this.config.platformUrl.replace(/\/$/, '') + '/api/v1/agent/connect';
    this.logger.info({ targetId: this.config.targetId, url }, 'Connecting to control plane');
    this.ws = new WebSocket(url, {
      headers: {
        'x-agent-key': this.config.agentKey,
        'x-agent-version': 'vm-agent/0.0.1-experimental.1'
      }
    });
    this.ws.on('open', () => this.handshake());
    this.ws.on('message', (raw) => this.handleMessage(raw.toString()).catch((err) => {
      this.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed handling control-plane message');
    }));
    this.ws.on('close', () => {
      this.logger.warn({ targetId: this.config.targetId }, 'Control-plane connection closed');
      this.clearIntervals();
      this.scheduleReconnect();
    });
    this.ws.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Control-plane websocket error');
    });
  }

  private send(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }));
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  private handshake(): void {
    this.send('lifecycle/handshake', {
      agentKey: this.config.agentKey,
      targetId: this.config.targetId,
      targetType: 'virtual_machine',
      agentType: 'vm_agent',
      osFamily: this.config.osFamily,
      serviceManager: this.config.serviceManager,
      supportedCapabilities: ['read', 'logs', 'mcp', 'chat', 'systemd', 'linux']
    });
  }

  private clearIntervals(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.heartbeatTimer = null;
    this.snapshotTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.logger.info({ targetId: this.config.targetId, delayMs: 5000 }, 'Scheduling control-plane reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private async handleMessage(text: string): Promise<void> {
    const payload = JSON.parse(text) as { id?: string | number; result?: unknown; method?: string; params?: Record<string, unknown> };
    if (payload.result && !this.heartbeatTimer) {
      this.logger.info({ targetId: this.config.targetId }, 'Handshake acknowledged');
      this.heartbeatTimer = setInterval(() => this.notify('lifecycle/heartbeat', { timestamp: new Date().toISOString() }), 15000);
      this.snapshotTimer = setInterval(() => this.sendSnapshot(), this.config.snapshotIntervalMs);
      this.heartbeatTimer.unref();
      this.snapshotTimer.unref();
      await this.sendSnapshot();
      return;
    }
    if (payload.method) {
      const response = await handleAgentRequest(this.collector, payload);
      this.ws?.send(JSON.stringify(response));
    }
  }

  private async sendSnapshot(): Promise<void> {
    try {
      const snapshot = boundSnapshot(await this.collector.collectSnapshot(), this.config.maxSnapshotBytes);
      this.notify('notify/snapshot', {
        timestamp: new Date().toISOString(),
        data: snapshot
      });
      this.logger.info({
        targetId: this.config.targetId,
        bytes: Buffer.byteLength(JSON.stringify(snapshot)),
        services: snapshot.services.length,
        processes: snapshot.processes.length,
        findings: snapshot.findings.length
      }, 'Snapshot uploaded');
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Snapshot collection failed');
    }
  }
}
