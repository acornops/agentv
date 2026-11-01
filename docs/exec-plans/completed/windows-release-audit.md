# Windows VM release audit

> For agentic workers: use `superpowers:executing-plans` for this focused audit.

**Goal:** audit the coordinated VM feature before release, repair demonstrated
defects, and reconcile current documentation with implementation and evidence.

**Architecture:** preserve the Linux runtime and existing OS boundaries. Review
the complete feature diff, then change only reproduced defects or inaccurate
documentation. Retain native qualification failures and default-off rollout.

**Tech stack:** TypeScript, PowerShell/C#, PostgreSQL/Redis, React, hosted CI.

**Spec:** the user's final release-audit request and
[qualification decision](../../design-docs/windows-qualification-decision.md).

## Global constraints

- Work only on the existing `feat/windows-vm-support` branches.
- Preserve Linux/AgentK behavior and legacy contracts; keep Windows read-only.
- No merge, release, deployment, activation, or speculative timeout/locking fix.
- Reproduce behavioral findings before fixing; keep documentation edits concise.

## Review focus

- Older agents and missing/stale heartbeat observations across reconnects.
- Windows service startup, stop, and recovery with retained state or lost replies.
- Partial Windows telemetry reaching APIs and UI without healthy/empty inference.
- Feature-off registration, artifacts, policy and rollback compatibility.
- Operator instructions and support claims matching executable paths and evidence.

## Task 1: Whole-feature assessment

- [x] Compare AgentV, backend, console and public docs with their feature bases.
- [x] Trace the review-focus paths and check existing coverage and known gaps.
- [x] Record confirmed findings, rejected hypotheses and minimal proposed fixes.

## Task 2: Focused fixes and documentation

- [x] For each behavior defect, add a regression and observe RED before fixing.
- [x] Apply only the smallest verified fix; run its affected tests.
- [x] Reconcile current guides/contracts and remove proven redundant changes.

## Task 3: Verification and handoff

- [x] Run required repository/workspace checks for the final changes.
- [x] Obtain one fresh read-only review of the complete feature and audit diff.
- [x] Verify any required review fixes and inspect final runtime CI evidence.
- [x] Record release limits, complete this plan, and update existing draft PRs.

## Evidence

The fresh whole-feature review found one Important defect: the backend closes
provisional sockets immediately, while the native fixture left them open. Four
actual-runtime publications lasted 0.55–1.58 ms and all eleven 500 ms polls missed
them. Three regressions failed before a Windows-only verification-receipt fix.
The installer retains its existing 30-second, phase/launch/config and authenticated
backend-status checks. Active readiness still clears on disconnect; stop/new
launch clears either phase. Linux and backend runtime code are unchanged.
The corrected native fixture now closes provisional sockets immediately.

Eighteen focused regressions pass, including actual socket close/retry/activation/
stop and Linux generation/retry controls. Full AgentV validation passes 264 unit
cases plus 28 Node fixtures; coverage passes 268 tests and all floors; Linux
archive/bootstrap smoke passes. Backend validation uses isolated PostgreSQL/Redis
and passes 1,769 tests with none skipped. Console validation passes 1,306 tests.
Public docs validation and link checks pass; parent validation passes all four
workspace regressions. Console hosted CI also passes all eight browser jobs and
335 fixtures. Its optional Codecov upload still lacks `lcov.info`; computed
coverage and the GitHub artifact are present. This pre-existing CI-only gap is
outside the focused VM repair; no successful external upload is claimed. Final
documentation checks pass. Hosted runtime evidence is recorded below;
any automatic repeat after the documentation closeout is tracked in the draft PR.

Documentation corrections reconcile implemented preview scope, protected Windows
state/credentials, local log permissions, Linux Node path selection, API connection
evidence and test-database setup. No reviewed recovery/OS/security guard was
removed merely to reduce line count. Duplicated README preview guidance was
consolidated; no safe runtime removal was justified beyond earlier audited trims.
The reviewer found no other Critical, Important or Minor issue. The single fix
pass is self-verified; no second reviewer is used. Historical native failures,
real-host qualification and separate persisted outage-status repair stay open.

## Hosted runtime checkpoint

AgentV source `582e3e6016a8e7e0a8bf6b20ae7cd209bbdbe329`, tested merge
`afc4ab2c1b77d7e7c0188f53288e8695e23b83c1`:

- [Linux CI](https://github.com/acornops/agentv/actions/runs/41347844767):
  268 tests, coverage floors and both live Ubuntu 24.04 Node 22/24 lifecycle gates.
- [Collectors](https://github.com/acornops/agentv/actions/runs/41347844757) and
  [service host](https://github.com/acornops/agentv/actions/runs/41347844863):
  all four Windows Server 2022/2025 × Node 22/24 cells pass. All eight artifacts
  verify; host evidence has 33 assertions per cell.
- [Installer](https://github.com/acornops/agentv/actions/runs/41347844861):
  19/19 jobs and all sixteen scenarios pass. All 22 artifacts verify; each
  OS/Node pair has lifecycle 23, recovery 21, startup 14 and acceptance 22 checks.
  Actual verification rejects both evidence phases older than 30 seconds.
- [Candidate](https://github.com/acornops/agentv/actions/runs/41347844851):
  both assets/sidecars and all 918 manifest entries verify; Windows runtime files
  match the local build. The candidate remains explicitly unqualified.
- Current [backend CI](https://github.com/acornops/control-plane/actions/runs/41347873824)
  at `0066197`, [console CI](https://github.com/acornops/management-console/actions/runs/41347875613)
  at `25d0e92`, and [public docs CI](https://github.com/acornops/docs-website/actions/runs/41347876434)
  at `1ad882c` pass. These audit follow-ups change documentation only.

Commands: AgentV `npm run validate`, `npm run test:coverage:all`,
`npm run smoke:package`, and `npx vitest run src/windows-readiness.spec.ts src/windows-provisional-readiness.spec.ts src/windows-runtime.spec.ts src/core/provisional-generation.spec.ts`; backend
`npm run db:migrate` then `npm run validate` with explicit isolated test URLs;
console `VITE_APP_DATA_MODE=control-plane npm run validate`; public docs
`npm run validate` and `npm run links`; parent `task validate`. Final Markdown
changes pass `npm run harness:check`, `npm run contracts:check`, `git diff --check`
and local-link verification. Local live Windows/systemd execution was unavailable
on macOS; hosted CI supplies native coverage. Local host observations are mock.
Actual reboot/power loss and combined native deployment remain unexecuted.

The only new production repair is in two Windows files, with 12 added and four
removed lines. No shared lifecycle, Linux adapter/installer, AgentK, backend or
console runtime source changes in this audit. No timeout/locking policy was
changed without a demonstrated cause. No new reviewer finding is deferred;
the existing optional console Codecov gap and qualification/status-repair gaps
remain explicit. Linux staging power-cycle acceptance and patched-runtime
publication remain operational gates. Only the audit-owned PostgreSQL/Redis
containers were removed; existing stacks, worktrees and unrelated edits remain.
