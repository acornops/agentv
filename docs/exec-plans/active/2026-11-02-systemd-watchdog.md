# Systemd watchdog repair implementation plan

> Execute in this session with the executing-plans and test-driven-development skills.

**Goal:** Keep a healthy Linux AgentV alive by sending systemd's supported watchdog notification.

**Architecture:** Preserve the existing timer, environment allowlist, process timeout and service unit. Replace only the unsupported CLI option; exercise the command boundary and the packaged service's survival past its watchdog deadline.

**Tech stack:** TypeScript, Vitest, systemd, existing Ubuntu 24.04 CI on Node 22/24.

**Spec:** The reported demo VM chat failure and the requirement to preserve existing Linux behavior; systemd's `WATCHDOG=1` notification contract.

## Evidence and scope

- The demo VM socket closes after roughly 90 seconds, then reconnects roughly six seconds later. Redis ownership continues renewing until the socket closes.
- Installed AgentV experimental.14 and released experimental.15 both invoke the unsupported `systemd-notify --watchdog`; the host rejects that option. Its unit uses `WatchdogSec=90s` and `RestartSec=5`.
- A saved October 28 control-plane log also contains a VM disconnect/reconnect before the November 2 platform release. Agent-side logs still need correlation.
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

An installed agent needs the corrected artifact; updating the platform's installer pin alone does not upgrade it. Confirm its actual systemd unit and watchdog logs, preserve its identity/configuration, and validate continuous connection and read tools after an authorized update. Do not disable watchdog protection. Roll back the agent artifact if the update introduces a separate failure.

## Progress

- Branch: `fix/agentv-watchdog`, based on released main.
- Initial sandboxed baseline could not bind loopback sockets (EPERM). With loopback permitted, all 264 baseline tests passed.
- Regression test: one expected argument mismatch before the fix; all three notification tests pass after it.
- `npm run validate`: passed (266 unit tests, contracts, harness, lint/typecheck, build and 28 process/Windows fixtures). `npm run test:e2e`: four passed. `npm run smoke:package`, `bash -n scripts/systemd-smoke.sh` and `git diff --check`: passed.
- Native systemd cannot run on this macOS workstation; hosted Linux verification and independent review are pending.
- Completion and live verification: pending.
