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

Released as `v0.0.1-experimental.14` after the separately authorized release
follow-up below. Installed hosts still require an explicit upgrade; publishing
the artifact or redeploying the platform does not upgrade an enrolled VM.
Rollback is the previous AgentV artifact and restores the display-input failure;
no data migration is involved.

## Completion evidence — 2026-10-27

Implementation and local qualification were completed on `fix/restart-state-input`
before integration. Only AgentV source, regression tests, the existing systemd
smoke and related docs changed. No UI or platform runtime change was needed.

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
Linux/systemd execution cannot run on this macOS host; the disposable hosted
gate qualified it before publication, as recorded below. No enrolled VM was
upgraded and no service on that VM was restarted during validation.

## Release qualification — 2026-10-27

The user authorized direct integration to main, a new release and demo
redeployment. Source `5c96872154b9de536a51dc2b1416721e4722b5c2` was pushed to main
and tagged as
[`v0.0.1-experimental.14`](https://github.com/acornops/agentv/releases/tag/v0.0.1-experimental.14).
The version bump also updated the existing pinned-version configuration test;
the full suite passed again before commit.

[Main CI](https://github.com/acornops/agentv/actions/runs/40435632806) and the
[release workflow](https://github.com/acornops/agentv/actions/runs/40435950710)
both passed live Ubuntu 24.04 systemd gates on Node 22 and 24. They exercised
display-form restart, canonical replay, mismatched operation reuse,
stale/contradictory preconditions, installation, credential-preserving repair,
upgrade, rollback and uninstall preservation. Package and curl 7.68 checks passed.

The downloaded archive/bootstrap checksums and signed attestations match the
tag, source commit and hosted release workflow. Bootstrap and compiled input
normalization code match the locally tested artifacts. Image provenance matches
the same source; OCI index digest:
`sha256:91a1ea6844f8a366abac429b42380de53a004959905a3f87fd373526826696cb`.
An equal-database image scan against `.13` found no new HIGH/CRITICAL findings;
existing image findings remain outside this fix and are not waived for production.

Select `.14` in the platform installer configuration, then use **Upgrade or
repair AgentV** on each host. Confirm the connected version and start a fresh
troubleshooting run; do not reuse old arguments or approvals. Hosted systemd
acceptance does not claim a completed restart on the user's VM.
