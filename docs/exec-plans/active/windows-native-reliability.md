# Windows native reliability follow-up

> **For agentic workers:** Use superpowers:subagent-driven-development for implementation and independent task review. Steps use checkboxes.

**Goal:** Resolve the outstanding Windows reliability and hosted installation gaps with minimal changes while preserving Linux behavior.

**Architecture:** Keep the existing isolated Windows runtime and package. Diagnose the failing native boundary before selecting a production fix. Extend the existing disposable hosted fixtures for installation coverage; preserve authenticated transport and credential transactions.

**Tech stack:** Node 22/24, Windows Server 2022/2025 x64, PowerShell 5.1, Windows Performance Recorder, existing TypeScript backend.

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

- [ ] Read the saved cold-start investigation and failing artifacts. Document one concrete hypothesis and the smallest observation that distinguishes it; validate available native tooling from primary documentation.
- [ ] Add opt-in hosted diagnostic capture using installed Windows tooling. Prefer an isolated WPR memory trace capped at 64 MiB, with target-process scheduling/module categories and process CPU versus wall time. Keep raw traces local and remove them after producing a report capped at 64 KiB. If a reliable narrow summarizer is unavailable, report that limitation and propose the next smallest observation instead of building a generic profiling framework.
- [ ] Bound first-call capture independently of the production collector. Use a 12-second diagnostic watchdog for the standalone first call; recorder start/stop each have a five-second bound. Do not affect the ordinary non-diagnostic CI path. An optional warm control is limited to one call with the same production bound and is labeled comparison evidence.
- [ ] Ensure contained service-identity failures preserve the failing operation/code/stage/timeline before cleanup. Reuse existing diagnostics where sufficient; add tracing only at a specifically identified missing boundary.
- [ ] Exercise redaction, bounded output and failure/cleanup behavior with focused meaningful tests. Run normal AgentV validation once before the review checkpoint. Keep diagnostic source and any later production repair in separate commits.
- [ ] Run one explicitly identified diagnostic matrix on Server 2022/2025 and Node 22/24, inspect every failure and preserve provenance. Do not repeatedly dispatch unchanged experiments merely to obtain a pass.
- [ ] Independently review the diagnostic change and record the causal conclusion or remaining uncertainty. Specify any production repair as the next bounded task before implementing it.

### Task 2: Execute the generated outer HTTPS wrapper

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
