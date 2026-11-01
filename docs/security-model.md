# Security Model

## Trust Boundaries

The unprivileged AgentV runs on a host with access to local system telemetry and connects outbound to the AcornOps control plane. Treat that authenticated WebSocket as the only remote command channel. Optional mutation crosses a separate root-owned local socket with an exact policy.

Read tools never execute arbitrary shell input. Linux `restart_service` is the only write tool: it is disabled by default, rejects AgentV's own units, requires an exact allowlist plus preconditions, and cannot perform arbitrary commands, package changes, process kills, or filesystem mutation. Windows registers no write tools.

Read-write onboarding snapshots the exact unit allowlist in the one-use
enrollment. Only the root installer receives that policy and enables the
privileged socket. Repair and ordinary credential replacement preserve it;
an explicit host-policy update installs its new token-bound snapshot. Every
path is transactional, so editing the copied command cannot widen host access
and a failed cutover restores the prior policy and socket state.

## Secrets

One-use enrollment tokens are accepted only by the bootstrap and exchanged for
a durable AgentV credential after non-mutating validation. Enrollment tokens,
transaction secrets, durable credentials, complete generated commands, and
environment contents must not enter logs. Durable credentials are read from
the Linux systemd environment file; keep `/etc/acornops/agentv.env` owned by
`root:acornops-agent` with mode `0640`.

Windows credentials live in protected `%ProgramData%\AcornOps\AgentV\config.json`.
Administrators/SYSTEM own the file; only the fixed service SID receives additional
read access. Transaction secrets and backups remain Administrators/SYSTEM-only.

Do not include agent keys, bearer tokens, SSH keys, cloud credentials, or password-like arguments in snapshots, tool responses, or test fixtures.

## Host Data Handling

Linux process command lines are truncated and token-like arguments are redacted.
Windows collectors omit command lines, environments and executable paths.
Host log reads are bounded by line count and byte count. Snapshot payloads are
bounded by `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES`.

Collectors should model OS family, service manager, log source, and collector mode explicitly so future adapters do not inherit Linux/systemd assumptions accidentally.

## Systemd Hardening

The installer discovers Node only at `/usr/bin/node` and `/usr/local/bin/node`.
It checks root ownership, non-writable group/world permissions, and every
symlink traversal before executing a version probe. Home-directory runtimes
are rejected. The selected canonical path is root-owned data, not a sourced
environment file, under `/opt/acornops/agentv/node-path`. The launcher repeats
trust/version checks at startup and execs Node, preserving the systemd main PID.
The root helper uses the same selection as the agent and doctor. Node preloads
from `NODE_OPTIONS` and `NODE_PATH` are cleared; no user PATH discovery is used.
Runtime selection participates in installer rollback and boot recovery.

The systemd unit runs as `acornops-agent` with:

- `NoNewPrivileges=true`
- `PrivateTmp=true`
- `PrivateDevices=true`
- `ProtectSystem=strict`
- `ProtectHome=true`
- kernel, control-group, namespace, realtime, and address-family restrictions

The main unit has no writable host path. Only the separate root helper receives
`ReadWritePaths=/var/lib/acornops-agentv/actions`, has no network namespace, and
serves the group-restricted Unix socket.

## Windows preview boundary

The SCM host runs as LocalService with a fixed service SID. It validates protected
runtime paths, clears ambient environment settings, and assigns Node to a
kill-on-close Job Object before sending private START. Only its state and log
directories are service-writable. Collectors run fixed PowerShell programs with
bounded JSON input; local Application/System allowlists govern event reads.
The elevated installer and SYSTEM recovery task are separate from the read-only
agent. See the [operations guide](OPERATIONS.md#windows-installer-preview-rollout-disabled)
for ownership/recovery rules and the [qualification decision](design-docs/windows-qualification-decision.md)
for unresolved release blockers.

## High-Risk Changes

- Adding write-capable tools or shell execution.
- Expanding log or process collection without new redaction tests.
- Changing agent key headers, handshake auth fields, or error logging.
- Changing systemd hardening settings.
- Adding persistent local state.

## Required Validation

Run `npm run validate` for security-sensitive changes. Add focused tests for new redaction, bounding, or host-access behavior.
