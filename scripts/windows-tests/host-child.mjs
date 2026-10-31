// Native SCM fixture: it must be copied only into an explicitly owned CI release.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const configPath = process.argv[3];
let child;
let mode;
createInterface({ input: process.stdin }).on('line', (line) => {
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
  if (mode === 'flood') {
    const bytes = Buffer.alloc(64 * 1024, 'x');
    for (let i = 0; i < 400; i++) { process.stdout.write(bytes); process.stderr.write(bytes); }
  }
  setInterval(() => {}, 1000);
});
