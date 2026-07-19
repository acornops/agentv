import type { HostAdapter } from './types.js';
import { FilesystemAdapter } from './filesystems.js';
import { HostFactsAdapter } from './host-facts.js';
import { JournalAdapter } from './journal.js';
import { ProcfsAdapter } from './procfs.js';
import { SocketAdapter } from './sockets.js';
import { SystemdAdapter } from './systemd.js';

/** Compose narrow Linux/systemd adapters behind the tool-facing host boundary. */
export class LinuxHostAdapter implements HostAdapter {
  private readonly host = new HostFactsAdapter();
  private readonly filesystems = new FilesystemAdapter();
  private readonly processes = new ProcfsAdapter();
  private readonly systemd = new SystemdAdapter();
  private readonly journal: JournalAdapter;
  private readonly sockets = new SocketAdapter();

  constructor(allowedLogUnits: readonly string[]) { this.journal = new JournalAdapter(new Set(allowedLogUnits)); }
  getHostSummary(signal?: AbortSignal) { return this.host.collect(signal); }
  listFilesystems(input: Parameters<HostAdapter['listFilesystems']>[0], signal?: AbortSignal) { return this.filesystems.list(input, signal); }
  listProcesses(input: Parameters<HostAdapter['listProcesses']>[0], signal?: AbortSignal) { return this.processes.list(input, signal); }
  getProcess(pid: number, signal?: AbortSignal) { return this.processes.get(pid, signal); }
  listServices(input: Parameters<HostAdapter['listServices']>[0], signal?: AbortSignal) { return this.systemd.list(input, signal); }
  getService(unit: string, signal?: AbortSignal) { return this.systemd.get(unit, signal); }
  queryLogs(input: Parameters<HostAdapter['queryLogs']>[0], signal?: AbortSignal) { return this.journal.query(input, signal); }
  listListeners(input: Parameters<HostAdapter['listListeners']>[0], signal?: AbortSignal) { return this.sockets.list(input, signal); }
}
