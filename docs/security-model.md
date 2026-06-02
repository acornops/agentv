# Security Model

## Trust Boundaries

The VM agent runs on a host with access to local system telemetry and connects outbound to the AcornOps control plane. Treat the control-plane WebSocket as the only remote command channel and keep all host operations behind explicit read-only tool handlers.

V1 tools are read-only. The agent never executes arbitrary shell input from the control plane and must not add sudo, package changes, process kills, service restarts, or filesystem mutation without a reviewed contract and security change.

## Secrets

Agent keys are read from environment variables or systemd environment files and redacted in logs. Keep `/etc/acornops/vm-agent.env` owned by `root:acornops-agent` with mode `0640`.

Do not include agent keys, bearer tokens, SSH keys, cloud credentials, or password-like arguments in snapshots, tool responses, or test fixtures.

## Host Data Handling

Process command lines are truncated and token-like arguments are redacted. Host log reads are bounded by line count and byte count. Snapshot payloads are bounded by `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES`.

Collectors should model OS family, service manager, log source, and collector mode explicitly so future adapters do not inherit Linux/systemd assumptions accidentally.

## Systemd Hardening

The systemd unit runs as `acornops-agent` with:

- `NoNewPrivileges=true`
- `PrivateTmp=true`
- `ProtectSystem=strict`
- `ProtectHome=read-only`
- `ReadWritePaths=/var/lib/acornops-vm-agent`

Keep additional writable paths out of the unit unless the runtime need is documented and reviewed.

## High-Risk Changes

- Adding write-capable tools or shell execution.
- Expanding log or process collection without new redaction tests.
- Changing agent key headers, handshake auth fields, or error logging.
- Changing systemd hardening settings.
- Adding persistent local state.

## Required Validation

Run `npm run validate` for security-sensitive changes. Add focused tests for new redaction, bounding, or host-access behavior.
