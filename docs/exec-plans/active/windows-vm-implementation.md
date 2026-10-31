# Windows VM support implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and independently review each task in sequence. Steps use checkboxes for tracking.

**Goal:** Add Windows VM support within AgentV while preserving released Linux behavior.

**Architecture:** Keep the Linux adapters, wire schemas, installer, and privileged helper intact. Introduce explicit Windows identities and separate native collector, tool, snapshot, and packaging boundaries. Reuse authenticated transport, scheduling, bounded execution, and target-scoped discovery where contracts already permit it.

**Tech stack:** TypeScript, Node 22/24, PostgreSQL, PowerShell 5.1/CIM, React, native Windows Service hosting.

**Spec:** [Approved compatibility design](../../design-docs/windows-vm-linux-compatibility.md).

Status: approved for implementation by the user on 2026-10-31. Work in progress.

## Global constraints

- Work only in `/Users/tjtanjin/Desktop/acornops/tmp/windows-vm-support` feature worktrees on `feat/windows-vm-support`. Never stage sibling repositories or dependency symlinks.
- An existing qualified Linux agent must keep working with the updated backend without an agent upgrade or re-enrollment.
- No Linux payload, tool schema, service allowlist rule, issue identity, installer command, or release coordinate changes merely to accommodate Windows.
- Retain omitted OS metadata as legacy Linux. Validate explicit OS/service-manager pairs, reject unknown explicit values, and preserve the stored pair during every status/settings update. OS is immutable after registration.
- Use a distinct Windows snapshot version, `acornops.agentv-windows-snapshot.v1`. Do not introduce a new mandatory Linux schema discriminator that rejects deployed Linux snapshots.
- Windows read-only support must reject write enrollment and access-policy updates, suppress unexpected advertised writes, and deny write dispatch on the server.
- Keep `AGENTV_SYSTEMD_*`, Linux asset names, and generated Linux shell commands intact. Windows registration is disabled unless Windows rollout is explicitly enabled and a qualified release is configured.
- Windows stopped service alone is not a failure. Incomplete evidence must never resolve service issues. Unavailable load/swap/inode values remain unavailable, not zero.
- No arbitrary shell/PowerShell execution, WinRM, VM provisioning, package mutation tools, or registry/AD management.
- Mocks never qualify native permissions, service hosting, reboot, or package recovery. No release tags, merges, production changes, or activation during implementation.

## Review focus

- Legacy agents omit optional fields: Linux authentication, defaults and snapshot ingestion still work (tasks 1, 2, 7).
- Credential verification can mutate enrollment state: an OS mismatch must fail before verification or online-state changes (task 2).
- An authenticated but buggy Windows agent advertises Linux/write tools: target policy blocks them at discovery and dispatch (tasks 2, 4).
- Permission denial, truncated enumeration, and ordinary stopped services: diagnostics show uncertainty without false failure or recovery (tasks 3, 4).
- Installer interrupted around credential commit, paths with spaces/non-ASCII, lost responses: durable state and service identity remain recoverable (tasks 5, 7).

## File boundaries and shared interfaces

Existing Linux modules retain ownership of Linux semantics. Add Windows modules alongside them, rather than converting Linux types to optional-field bags.

- AgentV `src/adapters/windows/{types,runner,scripts,live-host,mock-host}.ts`: native read contracts, bounded fixed-script execution, live decoding and deterministic mock fixtures.
- AgentV `src/tools/windows.ts`: separate read-only tool definitions using the existing registry/executor/result envelope.
- AgentV `src/core/windows-snapshot-manager.ts`: Windows snapshot derivation and bounded publication. A narrow lifecycle runtime input supplies snapshots, capabilities, host features and log availability; the existing Linux constructor behavior remains the default.
- Control plane `src/types/virtual-machine-contracts.ts`, repository and handshake: identity/policy/auth boundaries. New Windows snapshot and interpretation helpers keep native semantics outside Linux branches.
- AgentV `packaging/windows/`, `scripts/*windows*`: SCM host, installer, archive and qualification scripts, isolated from Linux packaging.
- Console existing VM setup/settings/details/log modules: consume backend OS identity and availability; no page redesign.

### Task 1: Pin released Linux compatibility

**Files:** AgentV `src/linux-compatibility.spec.ts`, `src/fixtures/linux-v14-tools.json`; control plane existing tests in `test/services/virtual-machine-install-instructions.test.ts`, `test/repository-virtual-machines.test.ts`, `test/agent-handshake-vm.test.ts`, `test/target-issue-fingerprints.test.ts`, `test/virtual-machine-issue-recovery.test.ts`; provenance in this plan or assessment.

**Interfaces:** Consume released Linux AgentV `v0.0.1-experimental.14` source-equivalent baseline and the frozen catalog at `/private/tmp/acornops-windows-validation/linux-v14-tools.json` (SHA-256 `e06aeb4e125a43ec271888f440b8763ef86ce8a64726454ebbc54b74745ca81c`). Produce fixed behavioral checks for subsequent tasks. No production changes.

- [ ] Add exact catalog comparison using the existing registry/router and frozen fixture; preserve all nine descriptors including restart schemas and output envelopes. Check read-only and helper-qualified advertisement using existing lifecycle tests where needed.
- [ ] Add only missing characterization checks for omitted OS defaults, exact Linux install command, legacy handshake/snapshot fields, issue fingerprints and incomplete-evidence recovery. Existing adequate tests count; document their locations instead of duplicating them.
- [ ] Run focused tests, show that a deliberately perturbed expected fixture fails and restore it, then run AgentV validation and affected control-plane tests. Do not claim TDD for already-correct behavior; this is baseline characterization.
- [ ] Self-review, commit tests/provenance with explicit file paths, report existing coverage and any gaps. Runtime files must remain unchanged.

### Task 2: Backend OS identity and read-only security boundaries

**Files:** Control plane `src/types/virtual-machine-contracts.ts`, `src/controllers/workspaces/virtual-machine-controller.ts`, `src/store/repository-virtual-machines.ts`, `src/store/repository-agentv-enrollments.ts`, `src/agent/handshake.ts`, `src/services/agentv-enrollment.ts`, configuration and VM dispatch/policy modules reached by those paths; focused tests and matching contract documentation. AgentV counterpart contract docs may be updated, never runtime in this task.

**Interfaces:** Stored target identity is `{osFamily:'linux',serviceManager:'systemd'}` or `{osFamily:'windows',serviceManager:'scm'}`. Omitted registration values preserve Linux defaults; explicit mismatched pairs fail. Add `AGENTV_WINDOWS_ENABLED` (default false), `AGENTV_WINDOWS_RELEASE_VERSION`, `AGENTV_WINDOWS_RELEASE_BASE_URL` independent of Linux config. Windows registration requires all three configured correctly. OS metadata is immutable. Enrollment/handshake binds the claimed pair before provisional credential verification. Existing Linux call sites remain valid.

- [ ] Write failing tests for legacy omitted defaults; explicit Windows pair; mismatched/unknown values; preserved metadata after status/settings updates; disabled/unqualified rollout; Windows read-write refusal.
- [ ] Write an enrollment regression that an authenticated Windows credential claiming Linux (and vice versa) cannot transition pending enrollment to verified or mutate online state. Preserve existing valid legacy Linux provisional behavior.
- [ ] Implement minimal OS-aware repository/config/controller and atomic authentication ordering. Do not alter Linux access-policy regex or existing credential transaction semantics.
- [ ] Reject Windows writes during access-policy updates, handshake advertisement and actual dispatch, including maliciously advertised write capabilities. Keep Windows read paths disabled until task 4 establishes contracts.
- [ ] Run focused auth/repository/permission tests and full control-plane validation against a dedicated disposable database. Update contracts/OpenAPI as needed, then commit and report before review.

### Task 3: Windows read runtime, mock and live collectors

**Files:** AgentV Windows adapter/tool/snapshot modules listed above, `src/config.ts`, `src/index.ts`, `src/core/lifecycle.ts`, `src/doctor.ts`, focused specs, contract docs mirrored to control-plane.

**Interfaces:** Publish `acornops.agentv-windows-snapshot.v1`, native service fields `name`, `display_name`, `state`, `start_mode`, `process_id`, `exit_code`, `service_specific_exit_code`; host summary includes explicit `os_family:'windows'`, version/build and `system_volume`, common numeric CPU/memory and health. Keep unavailable platform-specific metrics absent/null. Keep outer snapshot collections `host_summary`, `filesystems`, `degraded_services`, `top_processes`, `listeners`, `findings`, `collector_health`, `finding_coverage`, `truncation` with their exact Windows types documented. Windows tool names reuse the eight Linux read names with native input/output schemas; `get_service` uses `name`, logs use `channel` restricted to local Application/System allowlist. No restart tool.

- [ ] First write failing tests for OS/config dispatch, no writes, wrong-host rejection in live mode, schema separation and common lifecycle compatibility. The mock selects data by explicit OS, independently of host OS.
- [ ] Implement a type-safe lifecycle runtime seam preserving the existing Linux constructor/default behavior; do not cast a Windows adapter to HostAdapter. Keep Linux snapshot manager, HostAdapter and command runner semantics unchanged.
- [ ] Add bounded native scripts through a trusted absolute PowerShell executable, fixed script identifiers and JSON data arguments. Restrict environment, clear preload variables, bound bytes/time/rows/time windows, support cancellation. Test metacharacters, Unicode, permission failures, truncation, invalid JSON and unsupported hosts.
- [ ] Implement native host/CPU/memory, volumes, processes, services, listeners and Application/System logs. Stopped services with no failure evidence are healthy; coverage/health prevents false recovery. Preserve redaction and common tool envelope limits.
- [ ] Add a clearly synthetic deterministic Windows mock and fixtures; never label synthetic output as captured native evidence. Add native collector smoke suitable for Windows CI.
- [ ] Run focused RED/GREEN tests, full AgentV validation/e2e and frozen Linux catalog comparisons; update protocol docs on both sides, commit and report. Archive contents/config defaults for Linux remain compatible.

### Task 4: Backend Windows telemetry, logs and target tool isolation

**Files:** Control plane `src/agent/ws-server.ts`, `src/store/repository-virtual-machines.ts`, `src/services/{target-issue-derivation,virtual-machine-issue-recovery,virtual-machine-metric-history,target-built-in-tool-sync}.ts`, VM log controller and native Windows interpretation helpers; corresponding tests and contracts.

**Interfaces:** Consume the exact task 3 Windows schema/docs. Dispatch by stored OS; validate Windows version and bounded native fields without imposing new requirements on Linux snapshots. Keep Linux issue fingerprints unchanged. Windows system-volume metrics use `host_summary.system_volume`; Windows logs route `channel`, Linux continues `unit`.

- [ ] Write failing tests for Windows snapshots/inventory/metrics/log routing, wrong-OS snapshot rejection, exact legacy Linux behavior, non-C system volume, partial/denied collection and unknown fields.
- [ ] Implement isolated Windows interpretation. Define stable Windows issue fingerprints using native service names; stop-state alone produces no issue. Only sufficient successful evidence clears findings.
- [ ] Confirm Windows built-in definitions contain read-only tools and schemas stay scoped to the target. Add mixed Linux/Windows same-name catalog tests through actual sync/dispatch entry points, including unexpected writes and target switches.
- [ ] Run focused tests, canonical control-plane validation with disposable DB and cross-repo contract checks; update docs and commit. Review before adding user-facing Windows onboarding.

### Task 5: Windows Service packaging and native qualification

**Files:** AgentV `packaging/windows/`, `scripts/build-windows-archive.ps1`, `scripts/windows-smoke.ps1`, Windows installer/host focused tests, `.github/workflows/ci.yml` or a separate Windows workflow, operational/development docs. Control-plane Windows install-instruction builder and enrollment tests.

**Interfaces:** Separate Windows release asset and `install-agentv.ps1`; control-plane instructions use independent task 2 release settings. Reuse exchange/verify/commit enrollment protocol with target OS binding. Keep existing Linux install command byte-for-byte stable. Explicit read-only Windows config under ProgramData, dedicated low-privilege service identity, actual SCM host.

- [ ] Record a focused native service-host choice comparing a pinned reviewed wrapper with a minimal native host. Resolve provenance, child process stop/crash behavior, bounded logs, supported runtime and ACL requirements before implementation; obtain independent technical review, not repeated user approval.
- [ ] Write installer state/failure tests covering new install, repair, credential replacement, interrupted exchange/verification/commit, lost commit response, upgrade, cleanup and uninstall. Never restore a revoked credential and claim rollback. Configuration deletion/revocation is explicit, not implicit uninstall behavior.
- [ ] Implement checksummed package/build/bootstrap, trusted paths and ACLs, sanitized service environment, graceful process tree stop and crash recovery. Scripts accept arguments as data, avoid command interpolation, and do not log credentials.
- [ ] Add CI on `windows-2022` and `windows-2025` with Node 22/24, plus native collector and disposable SCM install/recovery tests. Retain Ubuntu systemd release gates unchanged. Reboot qualification is separate from service restart.
- [ ] Test generated PowerShell installation instructions and byte-frozen Linux command; run native jobs on the feature branch if authenticated CI is available. Record gaps explicitly and keep rollout disabled without qualified artifact evidence. Commit reviewed packaging changes.

### Task 6: OS-aware VM console

**Files:** Console VM types/API, setup hook/form, access selector, VM settings/details/metrics/log components and their existing tests; API mirrors and documentation.

**Interfaces:** Consume backend OS pair and Windows availability; Linux default stays unchanged. Windows is read-only, uses Application/System channels and PowerShell install instructions. Show unavailable Linux-only metrics accurately. Server remains authority for feature/release gating.

- [ ] Write failing tests for Linux default/unchanged install and allowlist validation, explicit Windows selection/read-only policy, OS-immutable settings, Windows log channel filters and absent metrics.
- [ ] Implement small changes in existing VM components; preserve layout and Linux copy/validation. Do not expose mock/collector implementation settings in production UI.
- [ ] Run affected UI tests, full console validation, contract checks and browser flow checks in control-plane mode. Commit and report any unavailable backend/native test dependency.

### Task 7: Mixed-version qualification and final review

**Files:** Integration/CI tests in affected feature repos, compatibility evidence in this plan/assessment, operations/release documentation and workspace change set.

**Interfaces:** Released Linux experimental.14 → updated backend; updated Linux → updated backend; Windows mock/live → updated backend; concurrent targets in one workspace. Preserve exact target scoping through gateway and execution engine.

- [ ] Exercise old-agent/new-backend enrollment, reconnect, snapshots, log reads and approved Linux restart handling; replay legacy optional-field omissions and bad Windows claims. Use disposable services, never existing databases or VMs.
- [ ] Run complete affected-repo validation, Linux package/bootstrap/curl and real Ubuntu systemd CI, Windows CI and mixed-target integration. Test only justified changes after prior passing runs; collect exact commands/results and inspect every failure.
- [ ] Request independent whole-branch review; fix important findings with targeted regression checks and re-review fixes. Record all unexecuted native/reboot/real-host acceptance criteria without claiming zero-regression proof.
- [ ] Update linked docs/change set and task status. Prepare coordinated draft PRs on the feature branches if remote publishing is available; retain disabled Windows rollout until native qualification. Do not merge/release/deploy.

### Task 8: Windows writes qualification gate

**Files:** Follow-on native-action design under `docs/design-docs/` and tracked execution plan; no Linux helper rewrites.

**Interfaces:** Only begin Windows restart implementation after task 7 read-only qualification evidence passes. Define exact service allowlist/protected service policy, native low-privilege boundary, ACL-separated helper, durable idempotency receipts, state preconditions, cancellation/uncertain outcomes and post-action verification before enabling it.

- [ ] At completion of task 7, evaluate and document native qualification evidence and residual blockers.
- [ ] If qualified, create and independently review a focused native-action design and implementation plan, then implement and test it on Windows feature branches. If not qualified, keep Windows writes denied and record the concrete unmet gates; never call the entire Windows program complete.

## Rollout and rollback

Backend first, with Windows disabled. Linux agents need no upgrade. Windows activation requires independent pinned qualified artifacts and native evidence; feature-off retains OS metadata on the compatible backend. An old Linux-only backend is not a safe rollback after Windows targets exist. No deployment is authorized by these implementation tasks.

## Completion evidence

Pending implementation. Baselines and environment-specific failures are recorded in [assessment](windows-vm-assessment.md). Per-task reports and reviewer evidence are kept in the local ignored plan workspace; durable conclusions are copied here before handoff.
