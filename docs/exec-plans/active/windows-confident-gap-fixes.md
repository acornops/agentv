# Deterministic follow-up fixes for Windows VM work

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
