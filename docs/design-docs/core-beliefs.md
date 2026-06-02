# Core Beliefs

## Outbound-Only By Default

VM agents should not require inbound network access. They connect to the control plane and receive JSON-RPC requests over that established channel.

## Read-Only V1

The first VM agent surface is diagnostic. Tool handlers inspect host state but do not mutate packages, files, processes, services, or operating system configuration.

## Host Boundaries Are Explicit

OS family, service manager, log source, collector mode, and target type are explicit in config and contracts so future adapters can be added without hidden Linux/systemd assumptions.

## Stateless Recovery

Restarting the agent should be enough to recover from local process failure. The agent reconnects, re-handshakes, and resumes heartbeats and snapshots.
