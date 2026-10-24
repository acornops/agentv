# AgentV Node Runtime Selection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** Accept trusted system-wide Node 22+ without pinning AgentV to the OS's
older `/usr/bin/node`.

**Architecture:** One shell launcher/library validates and selects Node, retains
the absolute selection in root-owned state, and execs it without changing the
service PID. The existing installation transaction snapshots this one additional
state item; no agent protocol or TypeScript runtime changes are needed.

**Tech Stack:** Bash, GNU coreutils, systemd, existing Node smoke scripts.

**Spec:** [Approved design](node-runtime-selection.md).

## Global Constraints

- Node.js 22 remains the minimum supported major version.
- Discovery candidates are `/usr/bin/node` and `/usr/local/bin/node` only.
- No user-writable executable, ancestor, or symlink traversal is trusted.
- No automatic dependency installation, host Node replacement, API changes,
  credential changes, publication, or deployment.
- Work in the current checkout on `fix/agentv-node-runtime-path`, following the
  user's existing preference. Keep changes uncommitted for review unless asked
  to commit; the completion record supplies the validation evidence.

## Review Focus

- A symlink may traverse an unsafe directory even if its final target is safe.
- Node preload environment variables must not affect privileged probes/launch.
- Missing state in legacy installations/transactions means `/usr/bin/node`,
  not permission to rediscover an arbitrary runtime on service start.
- First-install rollback can leave recovery pending after local state removal;
  recovery must retain access to its candidate runtime to query remote status.
- Service launch under the unprivileged identity must read the selected path
  without widening `/etc/acornops` permissions or changing systemd hardening.

### Task 1: Trusted runtime selection and launch

**Files:** create `packaging/systemd/acornops-agentv-node` and
`scripts/node-runtime-smoke.sh`.

**Interfaces:** shell functions `agentv_node_validate PATH` (canonical path on
stdout), `agentv_node_select` (pinned path or fixed candidate discovery),
`agentv_node_current` (pinned path or legacy `/usr/bin/node`),
`agentv_node_save PATH` (atomic root-owned `/opt/acornops/agentv/node-path`).
Executing the launcher forwards argv with `exec` to the current runtime.

- [x] Write Linux regression tests using disposable root-owned fixture paths:
  old system Node/new local Node, deterministic preference, no valid candidate,
  unsafe ownership/modes/ancestors/intermediate symlinks, broken/cyclic links,
  pin persistence, invalid pin failure, legacy default, and preload suppression.
- [x] Run `bash scripts/node-runtime-smoke.sh` in an isolated Linux container;
  expect failure before the selector exists.
- [x] Implement the selector/launcher with no new dependencies, bounded symlink
  traversal, and a fixed tool PATH. Keep data files non-executable/non-sourced.
- [x] Repeat the regression command; expect all assertions to pass.

### Task 2: Installer, recovery, service wiring, and documentation

**Files:** bootstrap/archive installers, worker, recovery, doctor, both service
units, uninstall, package/bootstrap/systemd smoke scripts, harness check,
CI/release workflows, README, operations/security/development docs.

**Interfaces:** consume Task 1 functions; install launcher at
`/usr/local/libexec/acornops-agentv-node`. Save `previous-node-path` and
`candidate-node-path` in the existing root-only transaction directory before
cutover. Recovery uses candidate runtime for remote status even after an initial
local rollback; restoration updates runtime state before restarting services.

- [x] Extend executable installer/recovery regression tests for the mixed-path
  layout, pinned repair, initial rollback, prior-runtime rollback, and legacy
  transaction restoration; verify failures against the unwired implementation.
- [x] Select Node after checksum-verified extraction but before enrollment.
  Wire every production invocation to the selected runtime/launcher; add runtime
  state snapshots, atomic restore, and first-install cleanup.
- [x] Adapt bootstrap smoke to the new preflight location; retain all checksum,
  archive safety, secret-redaction, and enrollment-order checks.
- [x] Exercise read-only and allowlisted read-write through the existing Ubuntu
  live-systemd smoke. Add Node 22/24 CI coverage with an older system-node fixture
  and a root-owned supported local Node (never trust runner-owned tool caches).
- [x] Update runtime prerequisites, diagnostics, security assumptions, and
  developer validation instructions. Review downstream demo guide separately;
  published `.6` still has its original prerequisite until a new release ships.
- [x] Run `npm run validate`, `npm run test:coverage:all`,
  `npm run smoke:package`, shell syntax checks, Linux selector/install/recovery
  regressions, and `git diff --check`; expect exit 0.
- [x] Request one fresh whole-change code review, address correctness/security
  findings with regression tests, and record any unavailable live-systemd gate.
- [x] Move the design/plan to completed only when implementation and available
  validation pass; report release gates separately and leave publishing alone.

## Completion evidence — 2026-10-24

Branch: `fix/agentv-node-runtime-path`, based on `f2c2160`. At the implementation
handoff, product changes were uncommitted for user review; no release, push,
merge, or deployment had been made.
No TypeScript runtime, package, lockfile, API, or credential-policy changes.

Passed:

- `npm run validate`: lint/type validation, 74 unit tests, contracts, harness,
  and build.
- `npm run test:coverage:all`: 78 tests including local WebSocket E2E;
  statements 75.99%, branches 64.16%, functions 70.76%, lines 83.56%.
- `npm run smoke:package`: checksummed archive, dependency closure,
  executable launcher, bootstrap safety and failure paths. The localhost test
  server required execution outside the macOS sandbox.
- `shellcheck` and `bash -n` on all changed shell scripts; `git diff --check`.
- `CI=true AGENTV_NODE_SMOKE_ALLOW=true bash scripts/node-runtime-smoke.sh`:
  root-owned Linux fixtures with actual Node 22.23.1 and 24.17.0; both passed.
- `CI=true AGENTV_SYSTEMD_SMOKE_ALLOW=true bash scripts/prepare-node-runtime-smoke.sh`
  followed by `CI=true AGENTV_SYSTEMD_SMOKE_ALLOW=true bash scripts/systemd-smoke.sh`:
  both Node majors passed on Ubuntu 24.04 arm64 with real PID-1 systemd in
  disposable Docker containers. Live collectors, service identity, main process,
  doctor, allowlisted helper restart, credential replacement, same-version
  repair, upgrade, first-install rollback, committed/uncommitted recovery,
  prior-runtime restoration, legacy recovery, and uninstall were exercised.

The original packaged bootstrap failed on the mixed-runtime fixture with
`Node.js 22 or newer is required at /usr/bin/node`. The corrected bootstrap
passed on that same layout. A fresh reviewer found one compatibility issue:
legacy recovery could consult an unrelated invalid current runtime pin. The
strengthened test reproduced the failure, and both complete lifecycle reruns
passed after changing legacy fallback to validate `/usr/bin/node` explicitly.
No other actionable review findings or deferred minor findings remained.

Scope decisions and remaining release work:

- Kept changes uncommitted and unpublished: the request authorized a scoped
  fix, not integration or deployment. A new immutable AgentV release and
  deployed installer-version update are still required for the user's VM to
  receive it. The demo guide remains correct for deployed `.6` and is unchanged.
- Kept dependency-major upgrades, other OS qualification, and broader existing
  transaction architecture outside this change. These were not prerequisites
  for the Node-path fix and must not be mistaken for reviewed release approval.
- Hosted Ubuntu VM CI/release gates were updated for Node 22 and 24 but were
  not run remotely because nothing was pushed. A real VM power-cycle recovery
  canary remains required by the existing release policy; container tests do not
  replace it.
- `npm audit --omit=dev` reports pre-existing high-severity Zod advisory
  `GHSA-mrhx-c7xc-m3w5`, requiring a separately reviewed major-version migration
  or other justified remediation before production promotion. Recorded in the
  tech-debt tracker and quality notes; no unrelated dependency upgrade included.

## Integration authorization — 2026-10-25

The user requested a local merge to `main` and a release so generated VM
installers use the fix. Prepare immutable `v0.0.1-experimental.7`; its package
and lockfile versions change together, with no dependency updates. Fresh local
validation, coverage, package/bootstrap smoke, shellcheck, and shell syntax
checks passed before integration. Publish only through the existing release
workflow after both hosted Ubuntu 24.04 Node 22/24 systemd gates pass.

The demo can select the new installer through the existing chart's
`targetAgents.agentv.systemd.version` setting. No control-plane image, chart,
API, database migration, VM runtime installation, or demo reset is required.
The Zod advisory and physical reboot acceptance remain production-promotion
work, not waived by this experimental release.

### Hosted fixture correction

Release run `40117138830` at `4749ede` passed unit and package/bootstrap checks,
then stopped because the hosted runner's `/opt` did not meet the root-owned,
non-writable ancestor requirement. No `.7` installer or image was published.
The same failure was reproduced in a disposable Linux container by making its
`/opt` world-writable. The explicitly opted-in CI preparation now creates that
root with root ownership and mode `0755`, matching a normal Ubuntu install
host. No production validation is weakened and shipped runtime logic is unchanged.

Use a new immutable `.8` tag with matching package, lockfile and test versions;
leave `.7` unchanged. Re-run the regression, full validation and package checks,
and require both hosted systemd gates before updating the demo pin. The corrected
writable-`/opt` regression, full validation, 78-test coverage, package/bootstrap
smoke, shellcheck and shell syntax checks passed locally for `.8`.
