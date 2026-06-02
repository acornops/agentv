import { loadConfig } from './config.js';
import { LinuxSystemdCollector } from './collectors/linux.js';
import { MockHostCollector } from './collectors/mock.js';
import { createLogger } from './logger.js';
import { VmAgentClient } from './transport/websocket-client.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const collector = config.collectorMode === 'mock'
  ? new MockHostCollector()
  : new LinuxSystemdCollector(config.allowedLogSources);

logger.info({
  targetId: config.targetId,
  targetType: config.targetType,
  collectorMode: config.collectorMode,
  osFamily: config.osFamily,
  serviceManager: config.serviceManager
}, 'VM agent starting');

const client = new VmAgentClient(config, collector, logger);
client.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'VM agent stopping');
    client.stop();
    setTimeout(() => process.exit(0), 250).unref();
  });
}
