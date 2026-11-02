# Systemd watchdog repair implementation plan

> Execute in this session with the executing-plans and test-driven-development skills.

**Goal:** Keep a healthy Linux AgentV alive by sending systemd's supported watchdog notification.

**Architecture:** Preserve the existing timer, environment allowlist, process timeout and service unit. Replace only the unsupported CLI option; exercise the command boundary and the packaged service's survival past its watchdog deadline.

**Tech stack:** TypeScript, Vitest, systemd, existing Ubuntu 24.04 CI on Node 22/24.

**Spec:** Preserve existing Linux behavior and satisfy systemd's `WATCHDOG=1` notification contract.

## Evidence and scope

- Released AgentV experimental.14 and experimental.15 both invoke the unsupported `systemd-notify --watchdog` option. The packaged unit uses `WatchdogSec=90s` and `RestartSec=5`.
- systemd rejects that option; missing watchdog notifications cause repeated service restarts even when authentication and transport heartbeats succeed.
- No API, credential, control-plane, Windows, service policy or timer changes.

## Review focus

The command must send a watchdog notification, keep failure reporting and the bounded child process, and preserve the no-notify-socket behavior. The live gate must detect restarts as well as a currently active service and require watchdog timestamp progress after startup.

## Task 1: Correct and verify the watchdog notification

Files: `src/systemd-notify.ts`, `src/systemd-notify.spec.ts`, `scripts/systemd-smoke.sh`, `docs/DEVELOPMENT.md`, plan indexes.

Interface: existing `notifyWatchdog(): Promise<boolean>`; no signature changes.

- [x] Add a command-boundary regression test expecting `WATCHDOG=1`; run `npx vitest run src/systemd-notify.spec.ts` and observe failure against the old option.
- [x] Extend the guarded live systemd smoke to observe the installed service for 100 seconds, require unchanged main PID/restart count, and require advancing `WatchdogTimestampMonotonic`.
- [x] Replace the unsupported argument and rerun the focused test. Preserve the existing command timeout and environment.
- [x] Run `npm run validate`, `npm run test:e2e`, `npm run smoke:package`, and `bash -n scripts/systemd-smoke.sh`; review the complete diff.
- [ ] Push the feature branch for the existing hosted Linux gates and review their results before any release.

## Rollout and rollback

An installed agent needs the corrected artifact; updating an installer pin alone does not upgrade it. Confirm its systemd unit and watchdog logs, preserve its identity/configuration, and validate continuous connection and read tools after an authorized update. Do not disable watchdog protection. Roll back the agent artifact if the update introduces a separate failure.

## Progress

- Branch: `fix/agentv-watchdog`, based on released main.
- Initial sandboxed baseline could not bind loopback sockets (EPERM). With loopback permitted, all 264 baseline tests passed.
- Regression test: one expected argument mismatch before the fix; all three notification tests pass after it.
- `npm run validate`: passed (266 unit tests, contracts, harness, lint/typecheck, build and 28 process/Windows fixtures). `npm run test:e2e`: four passed. `npm run smoke:package`, `bash -n scripts/systemd-smoke.sh` and `git diff --check`: passed.
- Independent review found no blockers. [Hosted CI](https://github.com/acornops/agentv/actions/runs/41371163660) passed at `af2c135`, including Node 22 and 24 native systemd gates: both completed 100 seconds without restart and with advancing watchdog timestamps, then passed the existing recovery/action scenarios.
- Prepare `0.0.1-experimental.16` with unchanged dependencies; rerun validation for that artifact, then publish through the existing release gate. Update downstream installer pins only after release assets are verified. Existing installations need an operator-run upgrade using their retained credentials.
- Completion and live verification: pending.
