import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import WebSocket from 'ws';
import type { AgentConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { Observability } from '../observability.js';

/** Own the raw WebSocket, transport heartbeats, backpressure, and jittered reconnects. */
export class WebSocketClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongDeadline: NodeJS.Timeout | null = null;
  private attempts = 0;
  private stopped = true;
  readonly outboundBufferLimit = 2 * 1024 * 1024;

  constructor(private readonly config: AgentConfig, private readonly logger: Logger, private readonly metrics: Observability) { super(); }

  connect(): void {
    this.stopped = false; this.clearReconnect();
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const url = `${this.config.platformUrl.replace(/\/$/, '')}/api/v1/agent/connect`;
    const socket = new WebSocket(url, {
      maxPayload: 1024 * 1024,
      headers: { 'x-agent-key': this.config.agentKey, 'x-agent-version': `agentv/${this.config.agentVersion}` },
      ...(this.config.additionalCaBundleFile ? { ca: [...rootCertificates, readFileSync(this.config.additionalCaBundleFile)] } : {}),
    });
    this.socket = socket;
    socket.on('open', () => { if (this.socket !== socket || this.stopped) return; this.startPing(socket); this.emit('open'); });
    socket.on('message', (data) => { if (this.socket === socket && !this.stopped) this.emit('message', data); });
    socket.on('pong', () => { if (this.pongDeadline) clearTimeout(this.pongDeadline); this.pongDeadline = null; });
    socket.on('error', (error) => { if (this.socket === socket && !this.stopped) this.emit('error', error); });
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null; this.clearPing(); this.emit('close', code, reason.toString()); this.scheduleReconnect();
    });
  }

  send(payload: string | Buffer): boolean {
    const socket = this.socket;
    const bytes = Buffer.byteLength(payload);
    if (this.stopped || !socket || socket.readyState !== WebSocket.OPEN || bytes > this.outboundBufferLimit || socket.bufferedAmount + bytes > this.outboundBufferLimit) return false;
    socket.send(payload); return true;
  }

  markReady(): void { this.attempts = 0; }
  isOpen(): boolean { return !this.stopped && this.socket?.readyState === WebSocket.OPEN; }

  forceReconnect(): void {
    if (this.stopped) return;
    const socket = this.socket; this.socket = null; this.clearPing();
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    this.emit('close', 1006, 'forced reconnect'); this.scheduleReconnect();
  }

  close(): void {
    this.stopped = true; this.clearReconnect(); this.clearPing();
    const socket = this.socket; this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'agent shutdown');
  }

  private startPing(socket: WebSocket): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      socket.ping();
      if (this.pongDeadline) clearTimeout(this.pongDeadline);
      this.pongDeadline = setTimeout(() => { this.logger.warn({}, 'WebSocket pong deadline exceeded'); this.forceReconnect(); }, 10_000);
      this.pongDeadline.unref();
    }, 30_000); this.pingTimer.unref();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(1000 * 2 ** this.attempts, 15_000);
    const delay = Math.round(base / 2 + Math.random() * base / 2); this.attempts++; this.metrics.increment('reconnects');
    this.logger.info({ delayMs: delay, attempt: this.attempts }, 'Scheduling control-plane reconnect');
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.stopped) this.connect(); }, delay);
  }

  private clearReconnect(): void { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  private clearPing(): void { if (this.pingTimer) clearInterval(this.pingTimer); if (this.pongDeadline) clearTimeout(this.pongDeadline); this.pingTimer = null; this.pongDeadline = null; }
}
