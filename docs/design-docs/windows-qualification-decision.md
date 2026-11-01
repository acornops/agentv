# Windows qualification decision

Decision date: 2026-11-01. Scope: Task 8 of the
[Windows implementation plan](../exec-plans/active/windows-vm-implementation.md),
following Task 7 source/integration completion, and the focused
[native reliability follow-up](../exec-plans/active/windows-native-reliability.md).

**Not qualified for Windows rollout or writes.** Keep rollout disabled and Windows
write enrollment, policy changes, discovery and dispatch denied. No Windows
restart implementation follows this decision. The read-only feature-branch stage
has source/integration evidence; the wider Windows program remains incomplete.
The broad source review and its single fix-wave review are complete. Final
coordinated CI and draft-PR evidence are recorded below; these do not qualify
native rollout.

## Evidence and its boundaries

The initial implementation-stage AgentV runtime is
`f86bd5ab7040c9372f6160383ef7620091f821ea`, also present unchanged at the
documentation checkpoint `e9e9bbdc5a929efa821ad5192643dd5751de3b09`.
Control-plane is `3a1b969d5a4782880b615d1f12c38c8dc1f62b6f`, console
`5eabc881e6712cbd88570f3beddca30920a5b4c2`, and API docs
`a39eb953907ed9b5e10a157f4fe2e0e5c37ffa8f`. These identify source, not
released or enabled Windows artifacts. The later runtime change is recorded
separately below; the following table retains the original checkpoints.

| Evidence | Result and limit |
| --- | --- |
| [Linux CI 41247116654](https://github.com/acornops/agentv/actions/runs/41247116654) at feature `e9e9bbd`, tested merge `f15c45fee1f30da9e4495348428eafcc8e677422` | 183 unit/E2E tests in 34 files, validation, package/bootstrap/curl and Ubuntu 24.04 systemd Node 22/24 install/restart/upgrade/rollback/uninstall passed. |
| [Windows collectors 41247116633](https://github.com/acornops/agentv/actions/runs/41247116633), same tested merge | All Server 2022/2025 × Node 22/24 cells passed; first calls closed in 5,130–7,577 ms. Passing samples did not capture or explain earlier failures. |
| [Installer 41247116808](https://github.com/acornops/agentv/actions/runs/41247116808), same tested merge | All 18 jobs passed; all 16 scenario artifacts were inspected. Per OS/Node pair: lifecycle 23, recovery 21, startup 9 and acceptance 21 checks. Real SCM, ACLs, packaged host and transaction/recovery paths ran on disposable hosted Windows with synthetic credentials and loopback transport. This is native package evidence, not reboot evidence. |
| [Earlier service host 41243496972](https://github.com/acornops/agentv/actions/runs/41243496972), tested merge `31e0912aed8ce3bf45a5cbcd0a14f91360d092cf` | Three cells passed; Server 2022/Node 24 failed after 13 checks while running production collectors under service identity. The old fixture lost the collector error; cause is unknown, including whether it was a timeout. |
| [Diagnostic service host 41244479710](https://github.com/acornops/agentv/actions/runs/41244479710) at exact `f86bd5ab7040c9372f6160383ef7620091f821ea` | All four cells passed 33 checks each; LocalService host summaries took 3,025–4,635 ms. The fixture now retains bounded allowlisted failure code/stage/timeline. The failure did not recur; instrumentation and a green sample are not a reliability fix. |
| [Service host 41247116727](https://github.com/acornops/agentv/actions/runs/41247116727), tested merge `f15c45f` | All four cells passed 33 checks each; actual LocalService host summaries took 3,181–4,391 ms. This is another non-reproduction of the earlier failure, not a causal remedy. |
| Local validation and reviews | AgentV: 179 unit tests/33 files and lint/contracts/harness/build passed. Task 7's connection fix passed independent review and [backend CI 41246730821](https://github.com/acornops/control-plane/actions/runs/41246730821) at `37c62d6`: 1,712 tests/254 suites, zero failures/skips and all validation gates. The broad review found two important Windows diagnostic-display gaps; the single fix wave at the final backend/console/docs revisions passed scoped re-review with no open or new findings. |
| Actual mixed-target transport and reconnect checkpoints | Released Linux experimental.14, updated Linux and Windows processes used the actual execution client/gateway/backend, enrollment, reconnect, snapshot and approval APIs. At backend `37c62d6`, three automatic and three controlled reconnects retained identity/policy/credentials. Read, scope, registry, Windows-filter and Linux-approval checks passed again at final backend `3a1b969`. All 24 catalog reads succeeded; 22 output schemas passed. Both Linux mock `list_services` results reproduce the frozen baseline's extra-field error. Host observations and restart actions were synthetic; these checks do not qualify native permissions or mutations. |
| Windows collection-health fix | Backend 51 focused tests/3 suites, console 17 tests/2 files and 19 browser fixtures passed after narrow facade extractions. Earlier full local backend 1,719/255 and console 1,277/237 test runs passed, then failed file-size harness gates; they are not passing monolithic validation runs. Those unchanged budgets were satisfied by the extractions, followed by type/style/harness/build and console bundle/route checks. |
| Actual final backend/browser composition | Nine checks passed without browser interception at backend `3a1b969` and console `5eabc88`: denied/unavailable/partial HTTP200 logs, retained useful rows, bounded counts, snapshot category/time identity, channel/target/cache isolation and narrow viewport. Faults were injected into the process-local Windows mock; actual AgentV/transport/backend/browser were used. Both Linux targets retain exact `{items}` resources and write policies. |
| [Final backend CI 41249382697](https://github.com/acornops/control-plane/actions/runs/41249382697) at `3a1b969` | Full validation passed: 1,719 tests/255 suites, zero failures/skips, type/style/migrations/authz/membership/run-events/contracts/OpenAPI/harness/build. |
| [Final console CI 41249388708](https://github.com/acornops/management-console/actions/runs/41249388708) at `5eabc88` | Node 22 preflight passes 1,277 tests/237 files and all remaining gates; all eight browser jobs pass, including 330 fixture tests. |
| [Docs CI 41249390190](https://github.com/acornops/docs-website/actions/runs/41249390190) at `a39eb95` | Validation and links passed. Final cross-repository producer/consumer contract checks passed, including the additive Windows collection-status envelope. |

Native host source SHA-256 is
`d85afcc72b2be7b7a804d2857c5171a8034d88bcefa2e68f86dd5e6a34d1be42`;
host-summary script SHA-256 is
`1951a5fcd4b1ebc40023c5fcf0742db1ac9b0db2e2a16576931076e0bea83b35`.
Both are unchanged across the cited native samples. No timeout increase,
retry, prewarming or relaxed environment/output boundary explains the initial
implementation-stage greens above. The later host timeout change is explicit
in the follow-up evidence below.
The selected 80 Linux-owned tracked files match baseline `3d86cfc` exactly;
shared config/lifecycle/entry/doctor/observability seams remain outside that
comparison and rely on behavioral checks. This does not prove zero regressions.

## Focused native reliability follow-up

Runtime commit `c2eaf24a4a7b931ebf0956af9c072a452656b89b` changes only the
Windows host collector deadline from 8,000 to 10,000 ms. Other Windows collectors
retain 8,000 ms. Tool, service initialization, installer doctor and backend command
deadlines remain 12,000, 15,000, 20,000 and 25,000 ms. Fixed script hashes, executable
trust, credential-free environment, 1 MiB output cap and cancellation are preserved.
No retry or prewarming was added. Linux and the other repositories' production
source did not change in this follow-up.

| Evidence | Result and limit |
| --- | --- |
| [Original-bound native measurement 41282917589](https://github.com/acornops/agentv/actions/runs/41282917589) at `3a1efa4` | Server 2022/Node 22 failed at the original bound: native lifetime 8,016 ms, CPU 719 ms, Node event-loop maximum lag 13 ms, exit-to-close 1 ms. Collection completed at 7,949 ms but no JSON arrived before termination. Three other cells passed. This rules out a multi-second parent observation delay for this sample; the underlying non-CPU wait remains unattributed. The failed sample is retained. |
| [Changed-bound measurement 41284255184, attempt 1](https://github.com/acornops/agentv/actions/runs/41284255184/attempts/1) at exact `c2eaf24` | All four first calls and all four independent watchdog proofs passed. Server 2022/Node 22 completed with native lifetime 8,873 ms, observed close 8,884 ms and CPU 407 ms: actual useful headroom beyond the former limit. Other native lifetimes were 7,076, 5,144 and 4,625 ms. This does not prove every future cold call fits ten seconds. |
| [Later collectors 41286059709](https://github.com/acornops/agentv/actions/runs/41286059709) at `ef30249`, runtime still `c2eaf24` | Server 2022/Node 24 failed at the ten-second deadline before any script stage or output; close was 10,493 ms and Node event-loop maximum lag 13 ms. Other three cells passed. Subsequent diagnostic calls took 8,537 and 1,472 ms; these are not recovery or first-call success evidence. This failure reopens native acceptance and establishes that ten-second headroom alone is insufficient. |
| [Follow-up measurement 41284255184, attempt 2](https://github.com/acornops/agentv/actions/runs/41284255184/attempts/2), exact `c2eaf24` | One Server 2022/Node 24 job was rerun. It passed with 6,126 ms native lifetime/500 ms CPU and did not reproduce the no-marker failure. The result is inconclusive for its cause. The other three displayed matrix results retain attempt-1 timestamps/artifacts. No further capture was requested and the failed qualification remains open. |
| [Collectors 41284256955](https://github.com/acornops/agentv/actions/runs/41284256955), tested merge `4264918384c787729a7cff3c2383402e90d2fc9f` containing `c2eaf24` | All four normal native cells passed; first closes 4,572–7,317 ms. Boundary checks and unchanged script provenance passed. |
| [Service host 41284256962](https://github.com/acornops/agentv/actions/runs/41284256962), same merge | All four cells passed 33 checks each; actual LocalService host reads took 3,380–4,464 ms. The earlier lost service-identity error remains unattributed. |
| [Linux CI 41284256959](https://github.com/acornops/agentv/actions/runs/41284256959), same merge | Validation, unit tests and both Ubuntu 24.04 live systemd Node 22/24 lifecycle jobs passed. |
| [Installer recovery 41284256981](https://github.com/acornops/agentv/actions/runs/41284256981), same merge | All 18 jobs passed; all 18 artifacts were inspected. Each OS/Node pair passed lifecycle 23, recovery 21, startup 9 and acceptance 21 checks. Both owned teardown-race fixtures passed. This is real package/SCM evidence using synthetic transport, not reboot or combined real-backend deployment evidence. |
| Local runtime validation | `npm run validate` passed 186 tests/33 files; `npm run test:coverage:all` passed 190/34; package/bootstrap checks passed. Focused tests cover a valid host result after eight seconds, the ten-second stop, unchanged non-host timing, cancellation/output limits during the added interval and the unchanged outer tool/startup deadlines. A Windows mock test now waits for both independently arriving messages before asserting both. |

The diagnostic fixture initially failed before starting the collector because
PowerShell discovered two Node executables and concatenated their paths. It now
selects the first executable by existing command precedence. Runs
`41282134273` and `41282605005` remain fixture failures, not production evidence.
Native watchdog tests now require proof that the independent callback terminated
the owned process tree before fallback cleanup. No raw trace, command line,
environment, credentials or host observations are published by these diagnostics.

The full generated HTTPS command now passes on Server 2022 and 2025 in the two
recovery-state jobs of [run 41287130789](https://github.com/acornops/agentv/actions/runs/41287130789),
fixture source `7913f6779ad38f3f6157e23a3b206941f992034c`, tested merge
`85f8dd3f235c929464e0e73a5470a9363505b2c0`. Both inspected artifacts contain
six passing cases: initial, repair and credential replacement, untrusted TLS,
HTTP failure and bootstrap failure. Every case removes both temporary paths and
preserves an unrelated sentinel; both fixtures confirm owned process, certificate
and scratch cleanup. Commands match the actual pinned control-plane builder
byte-for-byte, with both recorded source hashes independently verified.

This executes native PowerShell 5.1 and OS curl with an explicitly synthetic
downloaded parameter-capture bootstrap. It qualifies the outer download,
invocation and cleanup boundary, not production bootstrap enrollment against a
real backend. The initial fixture attempts failed before executing any case.
Bounded observations eventually established premature successful server shutdown;
the fixture incorrectly treated any stdin chunk as a shutdown command. Actual
child-process regressions reproduced this with preamble/unrelated input, and
requiring a complete `stop` line resolves the observed native setup failure.
The exact original native input bytes were not captured. The four earlier failed
runs remain failed; the local path-alias repair did not resolve that native symptom.

## Unmet gates

1. **Explain and resolve native collector reliability failures.** Preserve failed
   [41231100915](https://github.com/acornops/agentv/actions/runs/41231100915) and
   [41234585971](https://github.com/acornops/agentv/actions/runs/41234585971):
   Server 2022 Node 22/24 and earlier Server 2025 Node 24 hit the former
   eight-second bound; a later diagnostic took 8,369 ms. The host-only ten-second
   tolerance above has native evidence beyond eight seconds, but the underlying
   wait remains unattributed. Hosted jitter and CIM alone are not established
   causes; passing samples cannot erase the failures or qualify general reliability.
2. **Resolve the service-identity failure** in `41243496972`. Use retained bounded
   collector evidence to establish cause and validate the remedy under the actual
   low-privilege service identity on the supported matrix. Do not call the new
   diagnostic fixture a production fix.
3. **Execute real reboot recovery and Core/Desktop Experience coverage.** Hosted
   SCM restart and hosted image labels do not establish those outcomes. The user
   selected hosted CI for now; these gates remain unexecuted.
4. **Qualify the combined deployment and artifacts.** Hosted native packaging uses
   synthetic loopback transport; actual backend integration uses synthetic host
   observations/actions. Their combination is not native deployment/recovery
   evidence. Activation requires independently pinned qualified Windows artifacts
   and that native evidence. Arbitrary mixed old/new backend versions remain
   unqualified. No release or activation is authorized by the implementation tasks.

## Source review and handoff

All eight planned source/decision tasks passed their independent reviews. The
single broad review's two important findings are fixed: Windows HTTP200 log
diagnostics survive normalization/caching, and snapshot collection status reaches
inventory with workspace/target/generation identity. Partial rows remain usable;
unknown evidence stays visible. Linux response and cache paths are preserved.
The single scoped re-review has no open findings. Draft PRs remain on
`feat/windows-vm-support`: [backend](https://github.com/acornops/control-plane/pull/33),
[AgentV](https://github.com/acornops/agentv/pull/8),
[console](https://github.com/acornops/management-console/pull/35), and
[API docs](https://github.com/acornops/docs-website/pull/19).

## Requirements before any future native-action implementation

Only after the read-only qualification gates pass, create and independently
review a focused native-action design and implementation plan. It must specify:

- Exact service-name allowlists and protected-service exclusions, enforced at both
  policy and native boundaries.
- The low-privilege agent boundary and ACL-separated privileged helper, including
  authenticated callers and bounded native operations.
- Durable idempotency receipts, replay handling and recovery across process failure.
- Fresh state preconditions, cancellation and uncertain-outcome semantics.
- Post-action verification and native permission/failure/recovery tests.

These are requirements for a future design, not an approved design or speculative
code. No arbitrary shell/PowerShell, WinRM, provisioning, package, registry or AD
actions are introduced. Linux helper and allowlist semantics remain unchanged.

## Rollout and rollback boundary

The eventual order is compatible backend/API docs with Windows disabled, qualified
AgentV artifacts, then console; activation is a separate qualification decision.
Existing Linux agents need no upgrade. Feature-off preserves stored Windows OS
metadata on the compatible backend. Once Windows targets exist, an old Linux-only
backend is not a safe rollback. No merge, release, deployment or activation occurred
as part of this decision.
