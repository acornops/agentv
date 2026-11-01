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

Final code/fixture checkpoint `7913f6779ad38f3f6157e23a3b206941f992034c` was
tested in merge `85f8dd3f235c929464e0e73a5470a9363505b2c0`; its parents were
verified against main `3d86cfc` and that feature commit. Runtime remains `c2eaf24`.

| Final checkpoint | Result |
| --- | --- |
| [Linux CI 41287130795](https://github.com/acornops/agentv/actions/runs/41287130795) | Validation, 190 unit/E2E tests in 34 files, package/bootstrap/curl checks and both Ubuntu 24.04 Node 22/24 live systemd lifecycle jobs passed. Computed coverage passed; the existing optional Codecov upload rejected tokenless upload and is not claimed successful. |
| [Collectors 41287130794](https://github.com/acornops/agentv/actions/runs/41287130794) | All four cells passed; first closes 4,663–8,513 ms, with all four boundary checks per cell. This does not erase the earlier ten-second failure. |
| [Service host 41287130829](https://github.com/acornops/agentv/actions/runs/41287130829) | All four cells passed 33 checks each; LocalService host reads 3,068–5,713 ms. |
| [Installer recovery 41287130789](https://github.com/acornops/agentv/actions/runs/41287130789) | All 18 jobs passed; all 20 artifacts inspected: 16 scenarios, two teardown fixtures and two complete-wrapper fixtures. Each OS/Node pair passed lifecycle 23, recovery 21, startup 9 and acceptance 21 checks. |

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

## Review hardening and component observation

The [focused hardening plan](../exec-plans/completed/windows-review-hardening.md)
adds Windows-only reconnect snapshot scheduling, shared pure mock/live log-input
validation, executable producer/consumer fixtures and bounded installer failure
categories. Installer return values and recovery decisions are preserved. No Linux
adapter, scheduler, helper, packaging or release coordinate changed in this phase;
no backend production code changed. The shared VM outage-status repair remains at
its separately reviewed [ownership/liveness design gate](https://github.com/acornops/control-plane/blob/feat/windows-vm-support/docs/exec-plans/active/vm-connection-status-repair.md).
Stale online status after dependency/process failure remains an inherited gap for
both OS families; this phase does not claim to repair it.

At AgentV `473698a5807a3ab4538a5ec4c15f81c4c54e8d67`, tested merge
`294429b7f104ffab03e3dafce0979c52829336e6` contains that feature checkpoint
and main `3d86cfc`. [Linux CI 41298109633](https://github.com/acornops/agentv/actions/runs/41298109633)
passes validation, 259 unit/E2E tests in 37 files, package/bootstrap/curl checks and
both Ubuntu 24.04 Node 22/24 install/restart/upgrade/rollback/uninstall gates.
Computed coverage passes; optional tokenless Codecov upload still fails.
[Normal collectors](https://github.com/acornops/agentv/actions/runs/41298109728)
pass all four Windows cells and boundary checks; capped Event Log reads correctly
remain partial. [Service host](https://github.com/acornops/agentv/actions/runs/41298109687)
passes 33 checks per cell, including LocalService collection and owned cleanup.
All eight native artifacts were inspected. These are passing samples, not a
resolution of the historical cold-call or service-identity failures.

Both short installer recovery jobs in
[41298109634](https://github.com/acornops/agentv/actions/runs/41298109634)
pass 25 API diagnostic cases each. All inspected preservation, diagnostic safety,
native invocation, environment restoration and cleanup flags pass, including
throwing/unavailable sinks. The native I/O executable is synthetic; the production
API helper, ACL/JSON/cleanup paths and recovery decisions are real. Both generated
HTTPS wrappers also pass six cases and owned cleanup, with a synthetic bootstrap.
The full matrix finished 18/18 jobs; all 22 artifacts were inspected. Each OS/Node
pair passed lifecycle 23, recovery 21, startup 9 and acceptance 21 checks.
These results do not establish real-backend enrollment or reboot recovery.

Backend [CI 41295301987](https://github.com/acornops/control-plane/actions/runs/41295301987)
at `0b589ae` passes 1,731 tests/255 suites with zero failures/skips and all required
gates. Actual AgentV-generated snapshots and backend-generated commands are now
checked in each repository, with counterpart equality enforced by the workspace
gate. The AgentV fixture comparison handles checkout CRLF without normalizing
JSON string content; the initial Windows test failure remains recorded in
[41296383285](https://github.com/acornops/agentv/actions/runs/41296383285).

The one new [cold component experiment 41298126115](https://github.com/acornops/agentv/actions/runs/41298126115)
at exact `473698a` uses the actual snapshot's five collectors plus four actual tool
reads. It deliberately bypasses startup host preflight; hosted minimum-VM
representativeness is unknown. All four cells observed nine simultaneous child
callbacks and a peak of 19 processes in their owned job. Job counts include the
worker and every owned descendant; neither their identities nor exact native
overlap durations were measured.

| Cell | Retained result |
| --- | --- |
| Server 2022 / Node 22 | Healthy worker; supervisor inconclusive because the fixture required exactly ten total owned processes. |
| Server 2022 / Node 24 | Seven non-host collector timeouts; incomplete filesystem/service coverage and three tool timeouts. |
| Server 2025 / Node 22 | Listener collector timeout; other collector/tool results healthy. |
| Server 2025 / Node 24 | Healthy worker; supervisor inconclusive for the same count-predicate defect. |

All workers finished before the independent 12-second cutoff, with confirmed
owned cleanup. All assignment-failure and independent-watchdog negatives passed;
all twelve artifacts were independently reviewed and retained unchanged. The
fixture's image allowlist omitted `win25-vs2026`; matching watchdog artifacts
retain that label. The Server 2025 cells also used different image versions.
No Node-version, process-identity or causal concurrency conclusion follows.
The aggregate-count/provenance fixture corrections are distinct from these
original failed/inconclusive observations; no second composition experiment is
used to manufacture a passing result.

Fixture-only correction `857d95a` accepts a bounded count of at least ten owned
processes with a live worker as aggregate corroboration and retains the exact
known image label. It preserves all health, callback, cutoff and cleanup gates;
original artifacts are not relabeled. Focused helper/negative checks now run in
ordinary PR CI without executing another cold composition.

Final fixture verification at `da137584c5775b835092ab8bd258fe3dc39471c6`,
tested merge `361c1af7d42742a66baa0936415a1a0ee2f69bfb`, passes the amended
PowerShell metadata, C# accounting/disposal and assignment-negative checks in
all four cells of [41299915070](https://github.com/acornops/agentv/actions/runs/41299915070).
**That run's normal collector smoke is three passed, one failed.** Server 2022 /
Node 24 timed out its host collector at 10,019 ms with no stdout. The first script
marker arrived at 6,103 ms, collection completed at 9,833 ms, the timer fired at
10,008 ms and the child closed at 10,025 ms; observed Node event-loop lag peaked
at 15 ms. The existing automatic post-failure diagnostic trials closed in 2,201
and 1,424 ms under their separate 20-second diagnostic ceiling. Those later
samples neither repair nor reclassify the failed production-bound call. No
unchanged workflow rerun was requested; the native cause remains unknown.

At the same final fixture checkpoint,
[Linux CI 41299915084](https://github.com/acornops/agentv/actions/runs/41299915084)
again passes 259 unit/E2E tests and both Ubuntu Node 22/24 lifecycle gates;
[service host 41299915111](https://github.com/acornops/agentv/actions/runs/41299915111)
passes all four cells with 33 checks each (all artifacts inspected). Both short
installer jobs in [41299915031](https://github.com/acornops/agentv/actions/runs/41299915031)
pass the added-file PowerShell parsing and recovery fixtures. The redundant
transactional matrix was then deliberately cancelled: packaged/runtime source
is unchanged since the completed 18-job run above. That cancelled matrix is not
claimed successful. The parent gate regression now runs in default CI;
[41300065611](https://github.com/acornops/acornops/actions/runs/41300065611)
passes at `933ab5c`. Independent final source review found no Critical/Important
issue; its one CI-wiring recommendation passed scoped re-review. These source
and fixture results leave Windows rollout unqualified.

This establishes a Windows composition qualification gap under existing bounds.
It does not explain the native wait or justify a queue, retry, prewarming or
timeout policy change. The next production proposal needs a bounded causal
observation or matched control, actual startup/service-identity coverage and
representative minimum-VM evidence. Rollout and writes remain disabled.

## Deterministic follow-up fixes

At AgentV `0bd62ea` and parent `314ecad`, the Linux mock's `list_services`
returns only the five existing summary fields; `get_service` and restart
preconditions remain intact. The parent now accepts ignored child symlinks,
rejects tracked child contents (including platform-admin), and checks requirement
counts against child-owned contract manifests. These are corrections to the
previously recorded mock/workspace defects, not changes to live Linux collectors
or Windows runtime behavior. Historical failed runs above remain unchanged.

[Linux CI 41305615953](https://github.com/acornops/agentv/actions/runs/41305615953)
at tested merge `65fad1ef8940269f17f33ad0062678da0653d881` passes validation,
260 coverage/E2E tests in 37 files, package/bootstrap/curl checks and both Ubuntu
24.04 Node 22/24 live systemd lifecycle gates. Coverage computation and the GitHub
artifact pass; the optional Codecov upload now correctly skips when its token is
unavailable. This is not successful external publication. Parent
[CI 41305617865](https://github.com/acornops/acornops/actions/runs/41305617865)
passes the four gate regressions, harness and title checks; full local
`task validate` also passes. The independent follow-up review has no findings.

Automatically triggered [native collectors](https://github.com/acornops/agentv/actions/runs/41305615972)
pass all four Server 2022/2025 and Node 22/24 cells. Inspected host reads take
5,110–7,600 ms; all boundary checks and injected assignment-cleanup checks pass.
[Service-host CI](https://github.com/acornops/agentv/actions/runs/41305615963)
passes 33 checks in each cell, including LocalService collection and containment.
All eight collector/service-host artifacts were inspected. These passing samples
do not resolve the earlier timeouts, service-identity failure or cold composition
failures; none of those production paths changed in this follow-up.

[Installer CI 41305615938](https://github.com/acornops/agentv/actions/runs/41305615938)
passes 18/18 jobs at that same merge; all 22 artifacts were inspected. Each
OS/Node pair passes lifecycle 23, recovery 21, startup 9 and acceptance 21 checks.
The six short-fixture artifacts record 25 API-diagnostic cases, six generated
wrapper cases and ten teardown-race checks per OS. Their synthetic native-I/O,
bootstrap and backend boundaries remain as documented above. This is hosted
transactional testing, not real-backend deployment or reboot qualification.

## Final catch-all audit

The [final catch-all record](../exec-plans/completed/windows-final-catch-all.md)
fixes the service entry retaining its open control pipe after completion,
onboarding ignoring expired observations, and hidden confirmation errors.
It removes a repeated backend discovery filter without changing dispatch guards,
wires real process/HTTPS regressions into validation, and conservatively skips
native jobs for prose-only PRs. Historical native failure records above remain
unchanged; none of these fixes explains the collector timing failures.

Shared heartbeat reporting now expires stale observations (see the
[backend record](https://github.com/acornops/control-plane/blob/feat/windows-vm-support/docs/exec-plans/completed/agent-heartbeat-freshness.md));
persistent outage-status/event reconciliation remains separate. Exact-revision
hosted evidence for this pass is recorded on the coordinated draft PRs.

At source `c23aec0`, tested merge `7c525bd`, Linux CI, all four service-host
cells and candidate preparation pass. [Collectors 41340471577](https://github.com/acornops/agentv/actions/runs/41340471577)
still fail: Server 2022/Node 22 reaches 10,021 ms without output or a script
marker. [Installer 41340471384](https://github.com/acornops/agentv/actions/runs/41340471384)
adds a distinct Server 2025/Node 24 rollback-finalization failure: atomic
replacement at `Paths.psm1:95` returns sharing violation `0x80070020` after a
lost rollback response. The journal remains at `finalize-intent`, selecting
`previous`; the service is running, but transaction completion is not verified.
The artifact does not identify the locked destination or holder. Concurrent
recovery reads are a hypothesis, not an established cause or an implemented fix.
Neither timeout retries nor file-sharing/locking changes were made speculatively.

The subsequent [41342700534](https://github.com/acornops/agentv/actions/runs/41342700534)
fails a provisional-readiness test before native collection in one cell. A
deterministic follow-up reproduces an old provisional timer interrupting a newer
connection in both Linux and Windows (four failures, two unchanged-retry controls).
A two-line generation guard fixes those cases; it does not explain or repair the
native collector timeout or installer sharing violation. The superseded installer
run `41342700480` was cancelled before verifying the new runtime revision.

## Unmet gates

1. **Explain and resolve native collector reliability failures.** Preserve failed
   [41231100915](https://github.com/acornops/agentv/actions/runs/41231100915) and
   [41234585971](https://github.com/acornops/agentv/actions/runs/41234585971):
   Server 2022 Node 22/24 and earlier Server 2025 Node 24 hit the former
   eight-second bound; a later diagnostic took 8,369 ms. The host-only ten-second
   tolerance above has native evidence beyond eight seconds, but the underlying
   wait remains unattributed. Hosted jitter and CIM alone are not established
   causes; passing samples cannot erase the failures or qualify general reliability.
   The component experiment above adds two unhealthy samples; serial smoke does
   not cover that workload. Retain its failures and resolve the causal/representative
   workload gaps before choosing any production concurrency policy.
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
5. **Resolve rollback-finalization sharing violations.** Capture the allowlisted
   destination and owning handle in the failed path above, reproduce the overlap,
   then validate a scoped repair across the native recovery matrix. Retained
   recovery state and later passing samples do not establish successful repair.

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

The focused follow-up's broad review at `342a933..9fa1f4f` found no new Critical
or Important source defect. The existing expected-error logging Minor remains
deferred. Source approval does not approve Windows readiness: the cold-start
qualification item stays open, despite that phase's passing matrix. Its later
documentation commits precede the separate review-hardening phase recorded above.

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
