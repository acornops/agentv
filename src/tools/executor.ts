import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import type { Observability } from '../observability.js';
import { redactValue } from '../redaction.js';
import { mapHostError, ToolExecutionError } from './errors.js';
import type { ToolCapability } from './registry.js';
import { toolRegistry } from './registry.js';

export interface ToolSessionPolicy {
  allowedTools: ReadonlySet<string>;
  writeEnabled: boolean;
  generation: number;
  targetId: string;
}

interface ExecutorLimits {
  readConcurrency: number;
  writeConcurrency: number;
  queueLimit: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  localWriteEnabled: () => boolean;
  metrics?: Observability;
}

function validationDetails(error: ZodError): Record<string, unknown> {
  const issues = error.issues.slice(0, 12).map((issue) => ({
    code: issue.code,
    path: issue.path.slice(0, 6).map((part) => typeof part === 'string' ? part.slice(0, 64) : part),
    message: issue.message.slice(0, 240),
  }));
  return { issues, ...(error.issues.length > issues.length ? { omittedIssues: error.issues.length - issues.length } : {}) };
}

class QueueBudget {
  queued = 0;
  constructor(readonly limit: number) {}
  enter(): boolean { if (this.queued >= this.limit) return false; this.queued++; return true; }
  leave(): void { this.queued--; }
}

class Gate {
  private active = 0;
  private readonly queue: Array<{ generation: number; resolve: () => void; reject: (error: unknown) => void; timer: NodeJS.Timeout }> = [];
  constructor(private readonly concurrency: number, private readonly budget: QueueBudget) {}

  async acquire(timeoutMs: number, generation: number): Promise<() => void> {
    if (this.active < this.concurrency) { this.active++; return () => this.release(); }
    if (!this.budget.enter()) throw new ToolExecutionError('TOOL_BUSY', 'Tool executor queue is full');
    await new Promise<void>((resolve, reject) => {
      const item = {
        generation,
        resolve: () => { clearTimeout(item.timer); this.budget.leave(); resolve(); },
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(item);
          if (index >= 0) this.queue.splice(index, 1);
          this.budget.leave();
          reject(new ToolExecutionError('TOOL_TIMEOUT', 'Tool timed out in the execution queue', { phase: 'queue', outcome: 'not_started' }));
        }, timeoutMs),
      };
      this.queue.push(item);
    });
    return () => this.release();
  }

  cancelGeneration(generation?: number): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const item = this.queue[index];
      if (generation === undefined || item.generation === generation) {
        this.queue.splice(index, 1); clearTimeout(item.timer); this.budget.leave();
        item.reject(new ToolExecutionError('TOOL_NOT_ALLOWED', 'Tool session generation is no longer active'));
      }
    }
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next.resolve(); else this.active--;
  }
}

/** Authorize, bound, schedule, cancel, redact, and execute AgentV tools. */
export class ToolExecutor {
  private activeGeneration: number | null = null;
  private readonly activeControllers = new Map<number, Set<AbortController>>();
  private readonly gates: Record<ToolCapability, Gate>;
  private readonly limits: ExecutorLimits;

  constructor(limits: Partial<ExecutorLimits> = {}) {
    this.limits = {
      readConcurrency: 4, writeConcurrency: 1, queueLimit: 16,
      maxInputBytes: 1024 * 1024, maxOutputBytes: 2 * 1024 * 1024,
      localWriteEnabled: () => false, ...limits,
    };
    const budget = new QueueBudget(this.limits.queueLimit);
    this.gates = { read: new Gate(this.limits.readConcurrency, budget), write: new Gate(this.limits.writeConcurrency, budget) };
  }

  setActiveGeneration(generation: number): void {
    if (this.activeGeneration !== null && this.activeGeneration !== generation) this.cancelQueued();
    this.activeGeneration = generation;
  }

  clearActiveGeneration(): void { this.activeGeneration = null; this.cancelQueued(); }

  async execute(input: { name: string; arguments: unknown; requestId: string | number; policy: ToolSessionPolicy }): Promise<unknown> {
    this.limits.metrics?.increment('tool_calls');
    const { policy } = input;
    if (this.activeGeneration !== policy.generation) throw new ToolExecutionError('TOOL_NOT_ALLOWED', 'Tool session is no longer active');
    const tool = toolRegistry.get(input.name);
    if (!tool || !policy.allowedTools.has(input.name)) throw new ToolExecutionError('TOOL_NOT_ALLOWED', 'Tool is not allowed for this session');
    if (tool.capability === 'write' && (!policy.writeEnabled || !this.limits.localWriteEnabled())) {
      throw new ToolExecutionError('WRITE_DISABLED', 'Write operations are disabled for this session');
    }
    let serializedInput: string;
    try { serializedInput = JSON.stringify(input.arguments); } catch {
      this.limits.metrics?.increment('validation_failures');
      throw new ToolExecutionError('INVALID_ARGUMENTS', 'Tool arguments must be JSON serializable');
    }
    if (serializedInput === undefined || Buffer.byteLength(serializedInput) > this.limits.maxInputBytes) {
      this.limits.metrics?.increment('validation_failures');
      throw new ToolExecutionError('INVALID_ARGUMENTS', 'Tool input exceeds the configured size limit');
    }
    const parsed = tool.schema.safeParse(input.arguments);
    if (!parsed.success) {
      this.limits.metrics?.increment('validation_failures');
      throw new ToolExecutionError('INVALID_ARGUMENTS', 'Invalid tool arguments', validationDetails(parsed.error));
    }
    tool.scopeResolver(parsed.data);

    const operationId = createHash('sha256')
      .update(`${policy.targetId}:${typeof input.requestId}:${String(input.requestId)}`)
      .digest('hex').slice(0, 24);
    const deadline = Date.now() + tool.timeoutMs;
    let release: () => void;
    try { release = await this.gates[tool.capability].acquire(tool.timeoutMs, policy.generation); }
    catch (error) {
      if (error instanceof ToolExecutionError && error.toolCode === 'TOOL_BUSY') this.limits.metrics?.increment('queue_saturation');
      if (error instanceof ToolExecutionError && error.toolCode === 'TOOL_TIMEOUT') this.limits.metrics?.increment('timeouts');
      throw error;
    }
    let timedOut = false;
    let handler: Promise<unknown> | undefined;
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    const controllers = this.activeControllers.get(policy.generation) || new Set<AbortController>();
    controllers.add(controller); this.activeControllers.set(policy.generation, controllers);
    try {
      if (this.activeGeneration !== policy.generation) throw new ToolExecutionError('TOOL_NOT_ALLOWED', 'Tool session is no longer active');
      handler = Promise.resolve(tool.handler(parsed.data, { operationId, requestId: input.requestId, sessionGeneration: policy.generation, signal: controller.signal }));
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true; controller.abort();
          this.limits.metrics?.increment('timeouts');
          reject(new ToolExecutionError('TOOL_TIMEOUT', `Tool '${tool.name}' timed out`, {
            phase: 'execution', operationId, ...(tool.capability === 'write' ? { outcome: 'unknown' } : {}),
          }));
        }, Math.max(1, deadline - Date.now()));
      });
      const result = redactValue(await Promise.race([handler, timeout]));
      if (this.activeGeneration !== policy.generation) throw new ToolExecutionError('TOOL_NOT_ALLOWED', 'Tool session is no longer active');
      const serialized = JSON.stringify(result);
      if (serialized === undefined) throw new ToolExecutionError('INTERNAL_ERROR', 'Tool returned no result');
      if (Buffer.byteLength(serialized) > this.limits.maxOutputBytes) {
        this.limits.metrics?.increment('truncations');
        throw new ToolExecutionError('OUTPUT_TOO_LARGE', 'Tool result exceeds the configured size limit', {
          ...(tool.capability === 'write' ? { outcome: 'unknown', operationId } : {}),
        });
      }
      return result;
    } catch (error) {
      const mapped = mapHostError(error);
      if (tool.capability === 'write' && mapped.data.outcome !== 'not_started' && !mapped.data.outcome) {
        throw new ToolExecutionError(mapped.toolCode, mapped.message, { ...mapped.data, outcome: 'unknown', operationId });
      }
      throw mapped;
    } finally {
      if (timer) clearTimeout(timer);
      controllers.delete(controller); if (!controllers.size) this.activeControllers.delete(policy.generation);
      if (timedOut && handler) void handler.catch(() => undefined).finally(release); else release();
    }
  }

  private cancelQueued(): void {
    this.gates.read.cancelGeneration(); this.gates.write.cancelGeneration();
    for (const controllers of this.activeControllers.values()) for (const controller of controllers) controller.abort();
  }
}
