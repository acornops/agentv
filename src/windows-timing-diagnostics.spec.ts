import { describe, expect, it } from 'vitest';
import { createStageTimeline } from '../scripts/windows-collector-timing.mjs';

describe('sanitized CI collector timing evidence', () => {
  it('timestamps only fixed stage lines across chunk boundaries', () => {
    let elapsed = 12; const timeline = createStageTimeline(['script_started', 'cpu_query_started'], () => elapsed);
    timeline.observe(Buffer.from('secret arbitrary error\nagentv-stage:script_'));
    elapsed = 27; timeline.observe(Buffer.from('started\r\nagentv-stage:cpu_query_started\n'));
    expect(timeline.events).toEqual([{ stage: 'script_started', elapsed_ms: 27 }, { stage: 'cpu_query_started', elapsed_ms: 27 }]);
  });
  it('discards oversized/unknown lines and bounds the retained event count', () => {
    const timeline = createStageTimeline(['script_started', 'cpu_query_started'], () => 1);
    timeline.observe(Buffer.from('x'.repeat(4096) + 'agentv-stage:script_started\nagentv-stage:not-a-stage\n'));
    expect(timeline.events).toEqual([]);
    timeline.observe(Buffer.from('agentv-stage:script_started\n'.repeat(100)));
    expect(timeline.events).toHaveLength(32);
  });
});
