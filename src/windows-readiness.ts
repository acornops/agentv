import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Publish bounded authentication evidence; it conveys no recovery authority. */
export function createWindowsReadiness(identity: { directory: string; launchId: string; configSha256: string }): { authenticated(): void; provisionalAuthenticated(): void; disconnected(): void; stopped(): void } {
  const marker = join(identity.directory, 'authenticated.json');
  const temporary = join(identity.directory, 'authenticated.pending');
  let provisional = false;
  const remove = (path: string) => { try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Windows authentication evidence unavailable'); } };
  const clear = () => { provisional = false; remove(marker); remove(temporary); };
  const publish = (phase: 'provisional' | 'active') => {
    remove(marker);
    const descriptor = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify({ version: 1, launchId: identity.launchId, configSha256: identity.configSha256, authenticated: true, phase, authenticatedAt: new Date().toISOString() }));
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temporary, marker);
    provisional = phase === 'provisional';
  };
  return {
    authenticated() { publish('active'); },
    provisionalAuthenticated() { publish('provisional'); },
    // The backend closes after verification. Retain that receipt across retries;
    // the installer accepts it for at most 30 seconds, never as active readiness.
    disconnected() { if (!provisional) clear(); },
    stopped: clear,
  };
}
