# Windows VM support implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and independently review each task in sequence. Steps use checkboxes for tracking.

**Goal:** Add Windows VM support within AgentV while preserving released Linux behavior.

**Architecture:** Keep the Linux adapters, wire schemas, installer, and privileged helper intact. Introduce explicit Windows identities and separate native collector, tool, snapshot, and packaging boundaries. Reuse authenticated transport, scheduling, bounded execution, and target-scoped discovery where contracts already permit it.

**Tech stack:** TypeScript, Node 22/24, PostgreSQL, PowerShell 5.1/CIM, React, native Windows Service hosting.

**Spec:** [Approved compatibility design](../../design-docs/windows-vm-linux-compatibility.md).

Status: approved for implementation by the user on 2026-10-31. All eight planned
source/decision tasks and the single broad review/fix re-review are complete.

Execution status (2026-11-01): AgentV runtime `f86bd5a` is unchanged at hosted
checkpoint `e9e9bbd`; final source fixes are control-plane `3a1b969`, console
`5eabc88`, and API docs `a39eb95`. The broad review's two important Windows
diagnostic-display findings are addressed; the scoped re-review has no open
findings. Final backend hosted CI passes 1,719 tests/255 suites with zero skips.
Task 8's [qualification decision](../../design-docs/windows-qualification-decision.md)
keeps Windows rollout and writes unqualified and disabled. Unexplained native
failures, real reboot/Core/Desktop coverage, the full generated-download lifecycle
and combined native deployment remain gates. Final console CI passes; all four
draft PRs carry coordinated validation and qualification evidence. The wider
Windows program is incomplete; this plan stays active.

## Global constraints

- Work only in `/Users/tjtanjin/Desktop/acornops/tmp/windows-vm-support` feature worktrees on `feat/windows-vm-support`. Never stage sibling repositories or dependency symlinks.
- An existing qualified Linux agent must keep working with the updated backend without an agent upgrade or re-enrollment.
- No Linux payload, tool schema, service allowlist rule, issue identity, installer command, or release coordinate changes merely to accommodate Windows.
- Retain omitted OS metadata as legacy Linux. Validate explicit OS/service-manager pairs, reject unknown explicit values, and preserve the stored pair during every status/settings update. OS is immutable after registration.
- Omitted OS defaults apply to registration/stored metadata. Released handshakes already require `hostFeatures.osFamily` and `hostFeatures.serviceManager`; retain that requirement and allow existing optional helper/restart fields to remain omitted.
- Use a distinct Windows snapshot version, `acornops.agentv-windows-snapshot.v1`. Do not introduce a new mandatory Linux schema discriminator that rejects deployed Linux snapshots.
- Windows read-only support must reject write enrollment and access-policy updates, suppress unexpected advertised writes, and deny write dispatch on the server.
- Keep `AGENTV_SYSTEMD_*`, Linux asset names, and generated Linux shell commands intact. Windows registration is disabled unless Windows rollout is explicitly enabled and a qualified release is configured.
- Windows stopped service alone is not a failure. Incomplete evidence must never resolve service issues. Unavailable load/swap/inode values remain unavailable, not zero.
- Windows service failure evidence requires `state='Stopped'`, a non-disabled start mode, and a numeric `exit_code` other than `0` or `1077` (`ERROR_SERVICE_NEVER_STARTED`). `service_specific_exit_code` is only meaningful when `exit_code=1066`; do not independently classify a stale nonzero service-specific value as failure. Unknown evidence stays unknown.
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

- AgentV `src/windows/{types,runner,scripts,live,mock,service-health}.ts`: native read contracts, bounded fixed-script execution, live decoding, evidence rules and deterministic mock fixtures.
- AgentV `src/windows/tools.ts`: separate read-only tool definitions using the existing registry/executor/result envelope.
- AgentV `src/windows/snapshot.ts`: Windows snapshot derivation and bounded publication. A narrow lifecycle runtime input supplies snapshots, capabilities, host features and log availability; the existing Linux constructor behavior remains the default.
- AgentV `src/windows-runtime.ts`: side-effect-free Windows composition returning an idempotent shutdown callback, shared by standalone Windows and the service bootstrap. Never import the Linux CLI from the native service bootstrap.
- Control plane `src/types/virtual-machine-contracts.ts`, repository and handshake: identity/policy/auth boundaries. New Windows snapshot and interpretation helpers keep native semantics outside Linux branches.
- AgentV `packaging/windows/`, `scripts/*windows*`: SCM host, installer, archive and qualification scripts, isolated from Linux packaging.
- Console existing VM setup/settings/details/log modules: consume backend OS identity and availability; no page redesign.

### Task 1: Pin released Linux compatibility

**Files:** AgentV `src/linux-compatibility.spec.ts`, `src/fixtures/linux-v14-tools.json`; control plane existing tests in `test/services/virtual-machine-install-instructions.test.ts`, `test/repository-virtual-machines.test.ts`, `test/agent-handshake-vm.test.ts`, `test/target-issue-fingerprints.test.ts`, `test/virtual-machine-issue-recovery.test.ts`; provenance in this plan or assessment.

**Interfaces:** Consume released Linux AgentV `v0.0.1-experimental.14` source-equivalent baseline and the frozen catalog at `/private/tmp/acornops-windows-validation/linux-v14-tools.json` (SHA-256 `e06aeb4e125a43ec271888f440b8763ef86ce8a64726454ebbc54b74745ca81c`). Produce fixed behavioral checks for subsequent tasks. No production changes.

- [x] Add exact catalog comparison using the existing registry/router and frozen fixture; preserve all nine descriptors including restart schemas and output envelopes. Check read-only and helper-qualified advertisement using existing lifecycle tests where needed.
- [x] Add only missing characterization checks for omitted OS defaults, exact Linux install command, legacy handshake/snapshot fields, issue fingerprints and incomplete-evidence recovery. Existing adequate tests count; document their locations instead of duplicating them.
- [x] Run focused tests, show that a deliberately perturbed expected fixture fails and restore it, then run AgentV validation and affected control-plane tests. Do not claim TDD for already-correct behavior; this is baseline characterization.
- [x] Self-review, commit tests/provenance with explicit file paths, report existing coverage and any gaps. Runtime files must remain unchanged.

### Task 2: Backend OS identity and read-only security boundaries

**Files:** Control plane `src/types/virtual-machine-contracts.ts`, `src/controllers/workspaces/virtual-machine-controller.ts`, `src/store/repository-virtual-machines.ts`, `src/store/repository-agentv-enrollments.ts`, `src/agent/handshake.ts`, `src/services/agentv-enrollment.ts`, new `src/services/virtual-machine-windows-install-instructions.ts`, configuration and VM dispatch/policy modules reached by those paths; focused tests and matching contract documentation. AgentV counterpart contract docs may be updated, never runtime in this task.

Generated public API counterpart: `docs-website/openapi/control-plane-public.json`, in its own `feat/windows-vm-support` worktree (baseline `a4d0451`). Never export through a sibling symlink into an original checkout. Run docs-website `check`, `validate`, and `links` on the generated change.

**Interfaces:** Stored target identity is `{osFamily:'linux',serviceManager:'systemd'}` or `{osFamily:'windows',serviceManager:'scm'}`. Omitted registration values preserve Linux defaults; explicit mismatched pairs fail. Add `AGENTV_WINDOWS_ENABLED` (default false), `AGENTV_WINDOWS_RELEASE_VERSION`, `AGENTV_WINDOWS_RELEASE_BASE_URL` independent of Linux config. Windows registration requires all three configured correctly. OS metadata is immutable. Enrollment/handshake binds the claimed pair before provisional credential verification. Existing Linux call sites remain valid.

- [x] Write failing tests for legacy omitted defaults; explicit Windows pair; mismatched/unknown values; preserved metadata after status/settings updates; disabled/unqualified rollout; Windows read-write refusal.
- [x] Write an enrollment regression that an authenticated Windows credential claiming Linux (and vice versa) cannot transition pending enrollment to verified or mutate online state. Preserve existing valid legacy Linux provisional behavior.
- [x] Implement minimal OS-aware repository/config/controller and atomic authentication ordering. Do not alter Linux access-policy regex or existing credential transaction semantics.
- [x] Route Windows enrollment/repair to a separate PowerShell instruction builder, never the Linux installer. Use `install-agentv.ps1` under the pinned `v<releaseVersion>` URL with `-ReleaseBaseUrl`, `-PlatformUrl`, `-TargetId`, optional `-EnrollmentToken` and `-ReplaceCredential`. Download to a fresh temporary file, invoke with literal quoted arguments, remove in finally; reject unsafe URL/argument characters and retain HTTPS. Task 5 implements that bootstrap contract.
- [x] Reject Windows writes during access-policy updates, handshake advertisement and actual local/remote dispatch, including a restart tool falsely declared as read. Limit Windows tools to the eight reviewed read names. Windows rollout stays disabled by default; complete telemetry paths in task 4 before enabling it anywhere outside isolated tests.
- [x] Run focused auth/repository/permission tests and full control-plane validation against a dedicated disposable database. Update contracts/OpenAPI as needed, then commit and report before review.

### Task 3: Windows read runtime, mock and live collectors

**Files:** AgentV Windows adapter/tool/snapshot modules listed above, `src/config.ts`, `src/index.ts`, `src/core/lifecycle.ts`, `src/doctor.ts`, focused specs, native collector smoke and additive Windows CI workflow, contract docs mirrored to control-plane.

**Interfaces:** Publish `acornops.agentv-windows-snapshot.v1`, native service fields `name`, `display_name`, `state`, `start_mode`, `process_id`, `exit_code`, `service_specific_exit_code`; host summary includes explicit `os_family:'windows'`, version/build and `system_volume`, common numeric CPU/memory and health. Keep unavailable platform-specific metrics absent/null. Keep outer snapshot collections `host_summary`, `filesystems`, `degraded_services`, `top_processes`, `listeners`, `findings`, `collector_health`, `finding_coverage`, `truncation` with their exact Windows types documented. Windows tool names reuse the eight Linux read names with native input/output schemas; `get_service` uses `name`, logs use `channel` restricted to local Application/System allowlist. No restart tool.

- [x] First write failing tests for OS/config dispatch, no writes, wrong-host rejection in live mode, schema separation and common lifecycle compatibility. The mock selects data by explicit OS, independently of host OS.
- [x] Implement a type-safe lifecycle runtime seam preserving the existing Linux constructor/default behavior; do not cast a Windows adapter to HostAdapter. Keep Linux snapshot manager, HostAdapter and command runner semantics unchanged.
- [x] Expose `startWindowsAgent(config, options)` from `src/windows-runtime.ts` with an idempotent stop handle, and a bounded service-start/stop entry module for task 5. Runtime must not load before the native host START gate, and STOP received during asynchronous startup must be retained. Preserve Linux standalone signals and existing 250ms exit behavior; see [reviewed service host design](../../design-docs/windows-service-host.md).
- [x] Add bounded native scripts through a trusted absolute PowerShell executable, fixed script identifiers and JSON data arguments. Restrict environment, clear preload variables, bound bytes/time/rows/time windows, support cancellation. Test metacharacters, Unicode, permission failures, truncation, invalid JSON and unsupported hosts.
- [x] Implement native host/CPU/memory, volumes, processes, services, listeners and Application/System logs. Test ordinary stopped/never-started (1077)/disabled services as non-failures and stopped process-aborted (1067) as failure; service-specific details apply only to1066. Coverage/health prevents false recovery. Preserve redaction and common tool envelope limits.
- [x] Add a clearly synthetic deterministic Windows mock and fixtures; never label synthetic output as captured native evidence. Add native collector smoke and an additive hosted matrix on `windows-2022`/`windows-2025` with Node 22/24 so native parsing is qualified before task 4 consumes the contract. Capture sanitized native output and runner provenance. Keep existing Ubuntu gates unchanged; task 5 extends this Windows qualification to service packaging.
- [x] Run focused RED/GREEN tests, full AgentV validation/e2e and frozen Linux catalog comparisons; update protocol docs on both sides, commit and report. Archive contents/config defaults for Linux remain compatible.

### Task 4: Backend Windows telemetry, logs and target tool isolation

**Files:** Control plane `src/agent/ws-server.ts`, `src/store/repository-virtual-machines.ts`, `src/services/{target-issue-derivation,virtual-machine-issue-recovery,virtual-machine-metric-history,target-built-in-tool-sync}.ts`, VM log controller and native Windows interpretation helpers; corresponding tests and contracts.

**Interfaces:** Consume the exact task 3 Windows schema/docs. Dispatch by stored OS; validate Windows version and bounded native fields without imposing new requirements on Linux snapshots. Keep Linux issue fingerprints unchanged. Windows system-volume metrics use `host_summary.system_volume`; Windows logs route `channel`, Linux continues `unit`.

Produce an additive authenticated `GET /workspaces/:workspaceId/virtual-machines/registration-options` endpoint for users with `manage_targets`, before the `/:vmId` route. Return `{platforms:[{osFamily:'linux',serviceManager:'systemd',accessModes:['read_only','read_write']}, ...]}`; include `{osFamily:'windows',serviceManager:'scm',accessModes:['read_only']}` only when Windows is enabled with valid release coordinates. Do not expose release URLs/tokens or change the existing list response. Console task 6 consumes these options; existing clients need no new request.

- [x] Write failing tests for Windows snapshots/inventory/metrics/log routing, wrong-OS snapshot rejection, exact legacy Linux behavior, non-C system volume, partial/denied collection and unknown fields.
- [x] Implement isolated Windows interpretation. Define stable Windows issue fingerprints using native service names; stop-state alone produces no issue. Only sufficient successful evidence clears findings.
- [x] Confirm Windows built-in definitions contain read-only tools and schemas stay scoped to the target. Add mixed Linux/Windows same-name catalog tests through actual sync/dispatch entry points, including unexpected writes and target switches.
- [x] Add registration-options response and authorization tests for Linux-only default, explicitly enabled Windows, denied target-management permission and no configuration secret exposure. Update OpenAPI source and generated docs feature counterpart.
- [x] Run focused tests, canonical control-plane validation with disposable DB and cross-repo contract checks; update docs and commit. Review before adding user-facing Windows onboarding.

### Task 5: Windows Service packaging and native qualification

**Files:** AgentV `packaging/windows/`, `scripts/install-agentv.ps1`, `scripts/build-windows-archive.ps1`, `scripts/windows-smoke.ps1`, narrow `src/windows-service-entry.ts` readiness wiring and focused tests, Windows installer/host tests, `.github/workflows/ci.yml` or a separate Windows workflow, operational/development docs. Control-plane Windows install-instruction builder and enrollment tests. A guarded optional callback in `src/core/lifecycle.ts` may report validated provisional authentication only when `runtime.kind === 'windows'`; preserve the existing Linux return/reconnect behavior and cover it with characterization tests. A verified integration defect also permits a focused fix in `src/windows/snapshot.ts` and its specs: serialize valid health metadata without changing shared/Linux redaction.

**Interfaces:** Separate Windows release asset and `install-agentv.ps1`, implementing the exact task 2 instruction arguments; control-plane instructions use independent task 2 release settings. Reuse exchange/verify/commit enrollment protocol with target OS binding. Keep existing Linux install command byte-for-byte stable. Explicit read-only Windows config under ProgramData, dedicated low-privilege service identity, actual SCM host.

Provisional authentication remains distinct from active authentication: it must not enable policy, snapshots, heartbeats or router readiness. Its protected marker is bound to the current launch and configuration, clears on disconnect, and supplements the backend's verified transaction status before commit. Active readiness still requires a fresh active-authentication marker and backend confirmation.

- [x] Record and independently review the native service-host choice, including SCM recovery, observed whole-job teardown and runtime shutdown seam. Selected repository-owned .NET4.8 host; see [reviewed service host design](../../design-docs/windows-service-host.md). Implementation and hosted native evidence are complete at `2a69373`; reboot remains separate.
- [x] Independently review installer recovery ordering, ambiguous backend outcomes and queued SCM restart ownership; see [Windows installer recovery design](../../design-docs/windows-installer-recovery.md). Hosted interruption qualification passes at `2a69373`.
- [x] Implement and qualify the native service host, unique SID permissions, bounded logs, private start gate and process-tree teardown in hosted CI first. Use an intermediate feature-branch checkpoint; only proceed with transactional installer cutover after that native host gate passes.
- [x] Repair and test Windows snapshot health metadata after redaction, then replay actual produced snapshots into the backend's strict Windows schema and authenticated ingress. Keep the global redactor and Linux payloads unchanged; this producer/consumer check supplements native collector qualification.
- [x] Write installer state/failure tests covering new install, repair, credential replacement, interrupted exchange/verification/commit, lost commit response, upgrade, cleanup and uninstall. Never restore a revoked credential and claim rollback. Configuration deletion/revocation is explicit, not implicit uninstall behavior. Repair includes no-token reinstall after uninstall when retained owner, config and immutable release selection remain trusted; reject conflicting services/tasks or ambiguous ownership and prove fresh authenticated readiness without changing the credential.
- [x] Implement checksummed package/build/bootstrap, trusted paths and ACLs, sanitized service environment, graceful process tree stop and crash recovery. Scripts accept arguments as data, avoid command interpolation, and do not log credentials. Provide an explicit manual `-AcceptCommittedCandidate` recovery path for rollback-denied state, gated on the exact transaction remaining completed/active plus fresh launch/config-bound local readiness and remote confirmation; automatic recovery stays conservative, with no historical credential fallback.
- [x] Add CI on `windows-2022` and `windows-2025` with Node 22/24, plus native collector and disposable SCM install/recovery tests. Retain Ubuntu systemd release gates unchanged. Reboot qualification is separate from service restart.
- [x] Test generated PowerShell installation instructions and byte-frozen Linux command; run native jobs on the feature branch if authenticated CI is available. Record gaps explicitly and keep rollout disabled without qualified artifact evidence. Commit reviewed packaging changes.

### Task 6: OS-aware VM console

**Files:** Console VM types/API, setup hook/form, access selector, VM settings/details/metrics/log components and their existing tests; API mirrors and documentation.

**Interfaces:** Consume backend OS pair and task 4 registration-options availability; Linux default stays unchanged. Windows is read-only, uses Application/System channels and PowerShell install instructions. Show unavailable Linux-only metrics accurately. Server remains authority for feature/release gating.

- [x] Write failing tests for Linux default/unchanged install and allowlist validation, explicit Windows selection/read-only policy, OS-immutable settings, Windows log channel filters and absent metrics.
- [x] Implement small changes in existing VM components; preserve layout and Linux copy/validation. Do not expose mock/collector implementation settings in production UI.
- [x] Run affected UI tests, full console validation, contract checks and browser flow checks in control-plane mode. Commit and report any unavailable backend/native test dependency.

### Task 7: Mixed-version qualification and final review

**Files:** Integration/CI tests in affected feature repos; focused Windows mock filter fixes in AgentV `src/windows/mock.ts` and tests; AgentV `src/config.ts` and tests for Windows-only setting isolation; control-plane catalog output-schema assertions and `src/agent/offline-reconciliation.ts` with focused connection-lifecycle tests; compatibility evidence in this plan/assessment, operations/release documentation and workspace change set.

**Interfaces:** Released Linux experimental.14 → updated backend; updated Linux → updated backend; Windows mock/live → updated backend; concurrent targets in one workspace. Preserve exact target scoping through gateway and execution engine.

- [x] Integrate pinned current upstream into the feature branches before final compatibility validation: control-plane `7b38c5f` and docs-website `1afbed2`, following console `54f7e12`. Preserve both upstream and Windows contracts, review overlapping tool-schema changes, apply upstream migrations only to disposable test databases, and keep original checkouts unchanged. These are base updates, not new Windows migrations.
- [x] Resolve deferred qualification findings: make synthetic Windows service-state, listener-protocol and process-query filters match the published native contract; assert target-specific output schemas during control-plane target switches and through actual gateway integration. Keep fixes isolated to those contracts.
- [x] Preserve Linux ignoring Windows-only `ACORNOPS_VM_ALLOWED_LOG_CHANNELS`: a released Linux process accepts an otherwise valid configuration containing `Security`, while the new unconditional Windows channel parser rejects it. Restrict Windows channel parsing/validation to Windows configuration and add a failing Linux characterization plus Windows rejection tests before the fix. Preserve Linux unit validation and Windows Application/System restrictions.
- [x] Correct the pre-existing Kubernetes-only disconnect reconciliation in a separate scoped commit: update VM status and event identity through the VM boundary, retain Linux/Windows OS metadata, and preserve existing Kubernetes behavior. Characterize released Linux disconnect/reconnect, stale-socket replacement and owner/draining races before changing the handler; a departing connection must never mark its replacement offline.
- [x] Exercise old-agent/new-backend enrollment, reconnect, snapshots, log reads and approved Linux restart handling; replay legacy optional-field omissions and bad Windows claims. Use disposable services, never existing databases or VMs.
- [x] Run complete affected-repo validation, Linux package/bootstrap/curl and real Ubuntu systemd CI, Windows CI and mixed-target integration. Test only justified changes after prior passing runs; collect exact commands/results and inspect every failure.
- [x] Complete independent Task 7 review and fix re-review; record unexecuted native/reboot/real-host criteria in the qualification decision without claiming zero-regression proof.
- [x] Collect hosted backend CI [41246730821](https://github.com/acornops/control-plane/actions/runs/41246730821) at the Task 7 checkpoint and [41249382697](https://github.com/acornops/control-plane/actions/runs/41249382697) after the final review fix; both pass.
- [x] Run the single broad review after Task 8; fix important findings with targeted regression checks and independently re-review fixes before handoff.
- [x] Finalize linked docs/change set, task status and coordinated draft PR handoff after broad review and final source CI. Preserve the exact tested checkpoint when making evidence-only documentation updates. Retain disabled Windows rollout until native qualification. Do not merge/release/deploy.

### Task 8: Windows writes qualification gate

**Files:** Follow-on native-action design under `docs/design-docs/` and tracked execution plan; no Linux helper rewrites.

**Interfaces:** Only begin Windows restart implementation after task 7 read-only qualification evidence passes. Define exact service allowlist/protected service policy, native low-privilege boundary, ACL-separated helper, durable idempotency receipts, state preconditions, cancellation/uncertain outcomes and post-action verification before enabling it.

- [x] At completion of Task 7 source/integration work, evaluate native qualification evidence and residual blockers in the [qualification decision](../../design-docs/windows-qualification-decision.md). Final hosted CI and broad review remain separate handoff gates.
- [x] **Not qualified:** keep Windows writes denied and record concrete unmet gates. No native-action implementation is authorized by this decision. A future qualified stage requires a focused, independently reviewed native-action design and implementation plan before implementation/testing. The wider Windows program remains incomplete.

## Rollout and rollback

Backend first, with Windows disabled. Linux agents need no upgrade. Windows activation requires independent pinned qualified artifacts and native evidence; feature-off retains OS metadata on the compatible backend. An old Linux-only backend is not a safe rollback after Windows targets exist. No deployment is authorized by these implementation tasks.

## Completion evidence

Source implementation tasks 1–7 and the task 8 read-only qualification decision
are complete. Windows rollout remains **unqualified and disabled**. The
[qualification decision](../../design-docs/windows-qualification-decision.md)
is the authoritative record of final matrices, failed native samples, reviewed
fixes, synthetic/native boundaries and unmet production gates. It supersedes the
intermediate “pending” statements in the
[original task ledger](https://github.com/acornops/agentv/blob/b7f71b777b47e397c8093b0255e1b97643a6498a/docs/exec-plans/active/windows-vm-implementation.md#completion-evidence).

| Task | Checkpoint and scope |
| --- | --- |
| 1: Linux baseline | AgentV `984ad70`, backend `05de831`: frozen released catalog/provenance; deliberate perturbation failed before restoration. |
| 2: Backend identity | `3985774`, `385339a`; mirrors `99a7852`, `4e944d6`: immutable OS, default-off read policy; quote injection and deleted-target dispatch findings fixed. 1,549 backend tests passed. |
| 3: Windows runtime | `754afa8` through `b468f7b`, tested merge `52cff0b3`: isolated collectors/mock; fixed module-qualified lookup removed an observed 23–29 second lookup delay. Later unrelated cold-call failures remain open. |
| 4: Telemetry | Backend `d0fbcac`, docs `c10e5f9`, console `b4337a7`: ingestion, inventory/issues/metrics/logs and backend platform availability. 1,583 backend and 1,240 console tests passed. |
| 5: Native packaging | Host `d03bfbc`, checkpoint `f10e138`, installer `25063fb`/merge `e6508339`, recovery `d7d2f4d`, final `2a69373`/merge `2a9adb0a`: source-reviewed transactional installer. Concurrent fresh ownership, watcher/stop race and retained-config SID lookup received native RED/GREEN checks. |
| 6: Console | `6c77dbc` including main `54f7e12`: backend-gated OS selection, Windows read-only policy and channel-scoped logs; 1,266 tests and hosted browsers passed. Populated log/race/409 cases used intercepted fixtures. |
| 7: Integration | Snapshot aggregation correction `5bce18b`; AgentV `f86bd5ab7040c9372f6160383ef7620091f821ea`, backend `37c62d69f8aae157480a0502142bc662ee8bd816`, docs `4586d5e`. Three released/updated Linux/Windows processes passed scoped reads, reconnects, registry/schema isolation and Linux approvals through actual transport. Host observations/actions were synthetic. |
| 8: Qualification | The linked decision retains timing, service identity, composition, reboot and deployment gaps. No native Windows writes are implemented. |

Intermediate native checkpoints remain available below. These historical samples
are not acceptance evidence for later source revisions.

| Checkpoint | Hosted evidence |
| --- | --- |
| Linux before runtime, `32da905` | [41209224807](https://github.com/acornops/agentv/actions/runs/41209224807): Ubuntu systemd lifecycle on Node 22/24 passed. |
| Runtime `b468f7b` | [Collectors 41217103762](https://github.com/acornops/agentv/actions/runs/41217103762), [Linux 41217103832](https://github.com/acornops/agentv/actions/runs/41217103832): four Windows cells and Linux lifecycle passed. |
| Host prerequisite `d03bfbc` | [Host 41221285754](https://github.com/acornops/agentv/actions/runs/41221285754), [Linux 41221285808](https://github.com/acornops/agentv/actions/runs/41221285808): 33 host checks/cell and Linux gates passed. |
| Initial installer `25063fb` | [41231100923](https://github.com/acornops/agentv/actions/runs/41231100923): 12 checks/cell; later interruption coverage was still pending at this checkpoint. |
| Recovery `d7d2f4d` | [Linux 41234585924](https://github.com/acornops/agentv/actions/runs/41234585924), [host 41234585870](https://github.com/acornops/agentv/actions/runs/41234585870) passed; [collectors 41234585971](https://github.com/acornops/agentv/actions/runs/41234585971) failed both Server 2022 cells, with a later 8.37-second diagnostic sample. |
| Installer source completion `2a69373` | [Installer 41239335850](https://github.com/acornops/agentv/actions/runs/41239335850): two short gates and 16 scenario cells passed (lifecycle 23, recovery 21, startup 9, acceptance 21 checks per OS/Node pair). [Host 41239335845](https://github.com/acornops/agentv/actions/runs/41239335845) and [Linux 41239335838](https://github.com/acornops/agentv/actions/runs/41239335838) passed. |
| Console source completion `6c77dbc` | [41242199107](https://github.com/acornops/management-console/actions/runs/41242199107): preflight and eight browser jobs passed. |

Final implementation-stage source, native failure history, all final hosted run
IDs and collection-health fixes are retained once in the qualification decision.
The original two Linux mock schema failures were subsequently fixed by
[the deterministic follow-up](../completed/windows-confident-gap-fixes.md);
the earlier failing observations are not relabeled. Shared heartbeat reporting is
recorded in the backend/console plans; durable outage-status repair is separate.

All coordinated PRs remain drafts on feature branches. No merge, release or
activation has occurred. Hosted CI was selected by the user; real reboot,
Core/Desktop Experience and combined native/backend qualification remain open.
