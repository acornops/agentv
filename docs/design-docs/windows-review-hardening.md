# Windows review hardening

The user authorized the scoped remediation sequence on 2026-11-01 after the
critical review. Preserve Linux behavior and the existing single AgentV product.
Keep Windows activation and writes disabled. The current feature checkpoint is
AgentV `76bf021`, backend `3a1b969`, console `5eabc88`, and API docs `a39eb95`.

## Scope and approach

Use Windows-local fixes and executable compatibility checks. A common OS runtime
rewrite would increase Linux risk; copying more scheduler and validation logic
would preserve the drift that this review found. Share only pure Windows input
validation and test data where the current behavior warrants it. Independent
security validation at each service boundary remains necessary.

- A reconnect during cancellation must receive one fresh snapshot after the old
  collection finishes. Never send stale generations, overlap snapshot collections,
  or schedule work after stop. Repeated starts retain the newest interval/budget.
- Mock and live Windows log requests must enforce identical local channel,
  time-window, row and byte limits before native collection. Retain current live
  defaults and errors: at most 24 hours, up to 60 seconds of future skew,
  1..500 rows, and 1,024..1,048,576 bytes. Synthetic data remains labeled synthetic.
- Producer-generated snapshot and command fixtures must be checked against the
  real producer and consumed by actual backend/native tests. Each repo must have
  useful checks without a sibling checkout; the parent workspace compares copies.
  Include healthy, denied, unavailable, partial and truncated evidence. No new
  production protocol, schema version or shared runtime package is needed.
- Installer diagnostics must distinguish bounded failure categories without raw
  output, bodies, secrets, URLs, paths or exception messages. Preserve every
  existing success/uncertainty decision and HTTP availability/code/data value.
  Keep readability changes within the touched helper; no recovery-state rewrite.
- Measure overlapping native snapshot/tool demand before selecting a concurrency
  policy. Existing cold-start and LocalService failures remain qualification
  failures. A changed diagnostic must answer a new concrete hypothesis; a passing
  later sample does not establish a repair. No extra retries, prewarming or timeout
  increases. Actual reboot/Core/Desktop and combined native/backend qualification
  remain open under the user's hosted-CI choice.
- Shared offline-state reconciliation affects Linux and Windows. Investigate and
  prepare a separate backend plan with exact-identity, ownership-uncertainty,
  dependency-recovery and stale-observer tests before changing that shared path.

## Acceptance

Each deterministic defect has a failing behavioral regression before its minimal
fix, followed by targeted checks and independent review. Runtime changes retain
Linux catalog/config/lifecycle/package checks and the existing Ubuntu Node 22/24
live systemd gates. Native edits run on Server 2022/2025 and Node 22/24 as relevant.
No merge, release or activation is part of this work. Preserve failed artifacts
and report remaining qualification gaps separately from passing source checks.
