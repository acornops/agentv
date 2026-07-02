import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const doc = read('docs/contracts/README.md');
const manifest = JSON.parse(read('docs/contracts/manifest.json'));

expect(manifest.repo === 'agentv', 'Manifest repo must be agentv');
expect(manifest.version === 1, 'Manifest version must be 1');
expect(Array.isArray(manifest.runtimeDependencies), 'Manifest runtimeDependencies must be an array');
expect(doc.includes('## Dependency Matrix'), 'Contract doc missing dependency matrix');
expect(doc.includes('## Shared Invariants'), 'Contract doc missing shared invariants');
expect(doc.includes('## Validation'), 'Contract doc missing validation section');
expect(doc.includes('targetType = "virtual_machine"'), 'Contract doc missing VM target type');
expect(doc.includes('agentType = "agentv"'), 'Contract doc missing AgentV type');

const controlPlane = manifest.counterparts?.['control-plane'];
expect(Boolean(controlPlane), 'Manifest must include control-plane counterpart');
expect(controlPlane?.websocketPaths?.includes('/api/v1/agent/connect'), 'Manifest missing primary agent WebSocket path');
expect(controlPlane?.rpcMethods?.includes('tools/list'), 'Manifest missing tools/list RPC method');
expect(controlPlane?.rpcMethods?.includes('tools/call'), 'Manifest missing tools/call RPC method');
expect(controlPlane?.builtinToolNames?.includes('get_host_summary'), 'Manifest missing built-in VM tool names');

if (failures.length > 0) {
  console.error('Contract checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Contract checks passed.');
