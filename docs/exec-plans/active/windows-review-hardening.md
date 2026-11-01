# Windows review hardening implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for scoped implementation and independent review. Track steps with checkboxes.

**Goal:** Repair the demonstrated Windows gaps, enforce compatibility checks, and reduce diagnostic debt while preserving Linux behavior.

**Architecture:** Keep Windows adapters and scheduling separate from Linux. Reuse pure Windows validation and producer-generated contract cases. Diagnose native failures before selecting any further runtime policy; shared backend repair gets its own plan.

**Tech stack:** TypeScript, Node 22/24, PowerShell 5.1, .NET Framework 4.8, existing Vitest/backend tests and GitHub-hosted Windows CI.

**Spec:** [Authorized review hardening](../../design-docs/windows-review-hardening.md).

## Global constraints

- Work only in existing `feat/windows-vm-support` feature worktrees. No merge, release, deployment or activation.
- Preserve Linux adapters, schemas, tool contracts, helper, scheduler, packaging and release coordinates. Windows writes remain denied.
- Preserve Windows host/non-host collector deadlines of 10,000/8,000 ms, tool/startup/doctor/backend deadlines of 12,000/15,000/20,000/25,000 ms, 1 MiB combined collector output, fixed scripts, trusted executable and credential-free environment. No retry or prewarming policy.
- Tests must exercise production behavior; retain failed native evidence and distinguish synthetic transport/data from native deployment. Hosted restart is not reboot evidence.
- Native fixtures require disposable hosted CI and own every resource they clean up. Publish only bounded allowlisted diagnostics, never raw host data, messages, credentials, command lines or environment.
- One implementation owner at a time. Existing unrelated work and dependency symlinks stay untouched. Keep shared backend reconciliation separate from Windows-local fixes.

## Review focus

- Old aborted work settles after multiple reconnects: only the newest generation may send or schedule a pending collection.
- Stop occurs during pending work: no new native collection may begin after stop.
- Log-window defaults, invalid dates, future skew and boundary values must match mock/live without weakening live restrictions.
- A future producer change must fail a durable check even when hand-authored consumer tests still pass.
- Diagnostic code must not turn an uncertain installer result into success or leak sensitive native/network content.

### Task 1: Preserve the current-generation startup snapshot

**Files:** `src/windows/snapshot.ts`; new `src/windows/snapshot-manager.spec.ts`. Existing Linux scheduler is a reference only.

**Interfaces:** Preserve `WindowsSnapshotManager.start(intervalMs, maxBytes)` and `stop()`. A pending start coalesces to the newest generation and budget, without overlapping collections or retrying stale work.

- [x] Add a deterministic deferred-promise regression: start, stop/restart while old work drains, release old work; assert exactly one fresh-generation snapshot without advancing a one-hour interval. Observe RED on current source.
- [x] Cover repeated restarts, changed maxBytes, stop-before-drain and collection failure; retain no stale send and at most one active collection. Use fake timers/barriers, not wall-clock sleeps.
- [x] Add minimal Windows-local active/pending scheduling state; leave snapshot construction and Linux source unchanged.
- [x] Run `npx vitest run src/windows/snapshot-manager.spec.ts src/windows/snapshot.spec.ts src/windows/lifecycle.spec.ts src/linux-compatibility.spec.ts`, then `npm test` and `npm run typecheck`. Record exact results and commit only task files.
- [x] Independent spec/quality review before completion.

### Task 2: Match Windows mock/live log validation

**Files:** `src/windows/live.ts`, `src/windows/mock.ts`, new `src/windows/log-input.ts`, new `src/windows/log-input.spec.ts` (or focused existing Windows tests if clearer).

**Interfaces:** A pure helper validates `WindowsLogsInput` against allowed channels and an explicit clock value, returning normalized `since`/`until` ISO strings. Both hosts call it; live supplies those values to the existing runner. Retain current live error codes/messages and defaults.

- [x] Demonstrate RED through both hosts for the same validly shaped 48-hour request: both must reject with `INVALID_ARGUMENTS`, without calling the native runner.
- [x] Cover allowed/denied channels, default one-hour window, exactly 24 hours and over, reversed/invalid dates, 60-second future boundary, row and byte bounds. Use one table of cases across both hosts and a controlled clock.
- [x] Extract only the existing pure live validation and use it in both hosts; retain native collection/filter/output behavior and synthetic mock output.
- [x] Run focused parity/collector/mock tests, `npm test`, and `npm run typecheck`; record RED/GREEN evidence and commit the scoped change.
- [x] Independent spec/quality review before completion.

### Task 3: Make Windows cross-repository compatibility executable

**Files:** AgentV `src/windows/fixtures/snapshot-contract-cases.ts`, `src/windows/fixtures/snapshot-contract.json`, `src/windows/snapshot-contract.spec.ts`; backend `test/fixtures/windows-snapshot-contract.json`, `test/fixtures/windows-generated-commands.json`, `test/windows-vm-producer-contract.test.ts`; existing AgentV `scripts/windows-tests/generated-command-fixtures.json`; parent `scripts/harness/check-platform-contracts.mjs` and a focused helper/test if needed; mirrored runtime docs and relevant contract docs. A small fixture-generation entrypoint may live under AgentV `scripts/windows-tests/`; test data must not enter production compilation.

**Interfaces:** Producer tests regenerate deterministic cases through actual production builders and compare committed JSON. Consumer tests parse/project the mirrored JSON through production consumers. Existing workspace contract gate compares counterpart fixture content. Native command tests continue consuming exact builder output. Each repository's own checks work without a sibling checkout or network access.

- [x] Add producer-generated snapshot cases covering healthy, denied, unavailable, partial and capped rows using the real `buildWindowsSnapshot`; compare actual serialized output to the checked-in artifact. Keep test-only faults outside production code.
- [x] Consume the same artifact with backend snapshot validation and collection projection; assert meaningful expected health/count/coverage and unchanged Linux behavior. Mirror comparison belongs in the existing parent gate.
- [x] Add a backend test comparing the real Windows installation command builder against the exact committed wrapper commands and inputs. Mirror those cases to the AgentV native fixture; check source provenance when source hashes are recorded.
- [x] Prove intentional fixture/source mismatches fail the relevant gates; do not invent a second command generator or duplicate the producer implementation.
- [x] Correct the backend runtime paragraph to host 10s/non-host 8s and add a maintained counterpart document/fixture check. Preserve security checks and protocol version.
- [x] Run affected producer/consumer tests, repository contract/harness checks and parent contract check. Run each changed repo's full test suite before commit; native wrapper execution is included in final hosted qualification.
- [x] Independent task review across the exact changed repository ranges.

### Task 4: Preserve safe installer failure categories

**Files:** `packaging/windows/Installation.psm1` API helper; narrowly scoped companion helper only if required by existing file budgets; native tests under `scripts/windows-tests/`; existing short installer recovery-state workflow.

**Interfaces:** Preserve `Invoke-AgentVApi` result fields and all recovery decisions. Emit at most one bounded line per failed call with a fixed category and allowlisted numeric native/HTTP code. No raw exception/output/body/path/URL. Test the same production helper on hosted Windows.

- [x] Characterize existing unavailable/code/data outcomes for transport failure, invalid HTTP-status output, bounded malformed response and non-success HTTP response before editing behavior.
- [x] Add failing checks for useful sanitized categories and secret-bearing fake/native failure content; verify diagnostics never disclose injected secrets or change the existing result.
- [x] Add the smallest categorized diagnostic path, preserving catch/finally cleanup and every uncertainty/HTTP return value. Readability changes stay inside touched code.
- [x] Run relevant PowerShell/native checks on both supported Server versions, plus AgentV validation. Review the change before considering it complete.

### Task 5: Investigate overlapping native work and cold-start failures

**Files:** Narrow `scripts/windows-tests/overlap-worker.mjs`, `overlap-evidence.mjs` and focused tests, plus `overlap-native.ps1` or a separate mode reusing the existing owned-job supervisor. `.github/workflows/windows-collectors.yml` gets a separate manual experiment flag/artifact. Qualification docs retain exact evidence. Qualification docs retain exact evidence.

**Interfaces:** Use actual production Windows host/runner. Normal startup and current limits remain unchanged. Measure snapshot fan-out plus four tool reads as a distinct cold component workload that deliberately bypasses the mandatory runtime host preflight; do not infer failure causation from concurrency alone. Use the existing 12-second independent watchdog, one owned cleanup budget, actual child peak distinct from requested calls, and at most 64 KiB allowlisted evidence. Hosted minimum-VM representativeness remains unknown.

- [ ] Review retained failed samples and specify one new discriminating observation before changing diagnostics. Record the hypothesis, bounds and what an inconclusive result means.
- [ ] Add a bounded overlap check using real snapshot construction and tool execution, reporting only counts/status/timing/cleanup. State whether hosted hardware represents the minimum supported VM.
- [ ] Execute the changed experiment once on the relevant supported matrix and inspect artifacts. Retain first-call failures; no unchanged reruns to seek green.
- [ ] If evidence supports a narrow production correction, specify it as a separately reviewed follow-up before implementing. Otherwise retain the qualification blocker with the exact remaining missing evidence. No speculative queue, timeout or retry change.
- [ ] Review fixture safety and causal conclusions independently.

### Task 6: Separate shared VM status reconciliation

**Files:** A separate backend design/plan under `control-plane/docs/`; no shared production edits under this Windows plan.

**Interfaces:** Assess existing owner observations, identity-fenced VM transitions and service lifecycle/scheduler hooks. Any repair must work after dependency recovery/process restart without relying on an agent reconnect, and must not mark a live replacement offline on stale or uncertain observations.

- [x] Trace existing reconciliation/lease/worker patterns and select the smallest architecture that can repair persisted stale identity. Document inherited behavior and current Linux compatibility.
- [x] Write the separate implementation plan with exact lifecycle ownership, bounded batching, shutdown, outage, replacement and process-restart tests; independently review it before execution.
- [x] Execute that separately tracked plan if its reviewed implementation remains focused; otherwise record the concrete broader dependency and remaining work. Preserve current Windows feature isolation and all Linux/Windows lifecycle validation gates.

Disposition: the independently reviewed [backend repair plan](../../../../control-plane/docs/exec-plans/active/vm-connection-status-repair.md) remains at its ownership/liveness design gate. No periodic shared writer was added; outage-induced stale status remains open.

## Final validation and handoff

Run AgentV `npm run validate`, `npm run test:coverage:all`, `npm run smoke:package`, cross-repo contracts, and required checks for any other edited repository. Run final hosted Windows collector/service/installer and Ubuntu Node 22/24 lifecycle gates for the changed source. Record failures honestly. Perform one broad final source review; keep every PR draft and Windows rollout disabled until the independent qualification gates are met.
