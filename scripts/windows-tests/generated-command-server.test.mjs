import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { startGeneratedCommandServer, generatedCommandStartupStatus } from './generated-command-server.mjs';

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
    await assert.rejects(startGeneratedCommandServer({ key, cert }, control, server.address().port), error => {
      assert.equal(generatedCommandStartupStatus('listen', error).category, 'address-in-use');
      return error.code === 'EADDRINUSE';
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  }
});

// Reproduce the actual child entry point and PFX import boundary, not just the
// imported key/certificate server helper. Expected metadata never uses errors.
test('CLI reports bounded missing-PFX startup cause without disclosing options', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'agentv-wrapper-startup-'));
  try {
    const options = { allowDisposableCi: true, pfx: path.join(work, 'missing-sensitive-name.pfx'), passphrase: 'never-publish-this-password', control: path.join(work, 'mode'), ready: path.join(work, 'ready'), startupStatus: path.join(work, 'startup.json') };
    const optionsPath = path.join(work, 'options.json');
    await writeFile(optionsPath, JSON.stringify(options));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./generated-command-server.mjs', import.meta.url)), optionsPath], { env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' }, timeout: 10000, encoding: 'utf8' });
    assert.equal(child.status, 1);
    const statusText = await readFile(options.startupStatus, 'utf8');
    const status = JSON.parse(statusText);
    assert.equal(status.phase, 'pfx-read');
    assert.equal(status.category, 'file-missing');
    assert.equal(status.code, 'ENOENT');
    assert.equal(statusText.includes(options.pfx), false);
    assert.equal(statusText.includes(options.passphrase), false);
    assert.equal(statusText.includes('missing-sensitive-name'), false);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'Synthetic HTTPS fixture failed.\n');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});


test('CLI PFX boundary reports unsupported, wrong-password and malformed inputs; modern PFX reaches readiness', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'agentv-wrapper-pfx-'));
  let child;
  try {
    const key = path.join(work, 'key.pem');
    const cert = path.join(work, 'cert.pem');
    const password = 'never-publish-pfx-password';
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    for (const [name, args] of [['legacy', ['-legacy']], ['modern', ['-keypbe', 'AES-256-CBC', '-certpbe', 'AES-256-CBC', '-macalg', 'sha256']]]) {
      execFileSync('openssl', ['pkcs12', '-export', '-in', cert, '-inkey', key, '-out', path.join(work, name+'.pfx'), '-passout', 'pass:'+password, ...args], { stdio: 'ignore' });
    }
    await writeFile(path.join(work, 'malformed.pfx'), 'synthetic malformed PFX');
    const executable = fileURLToPath(new URL('./generated-command-server.mjs', import.meta.url));
    const environment = { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true' };
    const optionsPath = path.join(work, 'options.json');
    for (const [name, pfx, passphrase, category] of [['unsupported', 'legacy', password, 'unsupported-pfx'], ['password', 'modern', 'wrong-secret', 'pfx-password-or-mac'], ['malformed', 'malformed', password, 'other']]) {
      const options = { allowDisposableCi: true, pfx: path.join(work, pfx+'.pfx'), passphrase, control: path.join(work, 'mode'), ready: path.join(work, 'ready'), startupStatus: path.join(work, name+'.json') };
      await writeFile(optionsPath, JSON.stringify(options));
      const failed = spawnSync(process.execPath, [executable, optionsPath], { env: environment, encoding: 'utf8', timeout: 10000 });
      assert.equal(failed.status, 1);
      const serialized = await readFile(options.startupStatus, 'utf8');
      const status = JSON.parse(serialized);
      assert.equal(status.phase, 'tls-create');
      assert.equal(status.category, category);
      assert.equal(serialized.includes(password), false);
      assert.equal(serialized.includes(work), false);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, 'Synthetic HTTPS fixture failed.\n');
    }
    // An imported module does not execute its CLI block. With normal exit0 and
    // no startup file, the parent must retain available=false, not infer PFX.
    const noEntryStatus = path.join(work, 'no-entry.json');
    await writeFile(optionsPath, JSON.stringify({ allowDisposableCi: true, startupStatus: noEntryStatus }));
    const noEntry = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import('+JSON.stringify(new URL('./generated-command-server.mjs', import.meta.url).href)+')', optionsPath], { env: environment, timeout: 10000 });
    assert.equal(noEntry.status, 0);
    await assert.rejects(readFile(noEntryStatus), { code: 'ENOENT' });
    const options = { allowDisposableCi: true, pfx: path.join(work, 'modern.pfx'), passphrase: password, control: path.join(work, 'mode'), ready: path.join(work, 'ready'), startupStatus: path.join(work, 'modern.json') };
    await writeFile(optionsPath, JSON.stringify(options));
    child = spawn(process.execPath, [executable, optionsPath], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    const exited = once(child, 'exit');
    const deadline = Date.now()+10000;
    while (true) {
      try { await readFile(options.ready); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      assert.equal(child.exitCode, null, 'PFX CLI exited before readiness');
      assert.ok(Date.now() < deadline, 'PFX CLI readiness deadline');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const ready = JSON.parse(await readFile(options.startupStatus, 'utf8'));
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.category, 'none');
    assert.equal(ready.code, 'none');
    child.stdin.end('stop');
    const [exitCode] = await exited;
    assert.equal(exitCode, 0);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(work, { recursive: true, force: true });
  }
});

test('unexpected startup errors disclose only the fixed other category', () => {
  const status = generatedCommandStartupStatus('private-phase', { code: 'private-code', message: 'private path and password', stack: 'private stack' });
  assert.equal(status.phase, 'unavailable');
  assert.equal(status.category, 'other');
  assert.equal(status.code, 'unclassified');
  assert.equal(JSON.stringify(status).includes('private'), false);
});
