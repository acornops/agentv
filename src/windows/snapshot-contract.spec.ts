import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildSnapshotContractCases } from './fixtures/snapshot-contract-cases.js';

it.each([['LF', '\n'], ['CRLF', '\r\n']])('serializes real Windows snapshot builds identically to the %s checkout artifact', async (_name, newline) => {
  const artifact = readFileSync(new URL('./fixtures/snapshot-contract.json', import.meta.url), 'utf8');
  const checkoutArtifact = artifact.replace(/\r?\n/g, newline);
  // Normalize checkout whitespace only; JSON string escapes and producer output stay exact.
  expect(JSON.stringify(await buildSnapshotContractCases(), null, 2) + '\n').toBe(checkoutArtifact.replace(/\r\n/g, '\n'));
});
