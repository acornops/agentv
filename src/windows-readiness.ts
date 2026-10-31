import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Publish bounded authentication evidence; it conveys no recovery authority. */
export function createWindowsReadiness(identity: { directory: string; launchId: string; configSha256: string }): { authenticated(): void; disconnected(): void } {
  const marker = join(identity.directory, 'authenticated.json');
  const temporary = join(identity.directory, 'authenticated.pending');
  const remove = (path: string) => { try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Windows authentication evidence unavailable'); } };
  return {
    authenticated() {
      remove(marker);
      const descriptor = openSync(temporary, 'w', 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify({ version: 1, launchId: identity.launchId, configSha256: identity.configSha256, authenticated: true, authenticatedAt: new Date().toISOString() }));
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      renameSync(temporary, marker);
    },
    disconnected() { remove(marker); remove(temporary); },
  };
}
