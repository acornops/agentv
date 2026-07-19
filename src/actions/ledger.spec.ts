import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionLedger, requestHash } from './ledger.js';
import type { RestartRequest } from './types.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
describe('ActionLedger', () => {
  it('atomically persists request hashes and unknown in-progress receipts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agentv-ledger-')); directories.push(directory);
    const ledger = new ActionLedger(directory); await ledger.initialize();
    const request: RestartRequest = { protocol_version: 1, action: 'restart_service', operation_id: '0123456789abcdef01234567', unit: 'ssh.service', reason: 'test', expected_active_state: 'active', expected_sub_state: 'running' };
    const receipt = { operation_id: request.operation_id, unit: request.unit, outcome: 'unknown' as const, before: { active_state: 'active', sub_state: 'running', invocation_id: 'old' }, after: null, started_at: '2026-01-01T00:00:00Z', completed_at: null, systemd_job_result: null };
    await ledger.put({ request_hash: requestHash(request), request, receipt, updated_at: receipt.started_at });
    expect(await ledger.get(request.operation_id)).toMatchObject({ request_hash: requestHash(request), receipt: { outcome: 'unknown' } });
  });
});
