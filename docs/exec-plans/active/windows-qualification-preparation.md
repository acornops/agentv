# Windows qualification preparation implementation plan

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

- [ ] Add the narrow verifier and read-only workflow; preserve `release.yml` byte-for-byte. Configuration-only wiring uses native artifact execution rather than source-string tests.
- [ ] Validate workflow with `actionlint .github/workflows/windows-candidate.yml`; expected PASS.
- [ ] Hosted build/verification must pass, retain only allowlisted files, and include negative checksum/package corruption checks before candidate acceptance.
- [ ] Commit on the existing AgentV feature branch after local required validation; retain hosted evidence before final completion.

### Task 2: Prepare and verify reboot evidence

**Files:** Create `scripts/windows-qualification/reboot-evidence.mjs`, `reboot-evidence.test.mjs`, `reboot.ps1`, `scripts/windows-tests/reboot-probe-tests.ps1`; modify native parser/installation fixture and qualification workflow to run checks.

**Interfaces:** `evaluateRebootEvidence(mode, current, before?)` returns `{ schema, status, checks }`; mode is `prepare` or `verify`. Native script accepts `-Mode`, `-EvidenceDirectory`, `-NodePath`; writes protected checkpoint/report and fails nonzero on rejected evidence. Consumes existing installed path/ownership/package helpers; never mutates installation state.

- [ ] Write fixture tests first: valid prepare/reboot, same boot, new launch without reboot, wrong machine/config/package/service, absent/old/future/provisional evidence, pending state and malformed input. Run `node --test scripts/windows-qualification/reboot-evidence.test.mjs`; expected missing evaluator failure.
- [ ] Implement minimal pure evaluator and bounded stdin CLI; expected all fixture tests PASS.
- [ ] Implement native observation and protected persistence. Add native disposable-installation prepare/same-boot rejection, checkpoint preservation, and stopped-service rejection checks. Do not reboot hosted runners.
- [ ] Run required `npm run validate`, `npm run test:coverage:all`, `npm run smoke:package`, actionlint and native matrix. Expected PASS; real reboot remains unexecuted.
- [ ] Commit scoped AgentV changes.

### Task 3: Characterize shared status races with real stores

**Files:** Create sibling `control-plane/test/vm-connection-repair-ownership.test.ts`; update its status-repair plan/spec and plan indexes.

**Interfaces:** Existing `vmConnections.transition`, `claimAgentOwner`, `getAgentOwner`, `markConnectionOfflineIfUnowned`; actual isolated PostgreSQL/Redis. No new runtime interface.

- [ ] Add bounded test barriers delaying delivery of real Redis reads and SQL publication; parameterize legacy Linux/Windows. Assert existing intermediate offline status and final B identity, plus committed-B and admin/settings protection.
- [ ] Run against disposable stores using Node's test runner; expected PASS as characterization (no invented RED or production change).
- [ ] Run control-plane `npm run validate` with migrated isolated stores; expected PASS with no skips. Confirm `git diff -- src` empty.
- [ ] Commit tests/documentation only on the existing control-plane feature branch.

## Completion and handoff

- [ ] Fresh independent review of the complete scoped change; resolve important findings with behavioral checks.
- [ ] Push existing feature branches once source/review are ready; inspect hosted Linux and Windows results and download relevant new artifacts.
- [ ] Record exact commits, validation, unexecuted reboot and remaining protocol/timeout gates; complete plans without closing the broader rollout plans.

Rollback is reverting these qualification/test additions; production behavior is unchanged. No release or environment rollback is necessary.
