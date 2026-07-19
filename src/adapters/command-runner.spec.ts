import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from './command-runner.js';

const originalKey = process.env.ACORNOPS_AGENT_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.ACORNOPS_AGENT_KEY;
  else process.env.ACORNOPS_AGENT_KEY = originalKey;
});

describe('runCommand', () => {
  it('uses a minimal locale-stable environment without AgentV credentials', async () => {
    process.env.ACORNOPS_AGENT_KEY = 'must-not-reach-child';
    const result = await runCommand('/usr/bin/env', [], { timeoutMs: 1_000, maxBytes: 16 * 1024 });
    expect(result.stdout).toContain('LC_ALL=C');
    expect(result.stdout).not.toContain('ACORNOPS_AGENT_KEY');
    expect(result.stdout).not.toContain('must-not-reach-child');
  });

  it('maps missing commands, timeouts, and hostile output to stable codes', async () => {
    await expect(runCommand('/definitely/missing/agentv-command', [], { timeoutMs: 100, maxBytes: 1024 }))
      .rejects.toMatchObject({ toolCode: 'COMMAND_UNAVAILABLE' });
    await expect(runCommand('/bin/sleep', ['1'], { timeoutMs: 5, maxBytes: 1024 }))
      .rejects.toMatchObject({ toolCode: 'TOOL_TIMEOUT' });
    await expect(runCommand('/usr/bin/printf', ['0123456789abcdef'], { timeoutMs: 1_000, maxBytes: 8 }))
      .rejects.toMatchObject({ toolCode: 'OUTPUT_TOO_LARGE' });
  });
});
