# Windows qualification preparation implementation plan

Status: completed on feature branches; actual reboot and production rollout remain unqualified.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Track steps with checkboxes.

**Goal:** Produce reviewable candidate artifacts and reboot checks, plus deterministic real-store status coverage, without runtime changes.

**Architecture:** Reuse Windows package/trust validators in separate qualification scripts. Keep reboot decisions in a pure evaluator and actual observations in PowerShell. Control-plane additions are tests only.

**Tech Stack:** Node 22/24, PowerShell 5.1, GitHub Actions, PostgreSQL 16, Redis 7, node:test.

**Spec:** [Qualification preparation](../../design-docs/windows-qualification-preparation.md).

## Global Constraints

- Feature branches only; no merge, publication, activation or Windows writes.
- Linux runtime, Linux release workflow and shared production source stay unchanged.
- No speculative timeout/retry/scheduler fix; the 10-second timeout cause remains unknown.
- Hosted CI cannot qualify an actual reboot; fixtures and real observations must remain distinguishable.
- No raw credentials or protected configuration in evidence or logs.

## Review Focus

- Changed or incomplete package assets must fail candidate verification before upload.
- Same-boot, stale/wrong-launch and provisional authentication must fail reboot verification.
- Different host, altered credentials/release and pending transaction must not pass reboot checks.
- Probe failures must not alter installed state or overwrite a prepared checkpoint.
- Stale missing-owner responses must not be misrepresented as a solved atomicity gap.

### Task 1: Retain verified Windows candidate assets

**Files:** Create `.github/workflows/windows-candidate.yml`, `scripts/windows-qualification/verify-candidate.ps1`; update operations/docs indexes.

**Interfaces:** Consumes existing `build-windows-archive.ps1`, `Assert-AgentVPackage`, protected-path helpers. Produces the existing four package assets plus `candidate-evidence.json`, marked unqualified and bound to HEAD.

- [x] Add the narrow verifier and read-only workflow; preserve `release.yml` byte-for-byte. Configuration-only wiring uses native artifact execution rather than source-string tests.
- [x] Validate workflow with `actionlint .github/workflows/windows-candidate.yml`; expected PASS.
- [x] Hosted build/verification must pass, retain only allowlisted files, and include negative checksum/package corruption checks before candidate acceptance.
- [x] Commit on the existing AgentV feature branch after local required validation; retain hosted evidence before final completion.

### Task 2: Prepare and verify reboot evidence

**Files:** Create `scripts/windows-qualification/reboot-evidence.mjs`, `reboot-evidence.test.mjs`, `reboot.ps1`, `scripts/windows-tests/reboot-probe-tests.ps1`; modify native parser/installation fixture and qualification workflow to run checks.

**Interfaces:** `evaluateRebootEvidence(mode, current, before?)` returns `{ schema, status, checks }`; mode is `prepare` or `verify`. Native script accepts `-Mode`, `-EvidenceDirectory`, `-NodePath`; writes protected checkpoint/report and fails nonzero on rejected evidence. Consumes existing installed path/ownership/package helpers; never mutates installation state.

- [x] Write fixture tests first: valid prepare/reboot, same boot, new launch without reboot, wrong machine/config/package/service, absent/old/future/provisional evidence, pending state and malformed input. Run `node --test scripts/windows-qualification/reboot-evidence.test.mjs`; expected missing evaluator failure.
- [x] Implement minimal pure evaluator and bounded stdin CLI; expected all fixture tests PASS.
- [x] Implement native observation and protected persistence. Add native disposable-installation prepare/same-boot rejection, checkpoint preservation, and stopped-service rejection checks. Do not reboot hosted runners.
- [x] Run required `npm run validate`, `npm run test:coverage:all`, `npm run smoke:package`, actionlint and native matrix. Expected PASS; real reboot remains unexecuted.
- [x] Commit scoped AgentV changes.

### Task 3: Characterize shared status races with real stores

**Files:** Create sibling `control-plane/test/vm-connection-repair-ownership.test.ts`; update its status-repair plan/spec and plan indexes.

**Interfaces:** Existing `vmConnections.transition`, `claimAgentOwner`, `getAgentOwner`, `markConnectionOfflineIfUnowned`; actual isolated PostgreSQL/Redis. No new runtime interface.

- [x] Add bounded test barriers delaying delivery of real Redis reads and SQL publication; parameterize legacy Linux/Windows. Assert existing intermediate offline status and final B identity, plus committed-B and admin/settings protection.
- [x] Run against disposable stores using Node's test runner; expected PASS as characterization (no invented RED or production change).
- [x] Run control-plane `npm run validate` with migrated isolated stores; expected PASS with no skips. Confirm `git diff -- src` empty.
- [x] Commit tests/documentation only on the existing control-plane feature branch.

## Completion and handoff

- [x] Fresh independent review of the complete scoped change; resolve important findings with behavioral checks.
- [x] Push existing feature branches once source/review are ready; inspect hosted Linux and Windows results and download relevant new artifacts.
- [x] Record exact commits, validation, unexecuted reboot and remaining protocol/timeout gates; complete plans without closing the broader rollout plans.

Rollback is reverting these qualification/test additions; production behavior is unchanged. No release or environment rollback is necessary.

## Implementation and verification evidence

AgentV source checkpoint `79ed02f50131d84241b0d734f823ebfcc1845808`
contains candidate/reboot tooling (`d0112ff`), bounded failure evidence and native
CLI coverage (`8656b0d`), and the confirmed UTF8 BOM correction (`79ed02f`).
Control-plane source checkpoint `85d6ff656c093643412cad8706018fb61f29f725`
adds the ten real-store tests; its documentation closeout is `b188a36`.
Parent `314ecad`, console `5eabc88` and API docs `a39eb95` are unchanged.

This phase has no changes under AgentV `src/` or `packaging/`, to the Linux
release workflow, or under control-plane `src/`. Both mock behavior and live
Linux systemd gates were validated. Existing dirty files in linked main
checkouts were preserved; only the two labelled disposable test databases were
removed after validation.

| Command/check | Result |
| --- | --- |
| AgentV `npm run validate` | Pass: lint/typecheck, 256 tests/36 files, contracts, harness and build. Repeated after the native CLI correction. |
| AgentV `npm run test:coverage:all` | Pass: 260 tests/37 files; statements 80.23%, branches 71.8%, functions 76.42%, lines 88.14%; all required floors pass. Production source is unchanged since this run. |
| AgentV `npm run smoke:package` | Pass: package and bootstrap failure-path checks. |
| `node --test scripts/windows-qualification/reboot-evidence.test.mjs` | Pass: 32 decision/CLI cases. The BOM regression failed before the parser correction and passes afterward. |
| `actionlint .github/workflows/windows-candidate.yml .github/workflows/windows-installer.yml` | Pass. |
| Control-plane targeted real-store suite | Pass: 10 cases with actual PostgreSQL16/Redis7 and bounded barriers, no skips. |
| Control-plane `npm run validate` | Pass: 1,741 tests/256 suites, zero failures/skips, plus required contract, harness, type and build checks. |
| Parent `task validate` | Pass: four harness regressions, commit checks, platform harness/contracts and runtime truth. |
| Independent review | No Critical, Important or Minor findings in the initial scoped implementation; evaluator, workflow and production-boundary checks independently verified. Subsequent native CLI failure was reproduced and corrected with RED→GREEN and hosted execution. No review minors deferred. |

[Linux CI 41317861474](https://github.com/acornops/agentv/actions/runs/41317861474)
passes required validation/coverage, package/bootstrap/curl compatibility and
both Ubuntu24.04 Node22/24 live install/restart/upgrade/rollback/uninstall gates.
It tests source `d0112ff` through merge
`073e19e62116ede963eb3726039c3f787f4c1084` with main `3d86cfc`.
Later changes only affect Windows qualification scripts/fixtures, a manual
Windows workflow selector and documentation. Required coverage computation and
artifact retention pass; optional unconfigured Codecov publication is skipped.

At the same tested merge, [collectors 41317861428](https://github.com/acornops/agentv/actions/runs/41317861428)
and [service host 41317861468](https://github.com/acornops/agentv/actions/runs/41317861468)
pass all four Server2022/2025 × Node22/24 cells. All eight native artifacts were
inspected: host reads take 5,199–9,030ms, assignment-negative containment checks
pass, and the service host records 33 checks per cell. These samples do not
establish a repair for earlier collector/LocalService failures or cold overlap.

[Backend CI 41317879789](https://github.com/acornops/control-plane/actions/runs/41317879789)
passes the complete 1,741-test/256-suite validation at source `85d6ff6`, tested
merge `05fab7ac770e8c2dce897e1a6c1f7e25ff5ffb6e`. The ten additions characterize
the delayed missing-owner read and protect a committed replacement's identity,
administrative state and settings. They do not implement cross-store atomicity
or recurring stale-status repair. Its [completed record](https://github.com/acornops/control-plane/blob/feat/windows-vm-support/docs/exec-plans/completed/windows-status-characterization.md)
preserves the remaining ownership/liveness design gate.

## Native harness failure and correction

The initial [installer run 41317861437](https://github.com/acornops/agentv/actions/runs/41317861437)
passed fourteen jobs and failed the four new startup probes after successful
installation. The first fixture did not retain the detailed report before
cleanup. The diagnostic change preserves only fixed check IDs/booleans and safe
failure categories and adds a real PowerShell-to-Node synthetic CLI fixture.
[Diagnostic startup 41318673814](https://github.com/acornops/agentv/actions/runs/41318673814)
then retained `input=false` for all four cells;
[diagnostic candidate 41318676647](https://github.com/acornops/agentv/actions/runs/41318676647)
reproduced the same rejection at the native stdin boundary. All eight failed
startup artifacts were retained rather than replaced by later passing results.

A local BOM-bearing CLI test failed with exit1 instead of exit0. The parser now
accepts exactly one optional UTF8 BOM before JSON while retaining the original
32KiB byte limit. The final native CLI fixture observed the exact `efbbbf` prefix
and passed preparation plus same-boot rejection. This is the identified cause
and repair of the new harness failure, unrelated to the original ten-second
collector timeout.

[Candidate run 41319199171](https://github.com/acornops/agentv/actions/runs/41319199171)
passes at exact source `79ed02f`: 32 evaluator/CLI cases, native CLI/parser,
archive build, original asset verification, outer ZIP/installer corruption
rejection and inner-manifest corruption rejection after recomputing the outer
checksum. The final restored assets are verified again before upload. The
downloaded artifact contains exactly five allowlisted files; both asset
checksums, source identity and all 918 package-manifest files were independently
verified. Its report remains explicitly unqualified and its hosted retention is
14 days; it is not a production release.

[Focused startup run 41319202055](https://github.com/acornops/agentv/actions/runs/41319202055)
passes all six jobs at `79ed02f`: two recovery-state jobs and four native startup
cells with fourteen checks each. Each startup artifact proves prepare succeeds,
checkpoint overwrite is refused, same-boot and stopped-service verification
fail, and protected installation/checkpoint contents are preserved. The artifacts
explicitly label actual reboot qualification `not-executed`.

[Full installer run 41319492655](https://github.com/acornops/agentv/actions/runs/41319492655)
passes all eighteen jobs at exact source `79ed02f`, with `startup_only=false`.
All 22 artifacts were downloaded and their archive SHA256 values verified
against GitHub metadata. Every OS/Node cell records lifecycle23, recovery21,
startup14 and acceptance21 checks, a complete stage and healthy running service.
Both OS versions also pass six generated-wrapper cases, 25 API-diagnostic cases
and ten teardown-race checks. All four same-boot reports reject a reboot pass
while preserving healthy current/before evidence and unchanged installation.
Generated-wrapper bootstrap, native API I/O and installer backend fixtures retain
their synthetic boundaries. The full final matrix replaces no historical failure
evidence and waives no qualification gate.

## Decisions and remaining gates

1. Native execution must pass before completion; an actual reboot remains
   unexecuted. The prepared read-only probe cannot substitute for disposable-host
   reboot/power-loss, minimum-host sizing, Core/Desktop Experience or combined
   native-agent/real-backend qualification. Cost if wrong: overstated readiness.
2. Shared ownership atomicity and recurring outage repair remain behind their
   separate protocol design gate. Only deterministic characterization was added.
   Cost: process/dependency loss can still leave stale online status for Linux
   and Windows; the intermediate offline observation is not claimed repaired.
3. The intermittent collector timeout and historical LocalService/cold-overlap
   failures retain their evidence and unknown causes. No speculative deadline,
   retry or scheduler change was made. Cost: cold reads may still time out and
   Windows rollout remains blocked.
4. Candidate retention does not authorize production signing/provenance,
   immutable publication, activation or Windows writes. Cost: these assets cannot
   yet support a qualified rollout.
5. `startup_only=true` was added only for explicit manual diagnostic dispatch;
   default and PR dispatch retain the complete matrix. Cost: intermediate runs
   have narrower coverage; the mandatory final full matrix passed all eighteen jobs.

The reviewer deferred the first four readiness judgments to the executor;
these rulings retain the existing qualification boundaries. The fifth records
the diagnostic execution decision. No review minors were deferred. Feature
branches and draft PRs remain in place; nothing was merged, released, deployed
or activated.
