import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = new URL('../../dist/windows-service-entry.js', import.meta.url);
const configPath = 'C:\\missing-agentv-process-test\\config.json';
const start = JSON.stringify({
  command: 'START', trustedSystemDirectory: 'C:\\Windows\\System32',
  launch: { launchId: 'a747fa58-2486-4fb3-a050-a46eece839b0', configSha256: 'a'.repeat(64), stateDirectory: 'C:\\protected\\state' },
}) + '\n';
const stop = '{"command":"STOP"}\n';

// The SCM host retains its writable pipe while waiting for the child to exit.
// An in-memory Readable cannot expose a leaked operating-system stdin handle.
for (const scenario of [
  { name: 'protected-config startup failure', command: start, code: 1 },
  { name: 'invalid control protocol', command: '{}\n', code: 1 },
  { name: 'STOP before START', command: stop, code: 0 },
  { name: 'STOP during startup', command: start + stop, code: 0, runtime: true, earlyStop: true },
  { name: 'normal STOP after startup', command: start, code: 0, runtime: true },
]) {
  test(`service entry exits with its parent pipe open: ${scenario.name}`, async () => {
    // Inject only the runtime handle for the successful-start case. All control
    // protocol and stream ownership code comes from the built production entry.
    const args = scenario.runtime ? ['--input-type=module', '--eval', `
      import { runWindowsServiceEntry } from ${JSON.stringify(entry.href)};
      await runWindowsServiceEntry({ input: process.stdin, configPath: ${JSON.stringify(configPath)},
        start: async () => {
          if (${!scenario.earlyStop}) setImmediate(() => process.stdout.write('ready\\n'));
          return { stop: async () => { process.stdout.write('stopped\\n'); } };
        } });
    `] : [fileURLToPath(entry), '--config', configPath];
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'close');
    let output = ''; let error = ''; let timer;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    const ready = new Promise(resolve => child.stdout.on('data', () => { if (output.includes('ready\n')) resolve(); }));
    try {
      child.stdin.write(scenario.command); // Deliberately do not end this pipe.
      const [code, signal] = await Promise.race([
        (async () => {
          if (scenario.runtime && !scenario.earlyStop) { await ready; child.stdin.write(stop); }
          return exited;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Child retained its control pipe after completion')), 5000); }),
      ]);
      assert.equal(signal, null);
      assert.equal(code, scenario.code, error);
      if (scenario.runtime) assert.equal(output, scenario.earlyStop ? 'stopped\n' : 'ready\nstopped\n');
      if (scenario.code) assert.equal(error, 'Windows service runtime stopped with an error\n');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
      child.stdin.destroy();
    }
  });
}
