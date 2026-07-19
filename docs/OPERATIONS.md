# Operations

The AgentV is outbound-only. It connects to
`ACORNOPS_AGENT_PLATFORM_URL/api/v1/agent/connect`, performs a
`lifecycle/handshake`, sends heartbeats, uploads bounded host snapshots, and
serves strict JSON-RPC tool calls. It remains read-only unless local, remote,
and helper policy all enable `restart_service`.

Linux/systemd installs use `packaging/systemd/acornops-agentv.service` and
`/etc/acornops/agentv.env`. Keep the env file owned by `root:acornops-agent`
with mode `0640`.

For a control plane signed by a private CA, place the PEM bundle in a
root-managed readable path and set `ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE`.
AgentV adds it to Node.js's normal public roots and keeps certificate and
hostname verification enabled.

## Runtime Requirements

- Node.js 22 or newer at `/usr/bin/node`, or a container image built from this
  repository. The installer validates the systemd runtime path and major version.
- Linux with systemd for `ACORNOPS_VM_COLLECTOR_MODE=live`.
- Network egress from the VM to the AcornOps control-plane WebSocket endpoint.
- An agent key scoped to the registered VM target.
- HTTPS transport to the control plane. Plaintext `http://` requires the
  explicit local-development override and must not be used in production.

## Systemd Model

The main service runs as `acornops-agent` with readiness/watchdog notification,
`NoNewPrivileges`, private devices, kernel protections, restricted namespaces,
and explicit address families. The separate helper runs as root with no network
access and may write only its bounded action ledger.

Systemd starts Node as the tracked main process. Node invokes the fixed
`/usr/bin/systemd-notify` binary for bounded readiness and watchdog messages;
`NotifyAccess=all` permits those short-lived notifier children from this
service cgroup. Releases need no target-side compiler or native addon build.

Operational files:

- Unit: `packaging/systemd/acornops-agentv.service`
- Helper: `packaging/systemd/acornops-agentv-actions.socket` and `.service`
- Environment template: `packaging/systemd/agentv.env.example`
- Install helper: `packaging/systemd/install.sh`
- Uninstall helper: `packaging/systemd/uninstall.sh`

The installer adds `acornops-agent` to `systemd-journal` when that group exists.
Run `sudo acornops-agentv-doctor` to verify configuration, binaries, journal
access, filesystem collection, TLS, and optional helper policy. The wrapper
drops privileges before checking host access, so its result reflects the actual
`acornops-agent` service identity rather than root's permissions.

## Optional service restart

Writes are disabled by default. To enable one service, set
`ACORNOPS_AGENT_WRITE_ENABLED=true`, add its exact `.service` name to root-owned
`/etc/acornops/agentv-actions.json`, and enable
`acornops-agentv-actions.socket`. Globs, aliases, AgentV's own units, arbitrary
commands, sudo, and unrestricted `systemctl` are rejected.

## Logs And Diagnostics

Use journalctl for systemd installs:

```bash
journalctl -u acornops-agentv -f
```

The agent logs startup configuration without secrets, WebSocket connection status, handshake acknowledgement, snapshot upload summaries, snapshot collection failures, and WebSocket errors.

## Failure Modes

- Control plane unavailable: the agent reconnects with capped equal-jitter exponential backoff.
- Host adapter unavailable: collector health reports degraded/unavailable rather than a successful empty result.
- Oversized snapshot: optional entries are deterministically trimmed, then the snapshot is dropped if compressed bytes still exceed the negotiated hard limit.
- Ambiguous restart: the helper/executor reports `outcome: unknown`; the action is never marked retryable.
- Invalid configuration: startup fails fast with a clear environment-variable error.

## Rollback

Systemd installs can roll back atomically by replacing
`/opt/acornops/agentv/current` with a symlink to a preserved release and then
restarting the main service. Stop any currently active socket helper so the next
socket activation starts it from the selected release:

```bash
ln -s /opt/acornops/agentv/releases/<version> /opt/acornops/agentv/.rollback
mv -Tf /opt/acornops/agentv/.rollback /opt/acornops/agentv/current
systemctl restart acornops-agentv.service
systemctl stop acornops-agentv-actions.service
```

The action socket remains enabled and starts the selected helper on the next
request. Configuration, action policy, ledger, and prior releases are preserved
by both upgrade and uninstall.
