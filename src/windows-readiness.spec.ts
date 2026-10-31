import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWindowsReadiness } from './windows-readiness.js';

describe('launch-bound Windows authentication evidence', () => {
  it('replaces stale evidence on authentication and invalidates it on disconnect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentv-readiness-'));
    try {
      await writeFile(join(directory, 'authenticated.json'), '{"launchId":"old"}');
      const state = createWindowsReadiness({ directory, launchId: 'a747fa58-2486-4fb3-a050-a46eece839b0', configSha256: 'a'.repeat(64) });
      state.disconnected();
      expect(await readdir(directory)).toEqual([]);
      state.authenticated();
      const evidence = JSON.parse(await readFile(join(directory, 'authenticated.json'), 'utf8'));
      expect(evidence).toMatchObject({ version: 1, launchId: 'a747fa58-2486-4fb3-a050-a46eece839b0', configSha256: 'a'.repeat(64), authenticated: true });
      expect(Date.now() - Date.parse(evidence.authenticatedAt)).toBeLessThan(5000);
      state.disconnected(); state.disconnected();
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('fails closed when it cannot publish authentication evidence', async () => {
    const state = createWindowsReadiness({ directory: '/not-an-agentv-state-directory', launchId: 'bad', configSha256: 'bad' });
    expect(() => state.authenticated()).toThrow();
  });
});
