# Windows VM support with Linux compatibility

Status: proposed design, awaiting review and implementation approval.
Date: 2026-10-31.

## Intent and acceptance requirement

Add Windows Server VM support to AgentV while preserving existing Linux VM
behavior. The user requires feature branches, a thorough assessment, small
reviewable changes, and comprehensive evaluation before and during implementation.

Linux compatibility is a release requirement, not an assumption inferred from
passing Windows mocks. An existing qualified Linux agent must keep working with
the updated backend without an agent upgrade or re-enrollment. No Linux payload,
tool schema, service allowlist rule, issue identity, installer command, or release
coordinate changes merely to accommodate Windows. A known Linux regression blocks
the affected phase and release. Tests cannot prove the absence of every possible
regression; unexecuted qualification is reported explicitly.

## Approaches considered

1. **Add OS-specific adapters inside AgentV; retain the Linux contracts.**
   Recommended. Reuse authentication, bounded transport, scheduling, MCP result
   envelopes, redaction, and policy enforcement. Add separate Windows collector,
   tool, snapshot, installation, and eventual action boundaries. This leaves a
   small amount of deliberate OS-specific duplication and limits Linux risk.
2. **Immediately replace Linux and Windows contracts with one generic schema.**
   Rejected for this change. Renaming service fields, collector health identities,
   tool arguments, or restart receipts would require migrating existing agents
   and increase the regression surface without delivering additional Windows
   functionality.
3. **Create a separate Windows agent repository.**
   Not recommended. The shared backend still needs Windows support, while
   authentication, transport, policy, and security fixes would need maintaining
   in two agents. Separate packages provide OS isolation without a repository fork.

The proposal follows the same-AgentV direction discussed with the user. The
phase-one Windows scope and qualification targets below are recommendations, not
previously agreed product requirements.

## Scope and phases

Start qualification with Windows Server 2022 and 2025, x64, Node 22 and 24.
Both Server Core and Desktop Experience are intended targets; tests on hosted
CI images alone do not establish coverage for both installation options.

The first deliverable is Windows read-only support: enrollment, host/CPU/memory,
volumes, processes, services, listening sockets, bounded Application/System event
logs, telemetry, existing VM pages, and target-scoped diagnostic chat. Provide a
Windows Service installation with repair, credential replacement, recovery,
upgrade, and uninstall behavior covered by tests.

Windows service restarts are a subsequent gated deliverable. They require a
separate native permission/helper design and real Windows validation. Linux
restarts remain available under the existing exact allowlist and approval model.
The overall Windows task is not called complete merely because a mock or the
read-only phase is complete.

Out of scope: VM provisioning, Hyper-V management, Windows containers, Windows
desktop support claims, remote WinRM, arbitrary PowerShell execution, package
installation tools, registry mutation, Active Directory management, and Linux
packaging cleanup.

## Current implementation and compatibility traps

- `src/config.ts` rejects non-Linux/systemd configurations.
- `src/core/lifecycle.ts` hard-codes Linux capabilities and host features; the
  tool executor and outbound transport are otherwise reusable.
- `src/adapters/types.ts`, `src/tools/index.ts`, and `src/actions/types.ts` embed
  Linux service units, journal fields, load/swap data, and systemd restart receipts.
- `src/core/snapshot-manager.ts` identifies collectors as `systemd` and `procfs`.
- `src/adapters/mock.ts` is a fixed Linux fixture. It is not a Windows reference
  or a stateful host simulator. The current mock action returns a synthetic
  receipt, not evidence of a host restart.
- Control-plane registration, `mapVm`, creation, and ordinary status/settings
  updates all assume Linux. Widening the handshake alone would let updates
  relabel Windows targets as Linux.
- Pending credential authentication marks enrollment verified before the current
  handshake loads target metadata. OS consistency must be checked before that
  mutation. Enrollment commit also seeds Linux/systemd capabilities.
- Snapshot inventory, service issue fingerprints, issue recovery, VM log routing,
  and root filesystem metrics contain Linux assumptions.
- Gateway built-in tools already belong to a target/server. The registry key is
  `(server_id, tool_name)` and caches are destination-scoped. Different OS targets
  may use the same tool names with different schemas; an OS-wide gateway migration
  is not justified.

## Boundary decisions

| Concept | Shared behavior retained | Windows-specific addition |
| --- | --- | --- |
| Target identity | `virtual_machine`, existing target/workspace IDs | Immutable `windows` OS and matching service manager |
| Agent identity | `agentv`, version header, outbound TLS WebSocket | Windows release package and host capabilities |
| Enrollment | One-use token, provisional verification, commit/replacement/rollback | OS-bound validation and Windows installer |
| Tool execution | Authentication, timeouts, limits, cancellation, redaction, MCP envelope | Windows input/output schemas and fixed collectors |
| Telemetry | Bounded snapshots and comparable numeric metrics | Explicit Windows snapshot variant and interpretation |
| Remediation | Existing approval/audit infrastructure | Separately reviewed Windows service helper later |

### Runtime and contracts

Keep Linux `HostAdapter`, tool definitions, and snapshot v2 semantics unchanged.
Add a Windows-specific host interface where data has genuinely different meaning.
Prefer a small runtime composition boundary that supplies host features, the
tool-registration function, and snapshot lifecycle. Do not spread `if windows`
checks through transport or rewrite the existing Linux collector runner.

Mock/live selection is independent of Linux/Windows selection. A Windows mock
can run on macOS/Linux, but a live Windows collector must fail clearly on the
wrong host. Default behavior for existing Linux environment files remains Linux.
Only the Windows runtime loads Windows-specific commands and service behavior.

Preserve Linux tool names, arguments, schemas, versions, and result envelopes
byte-for-byte where deterministic. Windows may reuse names within its target's
catalog while publishing its own native service and event-log fields. Do not
append `.service` to Windows names or manufacture Linux invocation IDs.

Use a distinct Windows snapshot version, proposed
`acornops.agentv-windows-snapshot.v1`. Dispatch snapshot interpretation using the
stored target OS and validate the Windows version there. Do not introduce a new
mandatory Linux schema discriminator that rejects deployed Linux snapshots.
Common numeric metric fields may be shared; unavailable load/swap/inode values
remain unavailable, not zero. Linux collector names, issue fingerprints, and
incomplete/truncated evidence recovery rules remain stable.

Windows service state is native SCM state. A stopped service alone is not a
failure. Service-health rules require real fixtures and explicit evidence such
as stopped state with a nonzero exit code; ordinary demand-start, disabled, and
trigger-start services must not generate false failures. Service issues recover
only from adequate successful collection, never from permission errors or
truncated/absent evidence. Windows system-volume identity is explicit; retain
the Linux `/` selection and fallback behavior.

### Backend and UI

Retain omitted OS metadata as legacy Linux. Validate explicit OS/service-manager
pairs, reject unknown explicit values, and preserve the stored pair during every
status/settings update. OS is immutable after registration. Check the stored OS
against runtime host features before provisional credential verification or
capability/online-state mutation.

For the read-only Windows phase, reject write enrollment and access-policy
updates, suppress unexpected advertised writes, and deny write dispatch on the
server. Hiding a console control alone is insufficient. Do not loosen the Linux
`.service` allowlist regex, protected-unit checks, approval preconditions, or
helper socket policy.

Add independently pinned Windows release settings. Keep `AGENTV_SYSTEMD_*`, Linux
asset names, and generated Linux shell commands intact. Windows registration is
disabled unless Windows rollout is explicitly enabled and a qualified release
is configured. Existing Linux onboarding and behavior require no new setting.

Add an OS choice defaulting to Linux, OS-appropriate installation instructions,
Windows log controls, and correct metric availability. Preserve the Linux setup
form, service allowlist validation, settings, and copy. Keep test fixtures and
mock runtime configuration out of deployable production defaults.

### Windows collectors and installation

Use local CIM/Windows APIs and fixed, versioned collector scripts. Bound runtime,
output bytes, row counts, and log time windows. Pass arguments as data, not
interpolated executable PowerShell text. Do not inherit AgentV credentials into
collector environments. Restrict log channels locally; permission denial is
reported as partial/unavailable evidence rather than escalating the agent.

Windows Service hosting needs an actual SCM-compatible host; registering
`node.exe` directly as a service is insufficient. Select a minimal native host
or a reviewed, pinned wrapper during the packaging task, with a written decision
before implementation. The choice must demonstrate child-process shutdown,
crash/restart behavior, bounded logging, dependency provenance, and cancellation.
No Linux dependency or archive layout changes are justified by that choice.

Use a dedicated low-privilege service identity and protected configuration under
ProgramData. Only the installer changes machine configuration. Validate ACLs and
trusted paths, clear runtime preload overrides, verify release checksums, and
preserve enrollment transaction semantics. Define recovery for interruption
before and after credential commit. Uninstall must not silently delete durable
configuration or revoke credentials. Never claim safe rollback after commit by
simply restoring a revoked credential file.

## Calibrated implementation sequence

Each phase requires a focused plan, failing tests for new behavior, minimal
implementation, compatibility checks, and independent review before the next
phase. Keep all work on `feat/windows-vm-support`; use small conventional commits.

1. **Pin Linux behavior.** Record baseline commits and tool catalog; add
   characterization tests for omitted OS defaults, unchanged Linux install
   commands, read/write catalogs, snapshots, issue identities, enrollment, and
   approved restart handling. Separate environment failures from code failures.
2. **Add backend OS boundaries with Windows disabled.** Preserve existing Linux
   behavior, enforce immutable OS and safe enrollment ordering, add Windows
   snapshot/log routes and read-only policy, then run old-agent/new-backend tests.
3. **Add Windows mock and live read collectors.** Share the protocol and executor;
   test Windows semantics independently, including incomplete evidence and mixed
   OS tool catalogs. Qualify actual collectors on disposable Windows hosts early.
4. **Add Windows packaging and qualification.** Decide and review service hosting,
   implement protected installation and transactional recovery, and add Windows
   CI jobs without weakening existing Ubuntu release gates.
5. **Complete UI and controlled rollout.** Enable Windows only with qualified
   release coordinates, verify mixed Linux/Windows targets end to end, and canary
   Linux before broad backend rollout. Publish support limits and residual gaps.
6. **Windows writes.** Separately review native service identity/protection,
   allowlists, ACL-separated privilege, durable operation receipts, preconditions,
   uncertain outcomes, and post-action verification before enabling any restart.

## Validation and release gates

The compatibility matrix includes released Linux AgentV
`v0.0.1-experimental.14` with the updated backend, updated Linux AgentV with the
updated backend, and both Windows test and live variants. Include read-only and
read-write Linux configurations and Linux agents with legacy optional fields
absent. Exercise Linux and Windows targets concurrently in one workspace.

Required evidence:

- `agentv`: `npm run validate`, `npm run test:e2e`, package smoke, real Ubuntu
  24.04/systemd tests on Node 22/24, and Windows collector/service tests on pinned
  Windows runner versions. Reboot recovery needs an actual reboot-capable test;
  restarting a process is not a substitute.
- `control-plane`: `npm run validate`, focused enrollment/handshake/repository/
  inventory/metrics/issues/logs/policy tests, and real database-backed enrollment
  transaction tests. Compare baseline failures before attributing a regression.
- `management-console`: canonical validation, affected VM browser tests in
  control-plane mode, and existing Linux VM UI cases.
- Workspace contract checks, Linux/Windows per-target catalog isolation tests,
  and real cross-service tests including the gateway/execution engine.
- Existing Linux snapshot and catalog fixtures generated from the baseline
  implementation, not rewritten to match the new implementation.
- Fault cases: OS mismatch before provisional verification, denied collector
  permissions, truncated enumeration, non-ASCII service/log data, command-shaped
  filter values, output limits, expired enrollment, interrupted installation,
  lost commit response, reconnect, duplicate operation, and unqualified versions.

Mocks provide platform-flow and parser coverage. They are never qualification
evidence for native permissions, service hosting, reboot, or package recovery.
Capture sanitized live outputs with provenance rather than assuming invented
fixtures describe Windows correctly. Unknown/partial collection stays visible.

## Rollout and rollback

Deploy backward-compatible backend support first with Windows disabled. Run
released Linux agents against it before enabling Windows. Publish separate
qualified Windows artifacts, then enable Windows onboarding and UI. Existing
Linux agents do not need upgrading for Windows enrollment elsewhere.

Feature-off is the preferred Windows rollback: stop Windows onboarding and
execution while preserving Windows metadata and the compatible backend. An older
backend currently relabels VM metadata as Linux; rolling back to that version
after creating Windows targets is not automatically safe. Establish the minimum
compatible backend version and a tested rollback procedure before rollout.

Do not alter existing production hosts, push release tags, merge branches, or
change production release pins as part of assessment. Release qualification and
deployment are separate from local test success.

## Evidence and remaining decisions

Baseline details and command outcomes are recorded in
`../exec-plans/active/windows-vm-assessment.md` and the workspace change set.
The pre-refactor independent review verified per-target gateway catalog isolation
and identified enrollment ordering, persistence relabeling, issue fingerprints,
log routing, and root-volume handling as specific regression hazards.

Before the relevant implementation task: confirm phase-one OS/version scope,
choose the SCM host with a focused comparison, and define exact Windows schemas
from documented APIs and a live collector spike. These decisions must not expand
or rewrite the frozen Linux contracts. Windows writes require their own reviewed
design after read-only qualification; they are tracked work, not silently omitted.

References: Microsoft `Win32_Service` documentation at
https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-service;
Windows event querying at
https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent;
GitHub hosted runner support at
https://docs.github.com/en/actions/reference/runners/github-hosted-runners.
