import { loadConfig } from '../dist/config.js';
import { createWindowsHost } from '../dist/windows-runtime.js';
import { runWindowsDoctor } from '../dist/doctor.js';
if (process.platform !== 'win32' || process.argv.length !== 3) process.exit(2);
let host;
try {
  const config = loadConfig();
  host = createWindowsHost(config, { trustedSystemDirectory: process.argv[2] });
  const result = await runWindowsDoctor(config, host);
  process.stdout.write(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch { process.stderr.write('Windows candidate doctor failed.\n'); process.exitCode = 1; }
finally { if (host) await host.stop(); }
