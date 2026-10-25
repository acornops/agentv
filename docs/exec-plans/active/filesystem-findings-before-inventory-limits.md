# Filesystem findings before inventory limits

## Goal and scope

Preserve capacity findings for filesystems beyond the 50-row snapshot inventory
limit without changing the public `list_filesystems` tool, mount ordering,
immutable filesystem exclusions, 90% threshold, or snapshot schema.

## Steps and affected modules

1. Add failing regressions combining the real `FilesystemAdapter` and
   `SnapshotManager`: more than 50 Snap mounts before full `/var`, more than 50
   eligible mounts, byte-budget trimming/drop behavior, and command failures.
2. Collect the complete command-output-bounded filesystem result for snapshot
   findings, then retain at most 50 inventory rows and account for every omitted
   row. Keep existing timeout, command-output, and final snapshot-byte bounds.
3. Document the inventory/findings distinction and run focused tests plus
   `npm run validate`.

## Contract impact

No schema-version or public tool change. Optional `finding_coverage.filesystems`
and `finding_coverage.services` distinguish complete evaluated findings from
trimmed inventory; producer/consumer manifests are updated together. A snapshot
may contain a capacity finding for a filesystem whose raw inventory row is omitted. Required findings remain
subject to the existing whole-snapshot byte limit; oversized snapshots are
dropped, never sent with silently truncated findings.

## Rollout and rollback

Requires an AgentV runtime upgrade. Reverting the snapshot-manager change
restores the prior capacity coverage gap. No database or dependency changes.

## Open questions

The coordinated control-plane change requires healthy collector status and
complete finding coverage before clearing an omitted issue. Older agents fall
back to conservative inventory/truncation evidence; upgrade them to recover
issues whose mounts remain outside the raw inventory. Existing collector
failures remain explicit and cannot imply healthy empty storage.

## Completion summary

Implemented and validated locally on `fix/production-readiness`; landing and
release remain pending. The follow-up request on 2026-10-26 authorizes publication
as `.11` and an in-place demo upgrade. Existing user VM installations still
require a separate operator upgrade; no dependency change or host mutation.

- RED: `npx vitest run src/core/snapshot-filesystem-bounds.spec.ts` failed
  3 tests for the expected missing `/var` and beyond-50 capacity findings;
  4 existing-boundary/error scenarios passed.
- GREEN: `npx vitest run src/core/snapshot-filesystem-bounds.spec.ts src/core/snapshot-manager.spec.ts src/adapters/live-boundaries.spec.ts src/adapters/replay.spec.ts`
  passed all 42 tests across 4 files.
- `npm run typecheck` passed.
- `npm run validate` passed lint/typechecking, all 100 unit tests across 20
  files, contract checks, harness checks, and the production build.

The snapshot caller requests the complete adapter result through its existing
limit argument; only retained raw inventory is sliced to 50. No global adapter
sort or public tool behavior changed. Tests preserve the immutable-type and
90% rules, ordinary telemetry, exact omitted counts, byte-budget trimming and
whole-snapshot drops, and explicit failed-collector health. Follow-up regressions
cover finding coverage after raw filesystem/service trimming and genuinely
incomplete service enumeration; coverage-marker tests failed before that change.

Validation used the real filesystem adapter/parser and snapshot serializer
with controlled `df` command output on macOS; it did not execute live Linux
commands or a systemd upgrade. Required findings can still exceed the byte
budget and drop a snapshot, as before. Cross-repository contract checks passed;
independent re-review passed after the coverage-marker correction.

Release preflight, 2026-10-26: independent final review found no new blocker.
`npm run validate` passed again (100 tests), followed by `npm run smoke:package`
for `.11`, including bootstrap failure paths. `task validate` at workspace root
passed cross-repository contracts. Live Node 22/24 systemd release gates remain
required before publication; the known Zod advisory is not waived for production.
