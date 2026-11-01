import { writeFileSync } from 'node:fs';
import { buildSnapshotContractCases } from '../../src/windows/fixtures/snapshot-contract-cases.js';

// Run from AgentV: node --import tsx scripts/windows-tests/generate-snapshot-contract.ts
writeFileSync(new URL('../../src/windows/fixtures/snapshot-contract.json', import.meta.url),
  JSON.stringify(await buildSnapshotContractCases(), null, 2) + '\n');
