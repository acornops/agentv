import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// Synthetic assets only: no enrollment API, release package or agent runtime.
export async function startGeneratedCommandServer(tls, control, port = 18443, phase = () => {}) {
  phase('bootstrap-read');
  const bootstrap = await readFile(new URL('./generated-command-bootstrap.ps1', import.meta.url));
  phase('tls-create');
  const server = https.createServer(tls, async (request, response) => {
    try {
      let mode = '';
      try { mode = await readFile(control, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const status = request.method !== 'GET' || request.url !== '/releases/v1.2.3-preview.1/install-agentv.ps1' ? 404 : mode === 'http-error' ? 503 : 200;
      response.writeHead(status, { 'Content-Type': 'application/octet-stream', 'Connection': 'close' });
      response.end(status === 200 ? bootstrap : 'Synthetic download rejection');
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  phase('listen');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return server;
}

// All exported diagnostic values are fixed labels or bounded runtime versions.
// Never include error.message, stacks, argv, paths, options or certificate data.
export function generatedCommandStartupStatus(phase, error = null) {
  const phases = ['authorization', 'options-read', 'pfx-read', 'bootstrap-read', 'tls-create', 'listen', 'ready-write', 'ready'];
  const codes = ['ENOENT', 'EADDRINUSE', 'ERR_CRYPTO_UNSUPPORTED_OPERATION', 'ERR_OSSL_EVP_UNSUPPORTED'];
  let category = error ? 'other' : 'none';
  if (error?.code === 'ENOENT') category = 'file-missing';
  else if (error?.code === 'EADDRINUSE') category = 'address-in-use';
  else if (['ERR_CRYPTO_UNSUPPORTED_OPERATION', 'ERR_OSSL_EVP_UNSUPPORTED'].includes(error?.code) || ['unsupported', 'Unsupported PKCS12 PFX data'].includes(error?.message)) category = 'unsupported-pfx';
  else if (error?.message === 'mac verify failure') category = 'pfx-password-or-mac';
  const version = value => /^[0-9][A-Za-z0-9.+-]{0,31}$/.test(value) ? value : 'unavailable';
  return { phase: phases.includes(phase) ? phase : 'unavailable', category, code: error ? codes.includes(error.code) ? error.code : 'unclassified' : 'none', node: version(process.versions.node), openssl: version(process.versions.openssl) };
}

// Independent of options parsing and the CLI predicate: prove module evaluation
// using only booleans/counts in the exact private path supplied by our parent.
const moduleFacts = { moduleEvaluated: true, argumentCount: Math.min(process.argv.length, 8), scriptArgumentPresent: Boolean(process.argv[1]), rawScriptArgumentMatches: process.argv[1] === fileURLToPath(import.meta.url), optionsArgumentPresent: Boolean(process.argv[2]), entryComparisonCompleted: false, entryMatched: false };
let moduleStatusOwned = false;
if (process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && process.env.AGENTV_WRAPPER_MODULE_STATUS) {
  try { await writeFile(process.env.AGENTV_WRAPPER_MODULE_STATUS, JSON.stringify(moduleFacts), { flag: 'wx' }); moduleStatusOwned = true; } catch { /* Parent reports absent/unavailable metadata. */ }
}

// Node resolves the module's real path; argv can retain an alias or Windows
// casing. Compare canonical files so an owned CLI launch cannot silently skip.
const entryPath = value => {
  const canonical = realpathSync(value);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
};
const entryMatched = Boolean(process.argv[1] && entryPath(process.argv[1]) === entryPath(fileURLToPath(import.meta.url)));
moduleFacts.entryComparisonCompleted = true; moduleFacts.entryMatched = entryMatched;
if (moduleStatusOwned) {
  try { await writeFile(process.env.AGENTV_WRAPPER_MODULE_STATUS, JSON.stringify(moduleFacts)); } catch { /* Parent reports invalid/unavailable metadata. */ }
}
if (entryMatched) {
  let options;
  let startupStatusOwned = false;
  let phase = 'authorization';
  try {
    if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Disposable hosted CI required');
    phase = 'options-read';
    options = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (options.allowDisposableCi !== true) throw new Error('Explicit authorization required');
    phase = 'pfx-read';
    const tls = { pfx: await readFile(options.pfx), passphrase: options.passphrase };
    const server = await startGeneratedCommandServer(tls, options.control, 18443, value => { phase = value; });
    // Parent requests graceful shutdown through the owned child's stdin.
    process.stdin.once('data', () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
    process.stdin.resume();
    phase = 'ready-write';
    // Publish readiness only after the completed startup record is readable.
    await writeFile(options.startupStatus, JSON.stringify(generatedCommandStartupStatus('ready')), { flag: 'wx' });
    startupStatusOwned = true;
    await writeFile(options.ready, 'ready', { flag: 'wx' });
  } catch (error) {
    if (options?.startupStatus) {
      try { await writeFile(options.startupStatus, JSON.stringify(generatedCommandStartupStatus(phase, error)), { flag: startupStatusOwned ? 'w' : 'wx' }); } catch { /* Parent explicitly reports unavailable metadata. */ }
    }
    // Never emit certificate options, command arguments or raw errors.
    process.stderr.write('Synthetic HTTPS fixture failed.\n');
    process.exit(1);
  }
}
