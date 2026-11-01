import type { WindowsService } from './types.js';

/** Require affirmative SCM failure evidence; a stopped service alone is normal. */
export function isFailedService(service: WindowsService): boolean {
  return service.state === 'Stopped' && ['Auto', 'Manual', 'Automatic'].includes(service.start_mode || '')
    && typeof service.exit_code === 'number' && service.exit_code !== 0 && service.exit_code !== 1077;
}
