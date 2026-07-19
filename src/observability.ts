export interface RuntimeCounters {
  collection_duration_ms: number; tool_calls: number; validation_failures: number;
  queue_saturation: number; timeouts: number; reconnects: number;
  skipped_snapshots: number; truncations: number; dropped_snapshots: number;
}

/** Process-local structured counters included in diagnostics and logs. */
export class Observability {
  readonly counters: RuntimeCounters = { collection_duration_ms: 0, tool_calls: 0, validation_failures: 0, queue_saturation: 0, timeouts: 0, reconnects: 0, skipped_snapshots: 0, truncations: 0, dropped_snapshots: 0 };
  increment(key: Exclude<keyof RuntimeCounters, 'collection_duration_ms'>, amount = 1): void { this.counters[key] += amount; }
  recordCollection(durationMs: number): void { this.counters.collection_duration_ms = durationMs; }
  snapshot(): RuntimeCounters { return { ...this.counters }; }
}
