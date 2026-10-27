# Restart State Input Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single focused task.

**Goal:** Accept an unambiguous systemd display state without weakening restart preconditions.
**Architecture:** Normalize the MCP input before the action client. Keep the privileged helper's exact state/instance comparisons, authorization and idempotency unchanged; report the mismatched field accurately.
**Tech Stack:** TypeScript, Zod, Vitest, existing systemd smoke.
**Spec:** The approved design below, from the user's 2026-10-27 request.

## Approved design and approaches

Validation-only would reject the display label but still depend on model recovery.
The approved approach deterministically accepts `active (running)` only when
`expected_sub_state` is `running`. Apply the same grammar to other machine-state
tokens, not a cron-specific exception. Never infer a state or invocation ID from
the live service, refresh expectations after approval, or repair contradictory
inputs. Error messages must describe mismatches without asserting a state change.

## Global constraints

- AgentV only; no UI, backend, permissions, dependencies or deployment changes.
- Preserve raw caller arguments; normalize a parsed copy before the action client.
- Canonical states remain preferred. Only lowercase machine tokens and exact
  `state (substate)` presentation syntax are accepted; malformed/conflicting
  values produce `INVALID_ARGUMENTS` before helper access.
- Keep helper requests, invocation IDs, operation IDs, allowlists, approvals,
  replay protection and write defaults unchanged. No wire-schema version bump.
- No live demo/production restart. Linux smoke runs only on disposable CI hosts.

## Review focus

Canonical and display forms; contradictory/malformed input including newlines;
stale active/sub states and invocation IDs; canonical idempotent replay; mocked
and live action paths must receive identical normalized expectations.

### Task 1: Normalize inputs and preserve the restart boundary

**Files:** `src/tools/index.ts`, tool contract tests, action helper/mock mismatch
messages and tests, `scripts/systemd-action-smoke.mjs`, operations/contract docs.
**Interfaces:** Existing `restart_service` inputs -> canonical `RestartRequest`;
existing helper result/error envelopes remain unchanged.

- [x] Add failing tests for display/canonical inputs, contradictory/malformed
  inputs before action access, untouched invocation IDs/caller arguments,
  end-to-end mock restart/replay and accurate helper mismatch messages.
- [x] Run focused tests; confirm failures identify missing normalization/error details.
- [x] Implement the minimal input transform and field-specific mismatch messages.
- [x] Extend the existing disposable-systemd smoke to call the real MCP executor
  with the display form, then verify replay and stale-state rejection.
- [x] Run `npm run validate`, `npm run test:e2e`, and `npm run smoke:package`
  in AgentV; run `node scripts/harness/check-platform-contracts.mjs` from the
  workspace root.
- [x] Review scope/security and update durable docs with validation and rollout limits.

## Rollout and completion

A future AgentV release and host upgrade are required. No deployment or host
mutation is authorized by this implementation step. Release acceptance includes
the existing disposable live-systemd CI gate; local macOS cannot run that gate.
Rollback is the previous AgentV artifact; no data migration is involved.

## Completion evidence — 2026-10-27

Implementation and local qualification are complete on `fix/restart-state-input`;
release qualification is not. Only AgentV source, regression tests, the existing
systemd smoke and related docs changed. No UI, platform or deployment change.

- Baseline `npm test`: 107 tests passed. New regression cases failed before
  implementation and passed afterward.
- `npm run validate`: passed lint/type checking, 132 tests, contracts, harness
  and build.
- `npm run test:e2e`: 4 tests passed.
- `npm run smoke:package`: archive, bootstrap and failure-path checks passed.
  The initial E2E/bootstrap attempts could not bind loopback sockets under the
  sandbox; both passed with permission for local test fixtures.
- Workspace `node scripts/harness/check-platform-contracts.mjs`: passed.
- `node --check scripts/systemd-action-smoke.mjs` and `git diff --check`: passed.
- Replayed the captured failing arguments through the compiled tool executor and
  helper with simulated host operations: display input succeeded, canonical
  replay returned the same receipt and stale invocation ID was rejected.
- Independent review found no actionable correctness or security issue.

Mock mode and simulated helper access were validated locally. Actual live
Linux/systemd execution (`npm run smoke:systemd`) remains a required disposable
Ubuntu CI gate before release; it cannot run on this macOS host. The existing
Node 22/24 CI matrix now exercises display input, canonical replay, mismatched
operation reuse and stale/contradictory preconditions through the real helper.
No demo service was restarted, no release published and no host upgraded.
Installed `experimental.13` agents remain unchanged until a newer release is
published, selected by the platform and installed on each host.
