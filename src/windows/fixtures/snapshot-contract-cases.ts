import { ToolExecutionError } from '../../tools/errors.js';
import { WindowsMockHost } from '../mock.js';
import { buildWindowsSnapshot } from '../snapshot.js';
import type { WindowsHost, WindowsList, WindowsService, WindowsVolume } from '../types.js';

/** Synthetic boundary faults belong to fixtures, never to production collectors. */
export async function buildSnapshotContractCases() {
  const healthy = new WindowsMockHost([]);
  const runningServices = await healthy.listServices({ limit: 1000, state: 'Running' });
  healthy.listServices = async () => runningServices;
  const denied = new WindowsMockHost([]);
  denied.listServices = async () => { throw new ToolExecutionError('PERMISSION_DENIED', 'Synthetic denial'); };
  const unavailable = new WindowsMockHost([]);
  unavailable.getHostSummary = async () => { throw new Error('Synthetic unavailable host'); };
  unavailable.listFilesystems = async () => { throw new Error('Synthetic unavailable volumes'); };

  const partial: WindowsHost = new WindowsMockHost([]);
  const volumes = await partial.listFilesystems({ limit: 1000 });
  partial.listFilesystems = async () => ({ ...volumes, items: [{ ...volumes.items[0], used_percent: null }],
    original_count: 3, omitted_count: 2, health: { collector: 'windows_volumes', status: 'partial', duration_ms: 0 } });
  const services = await partial.listServices({ limit: 1000 });
  partial.listServices = async () => ({ ...services, items: [{ ...services.items[0], state: 'Start Pending', exit_code: null }],
    original_count: 1, health: { collector: 'windows_services', status: 'partial', duration_ms: 0 } });

  const capped: WindowsHost = new WindowsMockHost([]);
  const repeatedVolumes: WindowsList<WindowsVolume> = { items: Array.from({ length: 51 }, (_, i) => ({
    ...volumes.items[0], volume: `SyntheticVolume${i}`, used_percent: 95,
    total_bytes: 1000, used_bytes: 950, free_bytes: 50
  })), original_count: 53, omitted_count: 2, health: { collector: 'windows_volumes', status: 'partial', duration_ms: 0 } };
  const repeatedServices: WindowsList<WindowsService> = { items: Array.from({ length: 51 }, (_, i) => ({
    ...services.items[1], name: `SyntheticFailed${i}`
  })), original_count: 54, omitted_count: 3, health: { collector: 'windows_services', status: 'partial', duration_ms: 0 } };
  capped.listFilesystems = async () => repeatedVolumes;
  capped.listServices = async () => repeatedServices;

  return Promise.all(Object.entries({ healthy, denied, unavailable, partial, capped })
    .map(async ([name, host]) => ({ name, data: await buildWindowsSnapshot(host) })));
}
