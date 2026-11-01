import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildSnapshotContractCases } from './fixtures/snapshot-contract-cases.js';

it('serializes real Windows snapshot builds identically to the consumer contract artifact', async () => {
  const artifact = readFileSync(new URL('./fixtures/snapshot-contract.json', import.meta.url), 'utf8');
  expect(JSON.stringify(await buildSnapshotContractCases(), null, 2) + '\n').toBe(artifact);
});
