import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const basename = `agentv-${pkg.version}.tar.gz`;
const archive = path.join(root, 'release', basename);
const checksumFile = `${archive}.sha256`;
const checksum = (await readFile(checksumFile, 'utf8')).trim();
const expectedChecksum = createHash('sha256').update(await readFile(archive)).digest('hex');
if (checksum !== `${expectedChecksum}  ${basename}`) throw new Error('Archive checksum must contain the exact SHA-256 and basename');

const { stdout: listing } = await execFileAsync('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024 });
const entries = listing.trim().split('\n');
const prefix = `agentv-${pkg.version}/`;
if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) throw new Error('Archive contains an unsafe path');
for (const required of [
  `${prefix}runtime/dist/index.js`,
  `${prefix}runtime/dist/helper.js`,
  `${prefix}runtime/dist/doctor.js`,
  `${prefix}runtime/node_modules/ws/package.json`,
  `${prefix}runtime/node_modules/zod/package.json`,
  `${prefix}packaging/systemd/install.sh`,
  `${prefix}packaging/systemd/uninstall.sh`,
  `${prefix}packaging/systemd/acornops-agentv.service`,
  `${prefix}packaging/systemd/acornops-agentv-actions.socket`,
  `${prefix}packaging/systemd/acornops-agentv-actions.service`,
]) if (!entries.includes(required)) throw new Error(`Archive is missing ${required}`);
if (entries.some((entry) => entry.startsWith(`${prefix}runtime/dist/`) && (/\.spec\.|\.ts$|\/fixtures\//).test(entry))) {
  throw new Error('Runtime dist contains tests, fixtures, or TypeScript sources');
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'agentv-package-smoke-'));
try {
  await execFileAsync('tar', ['-xzf', archive, '-C', directory]);
  const extracted = path.join(directory, prefix);
  const runtime = path.join(extracted, 'runtime');
  const installed = (await readdir(path.join(runtime, 'node_modules'))).filter((name) => !name.startsWith('.')).sort();
  if (JSON.stringify(installed) !== JSON.stringify(['ws', 'zod'])) throw new Error(`Unexpected production dependency directories: ${installed.join(', ')}`);
  await execFileAsync('npm', ['ls', '--omit=dev', '--json'], { cwd: runtime, maxBuffer: 1024 * 1024 });
  await execFileAsync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(new URL(`file://${path.join(runtime, 'dist/actions/client.js')}`).href)});`]);
  for (const executable of [
    'packaging/systemd/install.sh',
    'packaging/systemd/uninstall.sh',
    'packaging/systemd/acornops-agentv-doctor',
  ]) {
    const mode = (await stat(path.join(extracted, executable))).mode;
    if ((mode & 0o111) === 0) throw new Error(`${executable} is not executable`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

process.stdout.write(`Package smoke passed for ${basename}.\n`);
