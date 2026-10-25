# Filesystem Capacity Alerts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this
> scoped tasks with test-driven development and a final independent review.

**Goal:** Stop capacity-pressure alerts for immutable filesystem images without
suppressing genuine storage pressure.

**Architecture:** Keep filesystem collection and snapshot schemas unchanged.
Classify capacity-alert eligibility in AgentV's snapshot finding generation.
Control-plane inventory badges consume those findings instead of independently
reapplying a capacity threshold.

**Tech Stack:** TypeScript, Vitest, existing Linux filesystem adapter.

**Spec:** The approved design below records the approach accepted in chat on
2026-10-25; implementation is in the existing checkout on
`fix/filesystem-capacity-alerts`.

## Approved Design and Constraints

- Exclude inherently read-only image types: `squashfs`, `erofs`, `cramfs`,
  `romfs`, and Linux `iso9660`.
- Keep the existing `used_percent >= 90` threshold for other types, including
  unknown types. Do not add a writable-type allowlist.
- Do not exclude by path, device name, or `read_only`: systemd's
  `ProtectSystem=strict` makes ordinary disks appear read-only to AgentV.
- Retain collected filesystem facts and existing collector/snapshot limits.
- No protocol, dependencies, configuration, privileges, UI component, or service-failure
  severity changes. No release, deployment, or live-VM mutations in this task.

## Review Focus

- Immutable images outside `/snap` must not alert.
- Real disks that appear read-only inside the sandbox must still alert.
- Writable loop-backed disks and ordinary filesystems under `/snap` must alert.
- Unknown, network, memory-backed, and overlay filesystems must stay monitored.
- Raw measurements, threshold boundaries, and non-filesystem findings must remain.

## Task 1: Filter Capacity Findings by Filesystem Semantics

**Files:** `src/core/snapshot-manager.ts`, `src/core/snapshot-manager.spec.ts`,
`docs/OPERATIONS.md`, and this completion record.

**Interfaces:** Consume the existing `FilesystemSummary` fields. Keep the helper
private to the snapshot module and preserve `acornops.agentv-snapshot.v2`.

- [x] Add snapshot-output regressions for immutable types and the review cases.
- [x] Run `npm test -- src/core/snapshot-manager.spec.ts`; expect the immutable
  image cases to fail because the old code emits `FILESYSTEM_PRESSURE`.
- [x] Add the private type-based pressure predicate; do not filter telemetry.
- [x] Re-run targeted tests; expect all cases to pass.
- [x] Document the exclusions, sandbox caveat, and agent-upgrade requirement.
- [x] Run `npm run validate`, `npm run test:coverage:all`,
  `npm run smoke:package`, and `git diff --check`; expect success.
- [x] Review the final diff independently and move this record to `completed`.

## Task 2: Keep Inventory Badges Consistent

Final review identified a second percentage-only predicate in control-plane's
`deriveVmInventory`. Leaving it unchanged would continue to label immutable
images as needing attention. Use reported non-info `FILESYSTEM_PRESSURE` mounts
for inventory status; do not duplicate AgentV's format exclusions or thresholds.

- [x] Add a control-plane repository test covering retained image facts without
  pressure, genuine pressure findings, unknown types, and missing/info/unrelated
  findings. Observe the old mapper fail, then implement and re-run.
- [x] Document the mapping and run control-plane validation, workspace contracts,
  and a read-only review of the added backend change.

## Rollout / Rollback

An installed VM needs an AgentV release containing this fix; a console redeploy
alone cannot change emitted findings. Deploy the backend mapping with the agent
upgrade for consistent inventory badges; either merge order is compatible with
the unchanged snapshot schema. Existing issues use the control plane's
normal snapshot reconciliation once the findings disappear. No data deletion or
migration is needed. Rolling back AgentV can restore the false-positive findings.

## Open Questions

None for implementation. Publishing and upgrading the user's VM are separate.

## Completion — 2026-10-25

Implemented and validated locally on `fix/filesystem-capacity-alerts` in AgentV
and control-plane. The initial handoff left changes uncommitted, without a
release, deployment, or live-VM upgrade. Independent read-only review found no
actionable issues.

Validation evidence:

- Baseline `npm test`: 74 tests passed, 19 files; the checkout started clean.
- `npm test -- src/core/snapshot-manager.spec.ts`: observed six immutable-image
  regressions fail before the fix; all 19 tests pass after it.
- `npm run validate`: passed, including 91 unit tests, type/lint, contracts,
  documentation harness, and build.
- `npm run test:coverage:all`: 95 tests passed, including four WebSocket E2Es;
  all coverage floors passed. The initial sandbox run could not bind loopback;
  the same command passed with local listener permission, without test changes.
- `npm run smoke:package`: package and bootstrap failure-path checks passed.
- Control-plane `npm run validate`: passed, 1,327 tests with no skips, using
  isolated PostgreSQL 16 and Redis 7 fixtures. Its first run lacked the required
  database configuration; the fixtures resolved that setup failure.
- Parent `node scripts/harness/check-platform-contracts.mjs`: passed.
- `git diff --check`: passed in both repositories.

Collector validation used mocked host adapters. No live Linux/systemd or
staging reboot-canary test was run on this macOS host; those remain release
acceptance work. No migration changed; control-plane's optional SQL upgrade
matrix was not run, but a fresh disposable database applied all migrations.
The pre-existing Zod advisory and staging acceptance gap remain tracked in
[Tech Debt](../tech-debt-tracker.md); dependency changes are outside this fix.

## Release follow-up — 2026-10-25

The user subsequently authorized another review, main merge, release and demo
redeployment. A fresh independent review found no actionable issues, including
snapshot byte trimming and backend reconciliation. AgentV `.10` changes only
the package/lock version and existing version assertion in addition to the fix.
Fresh `npm run validate`, `npm run test:coverage:all` (95 tests),
`npm run smoke:package`, and `npm run smoke:curl-compat` passed. The deployment
repository's `filesystem-capacity-release` plan tracks publication and rollout.
Hosted systemd gates and published provenance remain required before deployment;
the user's installed agent requires a separate upgrade, not re-enrollment.
