// Disposable HTTPS enrollment fixture; synthetic credentials only, loopback bind.
import { readFileSync, writeFileSync, renameSync, createReadStream } from 'node:fs';
import { createServer } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
const options = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (process.platform !== 'win32' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || options.allowDisposableCi !== true) throw new Error('Disposable Windows CI required');
const state = { activeKey: null, activeConnected: false, exchanges: 0, commits: 0, rollbacks: 0, transactions: {} };
const persist = () => { writeFileSync(`${options.state}.pending`, JSON.stringify(state)); renameSync(`${options.state}.pending`, options.state); };
const authenticatedSockets = new Map();
const connected = () => [...authenticatedSockets.values()].some((key) => key === state.activeKey);
const controls = () => JSON.parse(readFileSync(options.controls, 'utf8'));
const server = createServer({ pfx: readFileSync(options.pfx), passphrase: options.passphrase }, (request, response) => {
  let bytes = 0; const chunks = [];
  request.on('data', (chunk) => { bytes += chunk.length; if (bytes > 65536) { request.destroy(); return; } chunks.push(chunk); });
  request.on('end', () => {
    const pathname = new URL(request.url, 'https://localhost').pathname;
    const send = (code, body) => response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    const control = controls();
    const asset = /^\/releases\/v([0-9A-Za-z.-]+)\/(agentv-[0-9A-Za-z.-]+-windows-x64\.zip(?:\.sha256)?|install-agentv\.ps1)$/.exec(pathname);
    if (asset) { const stream = createReadStream(join(options.releases, `v${asset[1]}`, asset[2])); stream.on('error', () => response.writeHead(404).end()); stream.pipe(response); return; }
    if (pathname === '/api/v1/agentv/enrollments/exchange' && request.method === 'POST') {
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, {}); }
      const enrollment = /^aev_([a-f0-9-]{36})_[A-Za-z0-9_-]{43}$/.exec(body.enrollmentToken || '');
      const purpose = state.activeKey ? 'replace' : 'initial';
      if (!enrollment || body.targetId !== options.targetId || body.purpose !== purpose || state.transactions[enrollment[1]] || control.rejectExchange) return send(401, {});
      const id = enrollment[1];
      const transaction = { id, key: `ak_${options.targetId}_${randomBytes(24).toString('base64url')}`, secret: `avt_${randomUUID()}_${randomUUID().replaceAll('-', '')}`, status: 'exchanged', credentialState: 'pending', previousKey: state.activeKey };
      state.transactions[id] = transaction; state.exchanges++; persist();
      if (control.loseExchangeResponse) { response.destroy(); return; }
      return send(200, { transactionId: id, transactionSecret: transaction.secret, agentKey: transaction.key, purpose, accessPolicy: control.invalidPolicy ? { accessMode: 'read_write', restartServices: [] } : { accessMode: 'read_only', restartServices: [] } });
    }
    const match = /^\/api\/v1\/agentv\/installations\/([a-f0-9-]{36})\/(status|commit|rollback)$/.exec(pathname);
    const transaction = match && state.transactions[match[1]];
    if (!transaction || request.headers['x-agentv-transaction-secret'] !== transaction.secret) return send(401, {});
    if (match[2] === 'status') {
      // Pause only this disposable fixture's external status response after the
      // production worker has durably persisted acceptance; no product hook.
      if (control.holdAcceptanceRecheck) {
        try {
          const journal = readFileSync(options.journal);
          if (journal.length <= 262144 && JSON.parse(journal.toString('utf8')).intent === 'accept-committed') return;
        } catch { /* The atomic journal may be changing; a later poll observes it. */ }
      }
      if (control.statusUnavailable) return send(503, {});
      return send(200, { transactionId: transaction.id, status: control.forceStatus || transaction.status, credentialState: control.forceCredentialState || transaction.credentialState, activeConnected: state.activeConnected });
    }
    if (request.method !== 'POST') return send(405, {});
    if (match[2] === 'commit') {
      if (control.holdCommit) return;
      if (transaction.status !== 'verified' && transaction.status !== 'completed') return send(409, {});
      if (transaction.status !== 'completed') {
        for (const prior of Object.values(state.transactions)) if (prior.credentialState === 'active') prior.credentialState = 'grace';
        state.activeKey = transaction.key; state.activeConnected = false; transaction.status = 'completed'; transaction.credentialState = 'active'; state.commits++; persist();
      }
      if (control.loseCommitResponse) { response.destroy(); return; }
      return send(200, { status: 'completed' });
    }
    if (control.denyRollback || (transaction.status === 'completed' && state.activeKey !== transaction.key)) return send(409, {});
    if (transaction.status !== 'cancelled') {
      if (transaction.status === 'completed') { state.activeKey = transaction.previousKey; state.activeConnected = false; for (const prior of Object.values(state.transactions)) if (prior.key === state.activeKey) prior.credentialState = 'active'; }
      transaction.status = 'cancelled'; transaction.credentialState = 'revoked'; state.rollbacks++; persist();
    }
    if (control.loseRollbackResponse) { response.destroy(); return; }
    return send(200, { status: 'cancelled' });
  });
});
const sockets = new WebSocketServer({ server, maxPayload: 1048576 });
sockets.on('connection', (socket, request) => {
  const key = request.headers['x-agent-key'];
  const transaction = Object.values(state.transactions).find((item) => item.key === key && ['exchanged', 'verified'].includes(item.status));
  const control = controls();
  if (request.url !== '/api/v1/agent/connect' || control.rejectAgent || (control.rejectActive && !transaction) || (control.rejectPending && transaction) || (!transaction && key !== state.activeKey)) { socket.close(1008); return; }
  socket.on('close', () => { if (authenticatedSockets.delete(socket)) { state.activeConnected = connected(); persist(); } });
  socket.on('message', (raw, binary) => {
    if (binary) return;
    const message = JSON.parse(raw.toString());
    if (message.method !== 'lifecycle/handshake') return;
    if (message.id !== 'agentv-handshake-v2' || message.params?.targetId !== options.targetId || message.params?.hostFeatures?.osFamily !== 'windows' || message.params?.hostFeatures?.serviceManager !== 'scm') { socket.close(1008); return; }
    if (transaction) { transaction.status = 'verified'; persist(); }
    else { authenticatedSockets.set(socket, key); state.activeConnected = connected(); persist(); }
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { workspaceId: 'disposable-windows-ci', targetId: options.targetId, targetType: 'virtual_machine', provisional: Boolean(transaction), sessionPolicy: { allowedTools: [], writeEnabled: false } } }));
    if (transaction) socket.close(1000, 'AgentV provisional readiness verified');
  });
});
server.listen(0, '127.0.0.1', () => { persist(); writeFileSync(options.listening, JSON.stringify({ port: server.address().port })); });
