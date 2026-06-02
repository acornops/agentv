# Operations

The VM agent is outbound-only. It connects to
`ACORNOPS_AGENT_PLATFORM_URL/api/v1/agent/connect`, performs a
`lifecycle/handshake`, sends heartbeats, uploads bounded host snapshots, and
serves read-only JSON-RPC tool calls.

Linux/systemd installs use `packaging/systemd/acornops-vm-agent.service` and
`/etc/acornops/vm-agent.env`. Keep the env file owned by `root:acornops-agent`
with mode `0640`.

## Runtime Requirements

- Node.js 22 or a container image built from this repository.
- Linux with systemd for `ACORNOPS_VM_COLLECTOR_MODE=live`.
- Network egress from the VM to the AcornOps control-plane WebSocket endpoint.
- An agent key scoped to the registered VM target.
- HTTPS transport to the control plane. Plaintext `http://` requires the
  explicit local-development override and must not be used in production.

## Systemd Model

The service runs as `acornops-agent` with `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, and `ProtectHome=read-only`. Keep writable state limited to `ReadWritePaths=/var/lib/acornops-vm-agent`.

Operational files:

- Unit: `packaging/systemd/acornops-vm-agent.service`
- Environment template: `packaging/systemd/vm-agent.env.example`
- Install helper: `packaging/systemd/install.sh`
- Uninstall helper: `packaging/systemd/uninstall.sh`

## Logs And Diagnostics

Use journalctl for systemd installs:

```bash
journalctl -u acornops-vm-agent -f
```

The agent logs startup configuration without secrets, WebSocket connection status, handshake acknowledgement, snapshot upload summaries, snapshot collection failures, and WebSocket errors.

## Failure Modes

- Control plane unavailable: the WebSocket closes or fails to connect and the agent retries after a short delay.
- Host collector unavailable: snapshot collection logs a warning and retries on the next interval.
- Oversized snapshot: logs and process lists are truncated until the payload fits `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES`.
- Invalid configuration: startup fails fast with a clear environment-variable error.

## Rollback

Systemd installs can roll back by restoring the previous `/opt/acornops/vm-agent` release directory and restarting the service:

```bash
systemctl restart acornops-vm-agent
```
