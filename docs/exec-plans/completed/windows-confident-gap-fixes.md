# Deterministic follow-up fixes for Windows VM work

Status: implementation and independent review complete; feature branches retained.
Hosted results and remaining qualification gates are recorded below.

## Scope and acceptance

The user authorized fixing the remaining gaps we can address confidently,
with minimal changes on `feat/windows-vm-support` and preservation of Linux
VM behavior. This plan is the implementation specification for this follow-up.
Execute inline, then obtain one independent review of both repository diffs.

Fix the reproducible Linux mock summary-contract defect, parent workspace
validation defects, and the optional Codecov upload's missing-credential path.
Do not change live Linux adapters, Windows collectors, ownership/liveness,
timeouts, scheduling, installer behavior, rollout gates, or published assets.
The current native Windows timing failures have no established cause; real
reboot, minimum-host, and native/backend qualification remain open. Shared
outage-status repair remains under its separate backend protocol design gate.

Starting points: AgentV `91d09ff`, parent `933ab5c`. Existing feature worktrees
are reused. Linked child checkouts on main and unrelated dirty files are
read-only. No shared skills or child templates are synced.

## Task 1: Return strict service summaries from the Linux mock

Files: `src/adapters/mock.ts`, `src/tools/contracts.spec.ts`, debt tracker.
Interfaces: existing `list_services` summary and `get_service` detail contracts;
no schema or producer/consumer protocol change.

1. Add a regression through the actual MCP router/executor that requires exactly
   the five public summary fields. Check that detail reads retain restart
   preconditions. Run `npx vitest run src/tools/contracts.spec.ts`.
   Expected: the extra detail fields make the new summary assertion fail.
2. Explicitly project the five summary fields in the mock only. Repeat the
   focused test. Expected: all contract tests pass, including detail/restart.
3. Run `npm run validate`. Expected: lint, unit, contracts, harness and build pass.
   Record the historical failure as fixed in the debt tracker, without rewriting
   prior qualification evidence. Commit `fix(mock): return strict service summaries`.

## Task 2: Make parent validation work with linked child repositories

Files in parent: `.gitignore`, `scripts/harness/check-agent-harness.sh`,
`scripts/harness/check-platform-harness.mjs`, a subprocess regression test,
`Taskfile.yml`, `.github/workflows/ci.yml`, developer/harness documentation.
Interfaces: independent child checkout names and the platform-admin console's
existing requirements baseline and contract manifest.

1. Run the actual gates in temporary Git workspaces. Cover absent/directory/
   symlinked children, tracked-child rejection, and nonchild/nested paths.
   Cover matching changed route/scope counts and mismatched/invalid/missing
   counts against a minimal child-owned contract fixture. Expected: the old
   symlink and hardcoded-count defects fail the positive regressions.
2. Ignore anchored child names for directories and symlinks; check each child
   name without a trailing slash, preserving tracked-content rejection.
   Compare baseline counts with nonempty child-manifest route/scope arrays;
   retain the child `requirements:check` wiring and authority checks.
3. Run `node --test scripts/harness/*.test.mjs` and `task validate` in parent.
   Expected: all regression tests and workspace gates pass. Wire the tests into
   both parent CI and `task validate`. Verify the actual platform-admin child's
   `npm run requirements:check` read-only. Commit the parent changes separately.

## Task 3: Skip only unconfigured optional Codecov publication

Files: `.github/workflows/ci.yml`, `docs/DEVELOPMENT.md`.
Interfaces: existing `CODECOV_TOKEN` secret and optional Codecov action.

1. Confirm documented GitHub secret-expression/condition semantics and Codecov
   authentication requirements. Existing hosted logs reproduce tokenless upload
   failure; coverage computation and artifact retention already pass.
2. Gate only the optional external upload on availability of its configured
   secret. Expose only the availability boolean to the job environment. Keep
   coverage execution, thresholds, artifact retention and workflow permissions.
3. Run `actionlint .github/workflows/ci.yml`, `npm run validate`,
   `npm run test:coverage:all`, and `npm run smoke:package`.
   Expected: all pass. No static text tests for this configuration-only change.
   Commit the focused CI/documentation change. Publish to the existing feature
   branch and inspect hosted CI, including the skipped upload when unconfigured.
   A skip is not successful Codecov publication; enabling it needs credentials.

## Review focus and completion

Review summary/detail separation, strict output behavior, ignored child names
without accidental broad ignores, tracked-child protection, and whether route
validation still catches drift rather than merely accepting arbitrary counts.
Review workflow secret scope, unchanged mandatory coverage checks, and CI/local
parity. Check that no live VM implementation or qualification gate changed.

Run the final independent review before pushing the final implementation.
Update the existing draft PRs and retain feature branches; do not merge or
release. Record local and hosted results, new-phase decisions and remaining
gaps here, then move the plan to completed and link it from the docs index.

## Completion evidence

AgentV `c94607a` corrects the mock summary output; `0bd62ea` gates only optional
Codecov publication. Parent `314ecad` corrects linked-workspace validation and
child-owned contract counts. Only the Linux mock and its contract test changed
under AgentV `src/` in this follow-up. Live Linux and Windows implementations,
installers and control-plane source are unchanged. Existing unrelated changes
in linked main checkouts were preserved.

| Check | Result |
| --- | --- |
| `npx vitest run src/tools/contracts.spec.ts` | New assertion failed on extra detail fields before the fix; 10/10 pass after it. |
| `npm run validate` | Pass: lint/typecheck, 256 tests/36 files, contracts, harness and build. |
| `npm run test:coverage:all` | Pass: 260 tests/37 files, 80.23% statements, 71.8% branches, 76.42% functions, 88.14% lines. |
| `npm run smoke:package` | Pass: archive and bootstrap failure-path checks; no asset published. |
| `actionlint .github/workflows/ci.yml` in AgentV and parent | Pass. |
| Parent `node --test scripts/harness/*.test.mjs` and `task validate` | Pass: four regressions plus every parent gate. The new regressions failed on old symlink/count/tracked-child behavior first. |
| Platform-admin `npm run requirements:check` | Pass read-only: its 29-route/eight-scope baseline agrees with runtime. |
| Independent final review | No Critical, Important or Minor findings; reviewer independently reran all four parent regressions. |

[Linux CI 41305615953](https://github.com/acornops/agentv/actions/runs/41305615953)
tested merge `65fad1ef8940269f17f33ad0062678da0653d881`, combining AgentV
`0bd62ea1540391ee4e8fe504f5f1553a54a1bd8b` with main `3d86cfc`. Validation,
260 coverage/E2E tests, package/bootstrap/curl compatibility and Ubuntu 24.04
Node 22/24 install/restart/upgrade/rollback/uninstall gates pass. The coverage
artifact upload succeeds; Codecov is correctly skipped because its credential
is unavailable. The authenticated external-upload path was not exercised.

[Parent CI 41305617865](https://github.com/acornops/acornops/actions/runs/41305617865)
tests `314ecad` through merge `3152c48`; harness, four regressions and title checks
pass. The updated PR title also passed the local Conventional Commits check.

Automatic Windows [collector CI 41305615972](https://github.com/acornops/agentv/actions/runs/41305615972)
and [service-host CI 41305615963](https://github.com/acornops/agentv/actions/runs/41305615963)
both pass all four OS/Node cells. The eight inspected native artifacts record
host reads of 5,110–7,600 ms, successful boundary and assignment-negative checks,
and 33 service-host checks per cell including LocalService reads and containment.
These are additional passing samples, not repairs for previous intermittent
native failures. No manual composition experiment or unchanged retry was run.

[Installer CI 41305615938](https://github.com/acornops/agentv/actions/runs/41305615938)
passes all 18 jobs at the same tested merge. All 22 artifacts were inspected:
each OS/Node cell records lifecycle 23, recovery 21, startup 9 and acceptance 21
checks. Both OS versions also pass 25 API-diagnostic cases, six generated HTTPS
wrapper cases and ten teardown-race checks. Native I/O in the API-helper fixture,
the wrapper's bootstrap and the installer backend are synthetic; these results
do not establish real-backend enrollment or power-cycle recovery.

## Decisions and remaining gaps

1. Native Windows timing, service-identity, concurrent-read, sizing and reboot
   qualification remain open. Their causes or required native environments have
   not been established by this follow-up. Cost: Windows rollout remains disabled;
   the previous failing evidence must not be replaced by later passing samples.
2. Shared outage-status repair stays behind its separate backend protocol design
   gate. A cross-store observation cannot yet safely authorize a recurring status
   writer. Cost: dependency/process loss can still leave stale online status for
   Linux and Windows VMs; ordinary reconnect behavior is unchanged.
3. Unconfigured Codecov publication is skipped, never labeled successful. GitHub
   coverage computation and its artifact remain required. Cost: external Codecov
   history needs a valid configured credential and a verified upload.

The reviewer deferred those three judgments to the executor; these decisions
resolve them. No review minors were deferred. Real reboot/power loss, minimum
VM sizing, Server Core/Desktop Experience and combined native-agent/real-backend
recovery still need disposable VM/staging qualification. Qualified Windows
release assets, activation and Windows writes remain outside this change.

Drafts remain [AgentV #8](https://github.com/acornops/agentv/pull/8) and
[parent #27](https://github.com/acornops/acornops/pull/27), on
`feat/windows-vm-support`. Merge order and related backend/console/docs drafts
remain as documented in those PRs. No merge, release, deployment or activation.
