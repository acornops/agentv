# Windows native reliability follow-up

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and independent task review. Steps use checkboxes.

**Goal:** Resolve the outstanding Windows reliability and hosted installation gaps with minimal changes while preserving Linux behavior.

**Architecture:** Keep the existing isolated Windows runtime and package. Diagnose the failing native boundary before selecting a production fix. Extend the existing disposable hosted fixtures for installation coverage; preserve authenticated transport and credential transactions.

**Tech stack:** Node 22/24, Windows Server 2022/2025 x64, PowerShell 5.1, bounded native process diagnostics, existing TypeScript backend.

**Spec:** [Approved compatibility design](../../design-docs/windows-vm-linux-compatibility.md) and [open qualification gates](../../design-docs/windows-qualification-decision.md).

User authorized this focused follow-up on 2026-11-01. Starting AgentV revision:
`342a933e6aa63c07772b7eccf93526907e051a10`. All four hosted workflows at that
revision passed; these samples do not explain the historical failures. This plan
is incremental: the exact repair is specified only after causal evidence exists.

## Global constraints

- Work only in the existing `feat/windows-vm-support` feature worktrees. No merge, release, deployment or activation.
- Preserve Linux adapters, tools, schemas, helper, packaging and release coordinates. Windows writes remain denied.
- Preserve the production collector's fixed scripts/arguments, trusted executable, credential-free environment, 8,000 ms timeout, 1 MiB combined output cap and close/cleanup semantics during diagnosis. No retries, prewarming or raised budgets as a substitute for diagnosis.
- Native test changes must require disposable hosted-CI authorization and own every process, path, certificate and trace they clean up. Do not cancel another trace session or delete preexisting resources.
- Never publish raw ETL, raw host observations, event messages, command lines, environment variables or credentials. Publish bounded allowlisted diagnostic summaries only.
- A failed first invocation stays failed. A passing later sample does not close a reliability gap. An unavailable diagnostic must be reported explicitly.
- Real reboot/power-loss and Core/Desktop acceptance remain unexecuted until an appropriate disposable VM is available. Hosted service restart is not reboot evidence.

## Review focus

- Diagnostic setup inadvertently warms the PowerShell/CIM path before the observed call.
- A timeout or assertion failure skips evidence capture or owned trace/process cleanup.
- Diagnostic reporting leaks command lines, process/host identities or secrets from unrelated activity.
- Instrumentation changes production limits or turns a failed first invocation into a pass.
- Follow-on installer coverage silently uses a substitute command or only tests parameter parsing while claiming complete download/install coverage.

### Task 1: Capture causal native evidence

**Files:** Existing `scripts/windows-collector-smoke.mjs`, `scripts/windows-service-host-smoke.ps1`, `scripts/windows-tests/collector-evidence.mjs`, `.github/workflows/windows-collectors.yml`, `.github/workflows/windows-service-host.yml`; narrowly scoped new diagnostic helpers/profile under `scripts/windows-tests/` only as needed. No production runtime changes in this task.

**Interfaces:** Consume the real `WindowsCollectorRunner` observer and existing fixed collector/service fixtures. Produce a sanitized report distinguishing process execution/initialization, native waits and parent-observation delay for the first bounded call; preserve native gate outcomes separately.

- [x] Read the saved cold-start investigation and failing artifacts. Document one concrete hypothesis and the smallest observation that distinguishes it; validate available native tooling from primary documentation.
- [x] Add opt-in hosted diagnostic capture using installed Windows tooling. Prefer an isolated WPR memory trace capped at 64 MiB, with target-process scheduling/module categories and process CPU versus wall time. Keep raw traces local and remove them after producing a report capped at 64 KiB. If a reliable narrow summarizer is unavailable, report that limitation and propose the next smallest observation instead of building a generic profiling framework.
- [x] Bound first-call capture independently of the production collector. Use a 12-second diagnostic watchdog for the standalone first call; recorder start/stop each have a five-second bound. Do not affect the ordinary non-diagnostic CI path. An optional warm control is limited to one call with the same production bound and is labeled comparison evidence.
- [x] Ensure contained service-identity failures preserve the failing operation/code/stage/timeline before cleanup. Reuse existing diagnostics where sufficient; add tracing only at a specifically identified missing boundary.
- [x] Exercise redaction, bounded output and failure/cleanup behavior with focused meaningful tests. Run normal AgentV validation once before the review checkpoint. Keep diagnostic source and any later production repair in separate commits.
- [x] Run one explicitly identified diagnostic matrix on Server 2022/2025 and Node 22/24, inspect every failure and preserve provenance. Do not repeatedly dispatch unchanged experiments merely to obtain a pass.
- [x] Independently review the diagnostic change and record the causal conclusion or remaining uncertainty. Specify any production repair as the next bounded task before implementing it.

### Task 2: Give the Windows host read bounded cold-start headroom

**Files:** `src/windows/runner.ts`, its Windows tests, existing Windows runtime/service-entry tests only where needed, and Windows diagnostic reports/helpers that name the production host timeout. No Linux, backend, installer or shared executor implementation changes.

**Evidence and scope:** Native experiment `41282917589` at `3a1efa4` reproduced the host timeout on Server2022/Node22: PowerShell lifetime8,016ms, CPU719ms, Node event-loop max lag13ms, native collection complete at7,949ms, kill at8,016ms before JSON output. Three other first calls completed in5,174–7,748ms of native lifetime. This rules out multi-second Node event-loop/close observation delay for this sample; it does not attribute module/I/O/scheduler/scanner waits. The killed sample is censored, so completion within ten seconds is a candidate to validate, not an established fact. The historical service error remains unattributed.

**Decision:** Permit at most10,000ms for the fixed `host` collector only. Preserve8,000ms for every other Windows collector. Preserve the existing12,000ms Windows tool deadline (including queue/trust/parse),15,000ms service initialization deadline,20,000ms installer doctor deadline and25,000ms backend command deadline. This is a bounded tolerance for observed cold native latency, not a claim that the native wait itself has been optimized or every historical failure resolved.

- [ ] Before implementation, reproduce rejection of a valid host envelope arriving at8,369ms with the current8,000ms runner in a focused regression. Show an ordinary non-host collector still times out at8,000ms.
- [ ] Make the smallest Windows-only host timeout change, exposing its fixed value for diagnostic provenance rather than duplicating stale8,000ms labels. Preserve fixed scripts/arguments/SHA, trusted executable, credential-free environment,1MiB output cap, cancellation, original error retention, and close/stop behavior. No retries, prewarming, configurable timeouts or helper privilege changes.
- [ ] Verify host collection can complete after8,000ms but before10,000ms; that it is killed at10,000ms; and cancellation/output limits still stop it promptly. Check relevant outer tool/startup boundaries with focused tests so extra host time cannot bypass caller cancellation or startup rejection. Do not raise any outer deadline to force a pass.
- [ ] Update diagnostic metadata to use the actual host limit. The existing12-second independent diagnostic watchdog remains unchanged and must still be proven. Retain the failed8-second artifacts and do not relabel historical evidence.
- [ ] Run targeted Windows tests, `npm run validate`, `npm run test:coverage:all`, and `npm run smoke:package`. Native acceptance requires the complete supported collectors/service-host/installer matrices and Ubuntu Node22/24 lifecycle gates at the final source. Also run the opt-in first-call diagnostic once for the changed host bound, retaining any failure. Do not respond to a failure by raising budgets again without a new causal assessment.
- [ ] Independently review the exact change and nested deadline evidence. Describe the outcome as measured bounded headroom with residual native-wait uncertainty; do not close real reboot/Core/Desktop, old unattributed service failure, or combined native-backend/release-artifact gates on that basis.

### Task 3: Execute the generated outer HTTPS wrapper

**Files:** `scripts/windows-tests/generated-command-tests.ps1`, `scripts/windows-tests/generated-command-fixtures.json`, `.github/workflows/windows-installer.yml`; narrowly scoped companion fixture scripts under `scripts/windows-tests/` as needed. No production installer, backend or Linux changes.

**Interfaces:** Preserve the current parser/binding check. Add a disposable hosted test that executes the complete command emitted by the actual pinned control-plane builder. Use loopback HTTPS and an explicitly synthetic downloaded parameter-capture bootstrap, so this qualifies the outer wrapper boundary without claiming real-backend enrollment or a complete native deployment.

- [ ] Regenerate the three fixture commands from the current actual control-plane builder at `3a1b969d5a4782880b615d1f12c38c8dc1f62b6f`; record the source SHA-256 and exact generation inputs. Use `https://localhost:18443/releases`, a synthetic target and one-use-format synthetic token. Do not reimplement or rewrite the generated wrapper inside the fixture.
- [ ] On disposable hosted CI only, create an owned loopback HTTPS server, short-lived self-signed certificate and private scratch directory. Trust only this generated certificate in the Windows root store for the test; remove only its exact thumbprint in `finally`. Fail rather than replace any preexisting resource or listener. Do not alter production TLS or installer trust behavior.
- [ ] Execute the entire initial/repair/replacement commands under native PowerShell 5.1 and the OS `curl.exe`. Compare every bound value against the generated expected fixture, preserving apostrophe-safe literal inputs and `ReplaceCredential` semantics. Capture sensitive test details locally only; publish booleans and bounded provenance.
- [ ] Exercise untrusted TLS before installing the owned root, HTTP download failure, and downloaded bootstrap failure. Each must report failure, never invoke a bootstrap after a failed download, and remove both temporary paths. The three success paths must also remove both paths. Keep an unrelated sentinel file intact.
- [ ] Bound owned server readiness and each child command, wait for owned processes to exit, and clean all owned paths/certificates on failure. Never terminate by image name or delete another fixture's resources. Do not upload raw commands, arguments, stdout or stderr.
- [ ] Reuse the existing short Windows installer verification jobs for Server 2022/2025; avoid an additional full installation matrix just for this PowerShell wrapper boundary. Run focused local validation plus the repository-required validation; record unavailable local PowerShell execution honestly.
- [ ] Inspect hosted results and independently review the task. Update qualification evidence to distinguish complete outer-wrapper execution with a synthetic bootstrap from the existing real package/SCM installation tests and the still-unqualified combined native-agent/real-backend deployment.

## Follow-on work

After Task 1, add a focused repair task with the exact failing regression and
production boundary supported by the evidence. Separately extend the generated
PowerShell wrapper tests through real HTTPS download, invocation and temporary
file cleanup; assess the smallest hosted native-agent/real-backend arrangement.
Keep missing release-artifact or real-reboot evidence explicitly unqualified.

## Validation and handoff

Run affected focused checks, then `npm run validate`, `npm run test:coverage:all`
and `npm run smoke:package` for runtime changes. Native changes require the
supported Windows matrix and the existing Ubuntu Node 22/24 lifecycle gates.
Update the qualification decision with exact source/run identities, retained
historical failures and the boundary of each new result. Keep draft PRs linked.
