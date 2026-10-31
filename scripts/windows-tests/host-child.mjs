// Native SCM fixture: it must be copied only into an explicitly owned CI release.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const configPath = process.argv[3];
let child;
let mode;
createInterface({ input: process.stdin }).on('line', async (line) => {
  const command = JSON.parse(line);
  if (command.command === 'STOP') {
    if (mode !== 'ignore-stop') process.exit(0);
    return;
  }
  if (command.command !== 'START') process.exit(2);
  const config = JSON.parse(readFileSync(configPath)); mode = config.mode;
  const state = command.launch.stateDirectory;
  child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(join(state, 'fixture.pending'), JSON.stringify({ pid: process.pid, child: child.pid, launch: command.launch, env: process.env }));
  renameSync(join(state, 'fixture.pending'), join(state, 'fixture.json'));
  if (mode === 'collectors') {
    const evidence = { collections: {} };
    let host;
    try {
      const [{ WindowsLiveHost }, { WindowsCollectorRunner }] = await Promise.all([import('./windows/live.js'), import('./windows/runner.js')]);
      host = new WindowsLiveHost(['Application', 'System'], new WindowsCollectorRunner(command.trustedSystemDirectory));
      const summary = await host.getHostSummary();
      evidence.host = { os: summary.os_family, productType: summary.product_type, build: summary.build };
      for (const [name, operation] of [
        ['volumes', () => host.listFilesystems({ limit: 1000 })],
        ['processes', () => host.listProcesses({ limit: 1000 })],
        ['services', () => host.listServices({ limit: 1000 })],
        ['listeners', () => host.listListeners({ limit: 1000 })],
        ['application', () => host.queryLogs({ channel: 'Application', limit: 10, byte_limit: 16384 })],
        ['system', () => host.queryLogs({ channel: 'System', limit: 10, byte_limit: 16384 })],
      ]) {
        const result = await operation();
        evidence.collections[name] = { status: result.health.status, count: (result.items || result.entries).length };
      }
    } catch (error) { evidence.failure = { code: error.toolCode || 'FIXTURE_FAILURE' }; }
    finally { if (host) await host.stop(); }
    writeFileSync(join(state, 'collectors.pending'), JSON.stringify(evidence));
    renameSync(join(state, 'collectors.pending'), join(state, 'collectors.json'));
  }
  if (mode === 'flood') {
    const bytes = Buffer.alloc(64 * 1024, 'x');
    for (let i = 0; i < 400; i++) { process.stdout.write(bytes); process.stderr.write(bytes); }
  }
  setInterval(() => {}, 1000);
});
