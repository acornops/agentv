import { ActionHelper } from './actions/helper.js';
import { createLogger } from './logger.js';

const logger = createLogger((process.env.ACORNOPS_AGENT_LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error');
const helper = new ActionHelper(
  process.env.ACORNOPS_AGENTV_ACTION_POLICY || '/etc/acornops/agentv-actions.json',
  process.env.ACORNOPS_AGENTV_ACTION_LEDGER || '/var/lib/acornops-agentv/actions',
  logger,
);
const server = await helper.start();
logger.info({}, 'AgentV action helper ready');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
