# AgentV Architecture

## Purpose

The AgentV runs unprivileged on Linux/systemd virtual machines, connects outbound to the AcornOps control plane, sends bounded host snapshots, serves strict diagnostic tools, and can optionally request an exact allowlisted service restart from a separate root-owned helper.

This repository owns the VM-side runtime, host collector adapters, JSON-RPC tool registry, systemd packaging assets, Docker image, and AgentV contract docs. It does not own control-plane target registration, central deployment orchestration, or Kubernetes agent behavior.

## Runtime Boundaries

- Inbound interfaces: none from the network; the agent only receives messages on the outbound WebSocket it initiated.
- Outbound dependencies: AcornOps control-plane WebSocket endpoint, local Linux/systemd commands and files used by collectors.
- Local privileged interface: `/run/acornops-agentv/actions.sock`; absent in the read-only container image.
- Persistent stores: only the helper action ledger under `/var/lib/acornops-agentv/actions`.
- Background workers: transport ping/pong, heartbeat, bounded snapshot, and reconnect timers.
- External services: control plane at `ACORNOPS_AGENT_PLATFORM_URL`.

## Source Layout

```text
src/config.ts                 environment parsing and validation
src/index.ts                  process entrypoint and shutdown handling
src/adapters/                 narrow Linux, procfs, systemd, journald, filesystem, and socket adapters
src/actions/                  helper protocol, client, policy enforcement, and durable ledger
src/core/                     authenticated lifecycle and snapshot manager
src/mcp/                      JSON-RPC request router
src/tools/                    strict registry, schemas, executor, projection, and tool handlers
src/transport/                outbound WebSocket client
packaging/systemd/            Linux systemd install assets
docs/contracts/               AgentV/control-plane contract docs and manifest
scripts/                      repository harness and contract checks
```

## Data And Control Flow

1. `src/index.ts` loads local policy, chooses live or mock adapters, registers tools, and starts the lifecycle.
2. The transport connects to `<ACORNOPS_AGENT_PLATFORM_URL>/api/v1/agent/connect` with agent authentication headers.
3. The agent sends `lifecycle/handshake` with target identity, target type, OS family, service manager, and supported capabilities.
4. Only after the fixed-ID response validates target, workspace, policy, and remote bounds does the agent install a connection generation and begin heartbeats or snapshots.
5. The executor validates arguments before scope or host access, enforces policy/concurrency/deadlines/byte bounds, redacts output, and returns the standard MCP envelope.
6. The optional helper independently checks exact policy and service preconditions, persists `in_progress`, performs one restart, verifies post-state, and returns a minimal receipt.
7. Disconnect revokes queued/future work and stops telemetry before equal-jitter reconnect.

## Contracts

The control-plane dependency is documented in [`docs/contracts/README.md`](docs/contracts/README.md), with machine-readable counterpart metadata in [`docs/contracts/manifest.json`](docs/contracts/manifest.json).

Contract-sensitive changes include handshake fields, WebSocket paths or headers, snapshot payload shape, advertised capabilities, built-in tool names, and JSON-RPC request or response behavior. Update the matching control-plane contract docs in the same coordinated change when behavior changes across the boundary.

## Operational Model

The local development path uses Node.js 22 and `ACORNOPS_VM_COLLECTOR_MODE=mock` so contributors can run and test without a Linux/systemd VM. Production-like installs use the systemd assets in `packaging/systemd` and should keep secrets in `/etc/acornops/agentv.env`.

The main agent is stateless. The helper intentionally persists bounded operation receipts so reconnect retries are idempotent and crash-surviving in-progress writes remain unknown.

## High-Risk Areas

- Agent key handling and log redaction.
- Host log collection boundaries and byte limits.
- Snapshot size bounding and truncation behavior.
- Live Linux/systemd command adapters.
- Any change that adds write-capable host tools or shell execution.
- Reconnect behavior and timer cleanup.

## Validation

Run `npm run validate` before handoff. For contract-sensitive changes, also run `npm run contracts:check` and the workspace platform contract check from the parent workspace when available.
