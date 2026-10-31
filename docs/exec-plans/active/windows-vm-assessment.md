# Windows VM assessment and Linux baseline

Date: 2026-10-31. Status: assessment; no runtime implementation changes.

## Goal

Prepare a reviewed, compatibility-first Windows VM design and establish the
Linux baseline before implementation. Full user scope includes Windows support,
feature branches, minimal changes, and comprehensive Linux regression evaluation.

## Isolation and baseline revisions

Worktree root: `/Users/tjtanjin/Desktop/acornops/tmp/windows-vm-support`.
Matching branch: `feat/windows-vm-support` in workspace, AgentV, control-plane,
and management-console. Original main checkouts and unrelated work are preserved.
The native worktree tool cannot address these nested repositories; ordinary Git
worktrees were created after its `sourceRoot` validation rejected the request.
Untouched counterparts are local symlinks used only for contract reads.

| Repository | Baseline |
| --- | --- |
| Workspace | `508833a` |
| AgentV | `3d86cfce68d6708299ad30808152b36e8046c241` |
| Control plane | `cecdcdb` |
| Management console | `b916775` |

## Assessment and approach

See [proposed design](../../design-docs/windows-vm-linux-compatibility.md).
Independent read-only review covered backend/UI compatibility and gateway catalog
identity. It found no need for a gateway schema migration: tools are already
scoped by destination/server. Enrollment OS validation must precede provisional
verification, and routine VM status updates currently overwrite OS metadata.

## Validation ledger

Logs are under `/private/tmp/acornops-windows-validation`.

| Command | Result |
| --- | --- |
| AgentV `npm run validate` | PASS: 132 tests in 21 files; lint/typecheck, contracts, harness, build |
| AgentV `npm run test:e2e` | PASS: 4 tests; localhost permission granted |
| Control plane `npm run validate` (sandbox) | Environment failure: localhost listeners denied with `EPERM`; stopped |
| Control plane focused handoff test with `--test-force-exit` | 7 pass, 1 fail due to `listen EPERM 127.0.0.1`; establishes sandbox cause |
| Control plane `npm run validate` (localhost allowed, no database configured) | Environment failure: required test database absent (`ECONNREFUSED`, missing `CONTROL_PLANE_TEST_DATABASE_URL`); completed with failures |
| Console `npm run validate` (sandbox) | 1,240 tests passed; preview-server bind denied on 127.0.0.1:4179 later in validation |
| Console `npm run validate` (localhost allowed) | PASS: 1,240 tests, typecheck, design checks, contracts, harness, build, bundle budget, and route smoke |
| Workspace `node scripts/harness/check-platform-contracts.mjs` | PASS |
| AgentV `npm run smoke:package` | PASS: release archive, checksum, dependency/content checks, bootstrap validation and failure-path smoke |
| AgentV curl compatibility container (task-specific image; network disabled; checkout read-only) | PASS: bootstrap validation and failure-path smoke |
| Control plane `npm run db:migrate` (isolated test database) | PASS: migrations 001 through 012 applied to fresh disposable database |
| Control plane `npm run validate` (isolated test database) | PASS: 1,519 tests, 0 failures/skips; typecheck, style, migration/authz/membership/durability checks, contracts, public/admin OpenAPI, harness, build |

The database-backed run uses dedicated auto-removing Docker containers with
loopback-only random ports, no persistent volumes, and database
`acornops_windows_test`. Both `DATABASE_URL` and
`CONTROL_PLANE_TEST_DATABASE_URL` point to it. Redis is also dedicated to this
task. Existing services and databases are not used. Test service cleanup is
complete: both task-named database containers were stopped and auto-removed;
`docker ps -a --filter label=acornops.task=windows-vm-support` returned no containers.

Exact database-backed command environment (credentials are disposable test
values, not account secrets):

```sh
export NODE_ENV=test
export DATABASE_URL=postgresql://acornops:acornops@127.0.0.1:58758/acornops_windows_test
export CONTROL_PLANE_TEST_DATABASE_URL=postgresql://acornops:acornops@127.0.0.1:58758/acornops_windows_test
export REDIS_URL=redis://127.0.0.1:58763/0
npm run db:migrate
npm run validate
```

Exact curl checks, run from the AgentV feature worktree:

```sh
docker build -t acornops-windows-baseline-curl:20261031 -f scripts/curl-compat.Dockerfile scripts
docker run --rm --network none --label acornops.task=windows-vm-support -v /Users/tjtanjin/Desktop/acornops/tmp/windows-vm-support/agentv:/workspace:ro acornops-windows-baseline-curl:20261031
```

Total baseline: 2,895 tests passed across the three repositories, plus package,
bootstrap, contract, harness, build, and route checks. Earlier failed attempts
were environment setup failures; the final canonical validations all passed.

The pre-change Linux `tools/list` catalog was generated from built AgentV
experimental.14 sources into `linux-v14-tools.json` in the log directory.
It includes 9 tools; SHA-256:
`e06aeb4e125a43ec271888f440b8763ef86ce8a64726454ebbc54b74745ca81c`.
This is a characterization artifact, not real-host qualification.

The local published tag `v0.0.1-experimental.14` resolves to
`5c96872154b9de536a51dc2b1416721e4722b5c2`. `git diff
v0.0.1-experimental.14 HEAD -- src packaging scripts package.json
package-lock.json` is empty at the baseline revision. The generated catalog and
package tests therefore characterize the same runtime/packaging sources as that
release, although they do not verify a downloaded release artifact's provenance.

## Assessment checkpoint

The independent builder review reported no important unanswered planning
questions. The user approved implementation on 2026-10-31 and reiterated that
all changes stay on the feature branch with thorough review. The staged
[implementation plan](windows-vm-implementation.md) now tracks that work.

## Remaining work

- [x] Inspect repository instructions, state, contracts, adapters, enrollment,
  persistence, UI, and existing validation.
- [x] Create isolated matching feature branches without carrying unrelated edits.
- [x] Independent pre-refactor compatibility review.
- [x] Draft conservative design and phase/release gates.
- [x] Complete baseline diagnostics and record outcomes; canonical validations passed.
- [x] Independent builder review of design: no important unanswered planning questions.
- [x] Approve design, then write detailed per-phase implementation plans.
- [ ] Implement and evaluate each reviewed phase.

## Rollout, docs, and residual risk

No product behavior, deployed host, release tag, or production configuration has
changed. This document and the design are assessment artifacts. Windows live
collectors, Windows service installation/reboot recovery, real Linux systemd,
database integration, and mixed-version cross-service qualification are not yet
validated in this task. Do not report Windows support or zero regressions from
this assessment alone.
