import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

// Synthetic assets only: no enrollment API, release package or agent runtime.
export async function startGeneratedCommandServer(tls, control, port = 18443) {
  const bootstrap = await readFile(new URL('./generated-command-bootstrap.ps1', import.meta.url));
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
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Disposable hosted CI required');
    const options = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (options.allowDisposableCi !== true) throw new Error('Explicit authorization required');
    const server = await startGeneratedCommandServer({ pfx: await readFile(options.pfx), passphrase: options.passphrase }, options.control);
    await writeFile(options.ready, 'ready', { flag: 'wx' });
    // Parent requests graceful shutdown through the owned child's stdin.
    process.stdin.once('data', () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
    process.stdin.resume();
  } catch {
    // Never emit certificate options, command arguments or raw errors.
    process.stderr.write('Synthetic HTTPS fixture failed.\n');
    process.exit(1);
  }
}
