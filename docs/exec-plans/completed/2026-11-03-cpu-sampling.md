# Snapshot CPU sampling

## Goal and evidence

Prevent snapshot inventory work from dominating the host CPU sample. Live
paired measurements showed 0/53.33/0, 10/100/10 and 9.09/100/0 percent CPU
before/during/after process scans, with one-minute load 0. The existing 100 ms
sample runs concurrently with inventory scans lasting 163–261 ms.

## Scope

Use a one-second Linux CPU sample and await host facts before starting the
filesystem, service, process and socket collectors together. Check the snapshot
generation after that await. Preserve partial results, existing timeouts and
CPU accounting. No new sampler, settings, dependencies or Windows changes.

Affected modules: `src/adapters/host-facts.ts`,
`src/core/snapshot-manager.ts`, their tests, and `docs/OPERATIONS.md`.
Contract impact: none; the existing `sampled_ms` reports the nominal 1000 ms.

Ruling: also observe the cached socket executable promise's rejection in
`src/adapters/sockets.ts`, with a bounded child-process regression in
`src/adapters/live-boundaries.spec.ts`. The Linux smoke exposed a missing `ss`
crash while the host sample waited: the constructor's rejected promise had no
consumer yet. Keep that original promise/error for `list()` so missing commands
still become partial snapshot health. The coordinating agent approved this
necessary compatibility change; no broader error handling changes are included.

## Execution

- [x] Add regressions and observe ordering/interval failures before the fix.
- [x] Make the interval and collection-order changes.
- [x] Verify partial failures, stop/restart, idle/delta and sustained busy CPU.
- [x] Document the one-second latency tradeoff.
- [x] Run focused tests, `npm run validate`, `npm run test:coverage:all`,
  `npm run smoke:package`, and `git diff --check`.
- [x] Run a bounded local Linux collector smoke if Docker is available.
- [x] Record outcomes and hand off for the coordinated independent review.

## Rollout and rollback

Installed hosts need a future AgentV release containing this change. No release,
deployment or remote modification is part of this task. Before rollout, confirm
idle snapshots no longer track inventory work and real sustained CPU load still
appears on the production host. Rollback restores the previous release and its
100 ms concurrent sample; no data migration is needed.

## Open questions

None for implementation. Production-host acceptance remains a release gate.

## Completion summary

Implemented locally on `fix/telemetry-insights`, 2026-11-03. Ten interval/order
regressions failed before the fix; all 31 focused tests passed afterward. The
Linux smoke then exposed the delayed missing-command rejection above. Its
bounded Node child regression failed with exit 1 before the observer and passed
afterward; the final focused run passed all 36 tests across three files.

Final validation after all runtime edits:

- `npm run validate`: passed, including 277 unit tests, contracts, harness,
  lint/type checks, build and 28 Node fixture tests.
- `npm run test:coverage:all`: 281 tests passed, including four WebSocket E2Es;
  all configured coverage floors passed.
- `npm_config_cache=/private/tmp/acornops-agentv-npm-cache npm run smoke:package`:
  package and bootstrap failure-path checks passed.
- `git diff --check`: passed.
- Local Node 22 Linux container smoke: real host sampling took 1093 ms and
  reported `sampled_ms: 1000`; inventory began after host completion. Missing
  `ss` and systemd reported unavailable health while the snapshot completed.

Dependency installation initially failed on sandbox DNS and passed with network
access. Full checks used temporary local loopback listeners. Container execution
used a copied runtime, no bind mounts or network, a read-only root filesystem,
no capabilities, and bounded CPU, memory and process counts.

The smoke used real Linux procfs under shared Docker VM load; it does not prove
idle accuracy or native systemd qualification. Unit tests retain 100% CPU for a
fully busy counter interval. Production-host idle/busy acceptance and hosted
live-systemd checks remain release work. No Windows native qualification,
publication, deployment or remote host changes were performed. The coordinated
independent review is owned by the parent change set.
