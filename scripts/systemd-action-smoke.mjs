import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const unit = 'acornops-smoke-worker.service';
const runtime = '/opt/acornops/agentv/current';
const { SocketActionClient } = await import(pathToFileURL(`${runtime}/dist/actions/client.js`).href);
const { LinuxHostAdapter } = await import(pathToFileURL(`${runtime}/dist/adapters/linux.js`).href);
const { registerAllTools } = await import(pathToFileURL(`${runtime}/dist/tools/index.js`).href);
const { ToolExecutor } = await import(pathToFileURL(`${runtime}/dist/tools/executor.js`).href);
const client = new SocketActionClient('/run/acornops-agentv/actions.sock');
const capabilities = await client.capabilities();
if (!capabilities.policy_valid || !capabilities.restart_services.includes(unit)) throw new Error('Smoke service is not allowlisted by the helper');
registerAllTools(new LinuxHostAdapter([]), client);
const executor = new ToolExecutor({ localWriteEnabled: () => true });
const policy = { allowedTools: new Set(['restart_service']), writeEnabled: true, generation: 1, targetId: 'agentv-systemd-smoke' };
executor.setActiveGeneration(policy.generation);
const restart = (args, requestId) => executor.execute({ name: 'restart_service', arguments: args, requestId, policy });

async function properties() {
  const { stdout } = await execFileAsync('/bin/systemctl', [
    'show', unit, '--no-pager', '--property=ActiveState', '--property=SubState', '--property=InvocationID',
  ]);
  return Object.fromEntries(stdout.trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

const before = await properties();
const requestId = randomBytes(12).toString('hex');
const request = {
  unit,
  reason: 'Hosted CI verification of the allowlisted restart boundary',
  expected_active_state: `${before.ActiveState} (${before.SubState})`,
  expected_sub_state: before.SubState,
  expected_invocation_id: before.InvocationID,
};
const receipt = await restart(request, requestId);
if (receipt.outcome !== 'success' || receipt.before.invocation_id !== before.InvocationID
  || !receipt.after?.invocation_id || receipt.after.invocation_id === before.InvocationID) {
  throw new Error(`Unexpected restart receipt: ${JSON.stringify(receipt)}`);
}
const replay = await restart({ ...request, expected_active_state: before.ActiveState }, requestId);
if (JSON.stringify(replay) !== JSON.stringify(receipt)) throw new Error('Idempotent restart replay returned a different receipt');
try {
  await restart({ ...request, reason: `${request.reason} with mismatched reuse` }, requestId);
  throw new Error('Mismatched operation ID reuse was accepted');
} catch (error) {
  if (error?.toolCode !== 'PRECONDITION_FAILED' || error?.data?.outcome !== 'not_started') throw error;
}
for (const [code, args, field] of [
  ['PRECONDITION_FAILED', request, 'invocation_id'],
  ['PRECONDITION_FAILED', { ...request, expected_active_state: 'inactive (dead)', expected_sub_state: 'dead', expected_invocation_id: receipt.after.invocation_id }, 'active_state'],
  ['PRECONDITION_FAILED', { ...request, expected_active_state: 'active (exited)', expected_sub_state: 'exited', expected_invocation_id: receipt.after.invocation_id }, 'sub_state'],
  ['INVALID_ARGUMENTS', { ...request, expected_active_state: 'active (dead)' }, null],
]) {
  try {
    await restart(args, randomBytes(12).toString('hex'));
    throw new Error(`Unsafe restart input was accepted: ${code}/${field}`);
  } catch (error) {
    if (error?.toolCode !== code) throw error;
    if (field && (error.data?.outcome !== 'not_started' || !error.message.includes(field))) throw error;
  }
}
if ((await properties()).InvocationID !== receipt.after.invocation_id) throw new Error('Rejected/replayed calls restarted the service');
process.stdout.write(`Display-form restart, canonical replay and precondition guards passed for ${unit}.\n`);
