import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startGeneratedCommandServer } from './generated-command-server.mjs';

// Exercise the actual asset server over TLS; these checks do not qualify PS5.
test('owned HTTPS fixture serves only the pinned synthetic bootstrap and controlled HTTP failure', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'agentv-wrapper-server-'));
  let server;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', path.join(work, 'key.pem'), '-out', path.join(work, 'cert.pem')], { stdio: 'ignore' });
    const key = await readFile(path.join(work, 'key.pem'));
    const cert = await readFile(path.join(work, 'cert.pem'));
    const bootstrap = await readFile(new URL('./generated-command-bootstrap.ps1', import.meta.url));
    const control = path.join(work, 'mode');
    server = await startGeneratedCommandServer({ key, cert }, control, 0);
    const request = (url, ca = cert) => new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', servername: 'localhost', port: server.address().port, path: url, ca }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    await assert.rejects(request('/releases/v1.2.3-preview.1/install-agentv.ps1', []), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    assert.equal((await request('/other')).status, 404);
    const success = await request('/releases/v1.2.3-preview.1/install-agentv.ps1');
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, bootstrap);
    await writeFile(control, 'http-error');
    assert.equal((await request('/releases/v1.2.3-preview.1/install-agentv.ps1')).status, 503);
    // A listener collision must fail rather than attach to or replace the owner.
    await assert.rejects(startGeneratedCommandServer({ key, cert }, control, server.address().port), { code: 'EADDRINUSE' });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  }
});
