# AgentV Architecture

## Purpose

The AgentV runs on Linux/systemd virtual machines, connects outbound to the AcornOps control plane, sends bounded host snapshots, and serves read-only diagnostic tools over the shared JSON-RPC agent bridge.

This repository owns the VM-side runtime, host collector adapters, JSON-RPC tool registry, systemd packaging assets, Docker image, and AgentV contract docs. It does not own control-plane target registration, central deployment orchestration, or Kubernetes agent behavior.

## Runtime Boundaries

- Inbound interfaces: none from the network; the agent only receives messages on the outbound WebSocket it initiated.
- Outbound dependencies: AcornOps control-plane WebSocket endpoint, local Linux/systemd commands and files used by collectors.
- Persistent stores: none in the agent process; systemd installs may use `/var/lib/acornops-agentv` for future local runtime state.
- Background workers: heartbeat timer, snapshot timer, reconnect timer.
- External services: control plane at `ACORNOPS_AGENT_PLATFORM_URL`.

## Source Layout

```text
src/config.ts                 environment parsing and validation
src/index.ts                  process entrypoint and shutdown handling
src/collectors/               live Linux/systemd and mock host collectors
src/mcp/                      JSON-RPC request router
src/tools/                    read-only diagnostic tool registry and handlers
src/transport/                outbound WebSocket client
packaging/systemd/            Linux systemd install assets
docs/contracts/               AgentV/control-plane contract docs and manifest
scripts/                      repository harness and contract checks
```

## Data And Control Flow

1. `src/index.ts` loads environment configuration, chooses the live or mock collector, and starts `AgentVClient`.
2. `AgentVClient` connects to `<ACORNOPS_AGENT_PLATFORM_URL>/api/v1/agent/connect` with agent authentication headers.
3. The agent sends `lifecycle/handshake` with target identity, target type, OS family, service manager, and supported capabilities.
4. After handshake acknowledgement, the agent sends periodic `lifecycle/heartbeat` notifications and bounded `notify/snapshot` payloads.
5. Control-plane JSON-RPC tool requests are routed through `src/mcp/router.ts` to read-only tool handlers in `src/tools`.
6. If the WebSocket closes, timers are cleared and the client reconnects after a bounded delay.

## Contracts

The control-plane dependency is documented in [`docs/contracts/README.md`](docs/contracts/README.md), with machine-readable counterpart metadata in [`docs/contracts/manifest.json`](docs/contracts/manifest.json).

Contract-sensitive changes include handshake fields, WebSocket paths or headers, snapshot payload shape, advertised capabilities, built-in tool names, and JSON-RPC request or response behavior. Update the matching control-plane contract docs in the same coordinated change when behavior changes across the boundary.

## Operational Model

The local development path uses Node.js 22 and `ACORNOPS_VM_COLLECTOR_MODE=mock` so contributors can run and test without a Linux/systemd VM. Production-like installs use the systemd assets in `packaging/systemd` and should keep secrets in `/etc/acornops/agentv.env`.

The agent is intentionally stateless. Restarting the process reconnects, re-handshakes, and resumes heartbeats and snapshots without requiring local recovery.

## High-Risk Areas

- Agent key handling and log redaction.
- Host log collection boundaries and byte limits.
- Snapshot size bounding and truncation behavior.
- Live Linux/systemd command adapters.
- Any change that adds write-capable host tools or shell execution.
- Reconnect behavior and timer cleanup.

## Validation

Run `npm run validate` before handoff. For contract-sensitive changes, also run `npm run contracts:check` and the workspace platform contract check from the parent workspace when available.
