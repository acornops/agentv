# Component Charter

## Purpose

The AgentV gives AcornOps operational visibility into Linux/systemd virtual machines through outbound connectivity, bounded host snapshots, strict diagnostic tools, and an optional allowlisted service restart.

An additive Windows/SCM implementation provides read-only diagnostics and native
service packaging. It remains disabled pending [qualification](../design-docs/windows-qualification-decision.md).

## Users Or Callers

- Control-plane agent bridge
- Operators viewing VM target health and diagnostics
- Coding agents and developers maintaining VM runtime behavior

## Responsibilities

- Connect outbound to the control-plane agent WebSocket.
- Authenticate with the VM target agent key.
- Send heartbeats and bounded host snapshots.
- Serve read-only VM diagnostic tools and one disabled-by-default helper-backed restart tool.
- Package a Linux/systemd service install path.
- Maintain the isolated Windows read-only runtime and preview SCM installer.
- Document AgentV/control-plane contracts.

## Non-Responsibilities

- Managing target registration or workspace membership.
- Running arbitrary shell commands.
- Host mutations beyond the reviewed Linux restart tool and installation lifecycle.
- Owning central platform deployment.
- Windows write tools, unqualified Windows production rollout, or other host families.

## Success Criteria

- Agents can be installed on Linux/systemd VMs with protected environment configuration.
- The control plane can receive VM heartbeats, snapshots, and tool responses.
- Diagnostic data remains bounded and redacted; writes remain exact, approved, idempotent, and locally allowlisted.
- Repository validation catches drift in contracts and harness documentation.
