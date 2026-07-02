# AgentV Design

## Product Principles

The AgentV should be boring to operate on production hosts: outbound-only, stateless, read-only by default, and explicit about every host boundary it crosses.

## Interaction Model

Operators register a VM target in the control plane, install the agent on the VM, provide the target id and agent key through a protected environment file, and observe host health through snapshots and read-only diagnostic tools.

The control plane requests diagnostics through JSON-RPC. The AgentV returns bounded host data and does not expose a general shell, package manager, process control, or service restart interface.

## Runtime Design Rules

- Keep host-specific behavior behind collector adapters.
- Keep tool handlers read-only and named by user-visible diagnostic intent.
- Bound snapshots, logs, and process lists before sending them to the control plane.
- Redact token-like process arguments and never log agent keys.
- Model OS family and service manager in config, contracts, and snapshots.

## Non-Goals

- Arbitrary remote shell execution.
- Package installation or OS patching.
- Process kills, service restarts, or filesystem mutation.
- Local durable queueing of snapshots or tool requests.
- Windows or non-systemd support in v1.

## Validation

Run `npm run validate` for design-sensitive changes. Add focused unit tests for new collectors, tool handlers, redaction rules, or payload bounds.
