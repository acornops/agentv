import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Publish bounded authentication evidence; it conveys no recovery authority. */
export function createWindowsReadiness(identity: { directory: string; launchId: string; configSha256: string }): { authenticated(): void; provisionalAuthenticated(): void; disconnected(): void } {
  const marker = join(identity.directory, 'authenticated.json');
  const temporary = join(identity.directory, 'authenticated.pending');
  const remove = (path: string) => { try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Windows authentication evidence unavailable'); } };
  const publish = (phase: 'provisional' | 'active') => {
    remove(marker);
    const descriptor = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify({ version: 1, launchId: identity.launchId, configSha256: identity.configSha256, authenticated: true, phase, authenticatedAt: new Date().toISOString() }));
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temporary, marker);
  };
  return {
    authenticated() { publish('active'); },
    provisionalAuthenticated() { publish('provisional'); },
    disconnected() { remove(marker); remove(temporary); },
  };
}
