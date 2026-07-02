# Component Charter

## Purpose

The AgentV gives AcornOps read-only operational visibility into Linux/systemd virtual machines through outbound connectivity, bounded host snapshots, and diagnostic JSON-RPC tools.

## Users Or Callers

- Control-plane agent bridge
- Operators viewing VM target health and diagnostics
- Coding agents and developers maintaining VM runtime behavior

## Responsibilities

- Connect outbound to the control-plane agent WebSocket.
- Authenticate with the VM target agent key.
- Send heartbeats and bounded host snapshots.
- Serve read-only VM diagnostic tools.
- Package a Linux/systemd service install path.
- Document AgentV/control-plane contracts.

## Non-Responsibilities

- Managing target registration or workspace membership.
- Running arbitrary shell commands.
- Mutating host files, packages, services, or processes.
- Owning central platform deployment.
- Supporting Windows or non-systemd hosts in v1.

## Success Criteria

- Agents can be installed on Linux/systemd VMs with protected environment configuration.
- The control plane can receive VM heartbeats, snapshots, and tool responses.
- Diagnostic data remains bounded, redacted, and read-only.
- Repository validation catches drift in contracts and harness documentation.
