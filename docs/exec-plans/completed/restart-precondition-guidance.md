# Restart precondition guidance

Approved scope: describe the exact `get_service.restart_preconditions` values
required by `restart_service`. Never invent invocation IDs or combine active/sub
states. Refresh the read after a precondition failure. Keep all input shapes,
allowlists, approval requirements and helper checks unchanged.

Part of `fix/approval-resume-reliability` with control-plane and execution-engine;
the local central plan is
`acornops-workspace/change-sets/active/approval-resume-reliability.md`.
No installer or deployment changes. Implementation and independent review are
complete. Included in experimental.13 release preparation; live systemd and
artifact release gates must pass before publishing. Deployment acceptance is
recorded in the deployment repository's
`docs/exec-plans/completed/approval-resume-release.md` after rollout.

## Validation (2026-10-27)

- `npm run validate`: passed; 107 tests, type, contract, documentation and build checks.
- `npm run test:e2e`: passed; 4 local mock transport tests.
- The advertised-guidance regression failed before the descriptions were added.
  Both formatted state (`active (running)`) and invented invocation IDs still
  fail before any restart or ledger mutation.
- Collector validation used `mock`, not a live Linux/systemd host. No service was
  restarted. Existing allowlist, approval and privileged-helper checks are unchanged.

Release and upgrade AgentV before expecting this guidance in discovered tools.
Descriptions guide the model; runtime precondition checks still reject bad input.
