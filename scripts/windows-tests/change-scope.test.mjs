import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWindowsValidation } from '../windows-change-scope.mjs';

test('documentation-only changes skip native jobs', () => {
  assert.equal(needsWindowsValidation(['docs/guide.md', 'README.md', 'LICENSE']), false);
});
test('source, fixtures, contracts, packaging and workflow changes retain native jobs', () => {
  for (const path of ['src/index.ts', 'src/windows/live.ts', 'scripts/windows-tests/host-child.mjs',
    'docs/contracts/manifest.json', 'package-lock.json', '.github/workflows/ci.yml', 'packaging/windows/AgentV.ServiceHost.cs']) {
    assert.equal(needsWindowsValidation(['docs/guide.md', path]), true, path);
  }
});
test('unresolved or empty comparisons fail open to full native validation', () => {
  for (const files of [null, []]) assert.equal(needsWindowsValidation(files), true);
});
