# Windows VM assessment and Linux baseline

Date: 2026-10-31. Status: completed baseline assessment; staged implementation now tracked separately.

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

At the assessment checkpoint no product behavior, deployed host, release tag, or
production configuration had changed. Subsequent feature work is tracked in the
implementation plan. The native Linux baseline follow-up below extends the
original evidence; Windows live collectors, Windows service installation/reboot
recovery and mixed-version cross-service qualification remain outstanding.
Do not report Windows support or zero regressions from this assessment alone.

## Released Linux compatibility characterization (task 1)

The committed `src/fixtures/linux-v14-tools.json` is an unchanged copy of the
pre-change catalog above, not a fixture regenerated by the comparison test.
Its SHA-256 remains
`e06aeb4e125a43ec271888f440b8763ef86ce8a64726454ebbc54b74745ca81c`.
AgentV baseline `ddcc676333dc6c8d9b99fd5a771f5101bb8fbe17` has the same runtime,
packaging and script sources as published tag `v0.0.1-experimental.14` at
`5c96872154b9de536a51dc2b1416721e4722b5c2`. The control-plane baseline is
`cecdcdb739053fd6acdee8c8b7aafc48c13b1c89`. This establishes source compatibility;
it does not qualify a downloaded artifact or a native host.

| Contract | Characterization coverage |
| --- | --- |
| Complete Linux tool catalog | AgentV `src/linux-compatibility.spec.ts` compares the real registry/router `tools/list` result with all nine frozen descriptors, including restart input, output envelopes, capability, version, timeout and artifact policy. |
| Read-only and helper-qualified advertisement | Existing AgentV `src/e2e.spec.ts`, especially “gates tools and compressed bounded snapshots behind a validated handshake” and “revokes a disconnected generation and reauthenticates before resuming work”; `src/config.spec.ts` retains secure read-only defaults. |
| Omitted stored OS/access metadata | Control-plane `test/repository-virtual-machines.test.ts`, “reads legacy metadata without OS or access fields as a read-only Linux/systemd VM”, pins Linux/systemd, journald/syslog and read-only defaults. |
| Linux bootstrap command | Control-plane `test/services/virtual-machine-install-instructions.test.ts` now compares the entire existing command, including exact release URL, argument order and shell quoting of a token containing an apostrophe and command-substitution text. |
| Legacy handshake omissions | Control-plane `test/agent-handshake-vm.test.ts` exercises provisional and active Linux handshakes with optional helper fields omitted. The provisional case also omits tool/capability fields. The released handshake still requires `hostFeatures.osFamily=linux` and `serviceManager=systemd`; a separate guard test rejects missing identities before credential verification. Omitted registration metadata is distinct from omitted handshake identity. |
| Legacy Linux snapshots | Existing control-plane `test/repository-virtual-machines.test.ts` tests “normalizes VM snapshot finding severity before latest finding insert” and “preserves telemetry and distinct inventory rows when process names or listener ports repeat” ingest snapshots without a mandatory schema discriminator or finding coverage. The fingerprint test also consumes that legacy shape. |
| Stable Linux issue identities | Control-plane `test/target-issue-fingerprints.test.ts` pins literal service-state/finding, filesystem and memory fingerprints across changed timestamps and summaries. State and `SERVICE_FAILED` evidence retain the same service identity. |
| Incomplete evidence never clears an issue | Existing control-plane `test/virtual-machine-issue-recovery.test.ts` covers failed/missing collectors, trimmed filesystem/service inventories, explicit finding coverage and absent memory facts. The repository test “only recovers a missing filesystem issue after successful snapshot collection” checks reconciliation at ingestion. |

Characterization sensitivity was checked by temporarily removing
`expected_active_state` from the frozen restart input schema. The comparison
failed with the expected schema diff; the fixture was restored byte-for-byte.
AgentV `npm run validate` passed (133 unit tests, lint, contracts, harness and
build). Its existing lifecycle e2e suite passed 4 tests. The five affected
control-plane suites passed 29 tests with database/Redis boundaries replaced by
their existing test doubles; `DATABASE_URL` pointed to unused localhost port 9.
No runtime source or packaging was changed. Full control-plane validation and
native/package qualification were not repeated for this test-only task; their
pre-change results above remain separate evidence.

## Native Linux baseline follow-up

AgentV feature commit `32da905` passed [CI run41209224807](https://github.com/acornops/agentv/actions/runs/41209224807) on2026-10-31 before runtime implementation. Validation, coverage, and both Ubuntu24.04 live systemd gates (Node22 and Node24) succeeded. Downloaded job logs explicitly confirm runtime selection/trust/pinning, release archive/bootstrap checks, display-form restart and canonical replay/precondition guards, and live install/restart/upgrade/rollback/uninstall.

Logs: `/private/tmp/acornops-windows-validation/baseline-native-linux-node22.log` and `baseline-native-linux-node24.log`. This establishes native baseline behavior; changed runtime must pass these gates again. The user selected hosted Windows CI for this implementation, so actual Windows reboot testing remains unqualified.
