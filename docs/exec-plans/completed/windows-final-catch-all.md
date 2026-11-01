# Windows VM final catch-all

Status: source implementation and review complete. Scope: the existing coordinated `feat/windows-vm-support` branches.

## Spec and constraints

The approved final audit requires cautious fixes and removal of proven redundancy,
preserving Linux/AgentK behavior, legacy payloads, security boundaries and all
qualification failures. No deployment, Windows enablement, history rewrite or
unrelated cleanup. The preceding whole-feature audit is the design input; this
plan adds no new product behavior beyond fixing its reproduced defects.

## Task 1: AgentV process lifetime and test wiring

Add real-child regressions with the parent's control pipe held open, observe
failure, then release the owned input when the service entry finishes. Exercise
startup failure, protocol failure, early STOP and normal STOP. Wire the existing
HTTPS fixture regressions into validation. Remove only unused entry options and
re-exports. Verify focused regressions, Linux package smoke and full validation.
Expected: child exits promptly, without forced process termination, and existing
bounded startup/shutdown behavior remains covered.

## Task 2: VM onboarding connection freshness

Reproduce stale connected labels and confirmation using the real freshness
parser. Reuse the existing reported-status logic for onboarding, preserving
legacy degraded/online behavior and enrollment/policy authority. Verify unit and
affected browser tests plus console validation.
Expected: expired or unavailable connection evidence cannot confirm installation.

## Task 3: Backend redundancy

Verify the gateway already filters discovery at its authoritative boundary;
exercise real gateway filtering from synchronization and remove the duplicate
filter/query. Remove unused Windows snapshot type aliases. Verify affected
discovery/dispatch tests and full backend validation with isolated dependencies.
Expected: one discovery filter, unchanged persisted catalog and dispatch guards.

## Task 4: CI and documentation

Gate Windows jobs for documentation-only pull requests while retaining manual
dispatch and all relevant code/test/config changes. Test classification before
wiring workflows; validate workflow syntax. Correct stale implementation claims
and consolidate overlapping completion evidence into the qualification record,
retaining unique run IDs, decisions and failures. Keep diagnostic tooling while
the cold-call and composition failures remain unresolved.
Expected: focused CI without weakening native matrices or erasing evidence.

## Task 5: Final verification and handoff

Review the combined diff once with a fresh reviewer. Address substantiated
important findings with reproductions and checks. Run repository-required gates,
publish only to the existing feature branches/draft PRs, inspect exact-revision
hosted CI, and record remaining qualification limitations. Finish this plan and
retain its evidence before removing its temporary workspace.

## Interfaces and retained limits

- Tasks 1/4 share AgentV validation and Windows service-host CI: production entry
  process tests must run after build, including on native hosted Windows.
- Task 2 consumes the existing backend `connection` observation; no contract or
  enrollment state change is needed. Task 3 preserves that contract.
- Cold native timeouts, real reboot/power-loss, combined native deployment and
  exceptional retained-journal replacement qualification remain unresolved.
- Shared persistent outage-status repair remains separate from heartbeat reads.

## Evidence and handoff

- Service exit: five real-child cases fail with the old retained input, then pass
  with owned-input cleanup. Normal STOP waits for startup; early STOP is separate.
- `npm run validate`: 256 unit tests/36 files and 28 Node fixture cases pass,
  including actual HTTPS/PFX and process-exit checks. `npm run smoke:package`
  passes archive/bootstrap checks. Windows workflows pass `actionlint`.
- Console: 1,306 unit tests/238 files and all validation gates pass in
  control-plane mode. Twelve affected browser cases cover Linux/Windows
  onboarding, expiry, confirmation and collection health. Eight enrollment
  assertions failed before preserving stored-status eligibility, then pass.
- Backend: 24 focused discovery/dispatch/catalog tests pass, including the
  one-lookup regression (previously two). See the coordinated backend record for
  full PostgreSQL/Redis validation. Isolated integration-profile build and actual
  WebSocket AgentV/AgentK heartbeat/reconnect probes pass with metadata retained.
- Parent `task validate` passes all four workspace regressions and cross-repo
  contracts/runtime-truth gates. No API/schema/migration or AgentK source changed.
- Independent final review found no Critical/Important source issue. Its one
  minor coverage observation was addressed with the explicit startup handshake.
  The final self-check also preserved initial-enrollment eligibility. No minor
  finding is deferred. Exact-revision hosted results belong to the draft PRs;
  historical green matrices are not substituted for current source evidence.

The documented decisions are to reuse existing expiry timers, retain security
and recovery guards, keep diagnostic failures and prior branch history, and
consolidate duplicated evidence rather than discard unique checkpoints. The
user's final-polish authorization covers the small test correction. Local
sandbox socket restrictions and incomplete test-DB environment/name setup were
corrected without weakening tests; failed setup logs remain in the evidence.

Windows remains unqualified and disabled: native cold-call/composition and
LocalService failure causes, reboot/power loss, Core/Desktop, minimum-host sizing,
combined native/backend deployment/artifacts and exceptional retained-journal
replacement remain open. Persistent outage-status repair is separate from
heartbeat reporting. Future standalone modal callers must arrange expiry
updates, as both current callers do. Unrelated parent/admin work retains its
separate history. No merge, deployment, release or activation is included.
