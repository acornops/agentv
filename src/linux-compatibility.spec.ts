import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MockActionClient } from './actions/mock.js';
import { MockHostAdapter } from './adapters/mock.js';
import { createLogger } from './logger.js';
import { McpRouter } from './mcp/router.js';
import { ToolExecutor } from './tools/executor.js';
import { registerAllTools } from './tools/index.js';
import { toolRegistry } from './tools/registry.js';

// Captured before Windows work from the released experimental.14 runtime.
// Keep this fixture independent of the registry; provenance is in the assessment.
const releasedTools = JSON.parse(readFileSync(new URL('./fixtures/linux-v14-tools.json', import.meta.url), 'utf8'));

describe('released Linux compatibility', () => {
  it('preserves all nine experimental.14 tools/list descriptors and their complete schemas', async () => {
    registerAllTools(new MockHostAdapter(), new MockActionClient());
    const router = new McpRouter(new ToolExecutor(), createLogger('error'));
    router.setSessionPolicy({
      allowedTools: new Set(toolRegistry.getAll().map((tool) => tool.name)),
      writeEnabled: true, generation: 1, targetId: 'linux-v14',
    });

    const response = await router.handleRequest({ jsonrpc: '2.0', id: 'linux-v14-catalog', method: 'tools/list' });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ tools: releasedTools });
  });
});
