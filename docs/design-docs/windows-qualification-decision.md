# Windows qualification decision

Decision date: 2026-11-01. Scope: Task 8 of the
[Windows implementation plan](../exec-plans/active/windows-vm-implementation.md),
following Task 7 source/integration completion.

**Not qualified for Windows rollout or writes.** Keep rollout disabled and Windows
write enrollment, policy changes, discovery and dispatch denied. No Windows
restart implementation follows this decision. The read-only feature-branch stage
has source/integration evidence; the wider Windows program remains incomplete.
Final backend hosted CI, broad review and coordinated PR handoff are still gates.

## Evidence and its boundaries

The evaluated AgentV runtime is
`f86bd5ab7040c9372f6160383ef7620091f821ea`; control-plane is
`37c62d69f8aae157480a0502142bc662ee8bd816`, console `6c77dbc`, and API docs
`4586d5e`. These identify source, not released or enabled Windows artifacts.

| Evidence | Result and limit |
| --- | --- |
| [Linux CI 41243496955](https://github.com/acornops/agentv/actions/runs/41243496955) at feature `04e5a03`, tested merge `31e0912aed8ce3bf45a5cbcd0a14f91360d092cf` | Validation, package/bootstrap/curl and Ubuntu 24.04 systemd Node 22/24 install/restart/upgrade/rollback/uninstall passed. Later AgentV changes affect Windows diagnostics, not Linux runtime. |
| [Windows collectors 41243496933](https://github.com/acornops/agentv/actions/runs/41243496933), same tested merge | All Server 2022/2025 × Node 22/24 cells passed; first calls closed in 3,582–6,955 ms. Passing samples did not capture or explain earlier failures. |
| [Installer 41243496893](https://github.com/acornops/agentv/actions/runs/41243496893), same tested merge | All 18 jobs passed; all 16 scenario artifacts were inspected. Per OS/Node pair: lifecycle 23, recovery 21, startup 9 and acceptance 21 checks. Real SCM, ACLs, packaged host and transaction/recovery paths ran on disposable hosted Windows with synthetic credentials and loopback transport. This is native package evidence, not reboot evidence. |
| [Service host 41243496972](https://github.com/acornops/agentv/actions/runs/41243496972), same tested merge | Three cells passed; Server 2022/Node 24 failed after 13 checks while running production collectors under service identity. The old fixture lost the collector error; cause is unknown, including whether it was a timeout. |
| [Diagnostic service host 41244479710](https://github.com/acornops/agentv/actions/runs/41244479710) at exact `f86bd5ab7040c9372f6160383ef7620091f821ea` | All four cells passed 33 checks each; LocalService host summaries took 3,025–4,635 ms. The fixture now retains bounded allowlisted failure code/stage/timeline. The failure did not recur; instrumentation and a green sample are not a reliability fix. |
| Local validation and Task 7 review | AgentV: 179 tests/33 files, lint/contracts/harness/build passed; earlier runtime E2E four tests and package smoke passed. Backend full validation at `5fdb312`: 1,701 tests/254 suites, zero failures/skips plus type/style/migrations/authz/membership/run-events/contracts/OpenAPI/harness/build. Final `37c62d6` fix re-review is clean with 53 focused tests/zero skips and type/style/harness/build; the earlier full count is not attributed to that fix revision. |
| Actual mixed-target transport on final runtime/backend | Released Linux experimental.14, updated Linux and Windows processes used the actual execution client/gateway/backend, enrollment, reconnect, snapshot and approval APIs. Three automatic and three controlled reconnects retained identity/policy/credentials. Read, scope, registry, Windows-filter and Linux-approval checks passed. All 24 catalog reads succeeded; 22 output schemas passed. Both Linux mock `list_services` results reproduce the frozen baseline's extra-field error. Host observations and restart actions were synthetic; these checks do not qualify native permissions or mutations. |
| [Console CI 41242199107](https://github.com/acornops/management-console/actions/runs/41242199107) at `6c77dbc`; [docs CI 41245818859](https://github.com/acornops/docs-website/actions/runs/41245818859) at `4586d5e` | Console local 1,266 tests/237 files and hosted Node 22 preflight/eight browser jobs passed. Actual backend/browser Windows log results were empty; populated-log, race and 409 cases used intercepted fixtures. Docs validation/links and combined cross-repo contract checks passed. |
| [Final backend CI 41246730821](https://github.com/acornops/control-plane/actions/runs/41246730821) | Pending when this decision was recorded; controller must collect its result before final handoff. |

Native host source SHA-256 is
`d85afcc72b2be7b7a804d2857c5171a8034d88bcefa2e68f86dd5e6a34d1be42`;
host-summary script SHA-256 is
`1951a5fcd4b1ebc40023c5fcf0742db1ac9b0db2e2a16576931076e0bea83b35`.
Both are unchanged across the cited later native samples. No timeout increase,
retry, prewarming or relaxed environment/output boundary explains the greens.
The selected 80 Linux-owned tracked files match baseline `3d86cfc` exactly;
shared config/lifecycle/entry/doctor/observability seams remain outside that
comparison and rely on behavioral checks. This does not prove zero regressions.

## Unmet gates

1. **Explain and resolve native collector reliability failures.** Preserve failed
   [41231100915](https://github.com/acornops/agentv/actions/runs/41231100915) and
   [41234585971](https://github.com/acornops/agentv/actions/runs/41234585971):
   Server 2022 Node 22/24 and earlier Server 2025 Node 24 hit the unchanged
   eight-second bound; a later diagnostic took 8,369 ms. Establish a causal
   production remedy and repeat native qualification. Hosted jitter and CIM alone
   are not established causes; a later passing matrix cannot erase the failures.
2. **Resolve the service-identity failure** in `41243496972`. Use retained bounded
   collector evidence to establish cause and validate the remedy under the actual
   low-privilege service identity on the supported matrix. Do not call the new
   diagnostic fixture a production fix.
3. **Execute real reboot recovery and Core/Desktop Experience coverage.** Hosted
   SCM restart and hosted image labels do not establish those outcomes. The user
   selected hosted CI for now; these gates remain unexecuted.
4. **Exercise the complete generated PowerShell install command** through outer
   HTTPS download, temporary-file lifecycle and invocation. Native syntax parsing
   and literal argument binding passed; the full wrapper has not run end to end.
5. **Finish review, handoff and artifact qualification.** Collect final backend
   CI, run the single broad review, resolve important findings and complete the
   coordinated PR handoff. Windows activation separately requires independently
   pinned qualified Windows artifacts and native evidence. No release or activation
   is authorized by the implementation tasks.

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
