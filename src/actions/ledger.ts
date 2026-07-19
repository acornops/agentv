import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { RestartReceipt, RestartRequest } from './types.js';

export interface LedgerRecord { request_hash: string; request: RestartRequest; receipt: RestartReceipt; updated_at: string; }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Hash one canonical helper request for operation-ID reuse detection. */
export function requestHash(request: RestartRequest): string { return createHash('sha256').update(stable(request)).digest('hex'); }

/** Durable bounded action ledger using atomic same-directory renames. */
export class ActionLedger {
  constructor(private readonly directory: string) {}
  private file(operationId: string): string { return path.join(this.directory, `${operationId}.json`); }

  async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await this.prune(); }
  async get(operationId: string): Promise<LedgerRecord | null> {
    try {
      const value = JSON.parse(await readFile(this.file(operationId), 'utf8')) as Partial<LedgerRecord>;
      if (!value || typeof value !== 'object' || typeof value.request_hash !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.request_hash) || value.request?.operation_id !== operationId
        || !value.receipt || value.receipt.operation_id !== operationId) throw new Error(`Action ledger record is invalid: ${operationId}`);
      return value as LedgerRecord;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async put(record: LedgerRecord): Promise<void> {
    const final = this.file(record.request.operation_id);
    const temporary = `${final}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, final);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } catch { /* Some supported filesystems do not fsync directories. */ }
      finally { await directory.close(); }
    } catch (error) {
      try { await unlink(temporary); } catch (cleanup) { if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanup; }
      throw error;
    }
  }
  async prune(): Promise<void> {
    const now = Date.now();
    const files = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{24}\.json$/.test(name));
    const records = await Promise.all(files.map(async (name) => ({ name, info: await stat(path.join(this.directory, name)) })));
    records.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    for (const [index, item] of records.entries()) if (now - item.info.mtimeMs > 7 * 24 * 60 * 60 * 1000 || index >= 1000) await unlink(path.join(this.directory, item.name));
  }
}
