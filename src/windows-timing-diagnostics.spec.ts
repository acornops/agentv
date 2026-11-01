import { describe, expect, it } from 'vitest';
import { createEventLoopSummary, createStageTimeline } from '../scripts/windows-collector-timing.mjs';

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
  it('bounds event-loop observation in 100ms lag bins without retaining individual samples', () => {
    let now = 0; const summary = createEventLoopSummary(() => now);
    now = 100; summary.sample(); now = 550; summary.sample();
    expect(summary.result()).toMatchObject({ resolution_ms: 100, sample_count: 2, max_lag_ms: 350 });
    expect(summary.result().lag_bins[0]).toBe(1); expect(summary.result().lag_bins[3]).toBe(1);
    for (let i = 0; i < 500; i++) { now += 100; summary.sample(); }
    expect(summary.result().sample_count).toBe(120);
    expect(summary.result().lag_bins).toHaveLength(101);
  });
});
