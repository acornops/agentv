# AgentV Architecture

## Purpose

The AgentV runs unprivileged on Linux/systemd virtual machines, connects outbound to the AcornOps control plane, sends bounded host snapshots, serves strict diagnostic tools, and can optionally request an exact allowlisted service restart from a separate root-owned helper.

The same AgentV also has a read-only Windows/SCM implementation. It remains a
preview with rollout disabled pending [native qualification](docs/design-docs/windows-qualification-decision.md).

This repository owns the VM-side runtime, host collector adapters, JSON-RPC tool registry, systemd and Windows packaging assets, Docker image, and AgentV contract docs. It does not own control-plane target registration, central deployment orchestration, or Kubernetes agent behavior.

## Runtime Boundaries

- Inbound interfaces: none from the network; the agent only receives messages on the outbound WebSocket it initiated.
- Outbound dependencies: AcornOps control-plane WebSocket endpoint and OS-specific local collectors.
- Local privileged interface: Linux `/run/acornops-agentv/actions.sock`; absent in the read-only container image and Windows runtime.
- Persistent stores: OS-specific protected installation/configuration and recovery state, plus the Linux helper action ledger under `/var/lib/acornops-agentv/actions`.
- Background workers: transport ping/pong, heartbeat, bounded snapshot, and reconnect timers.
- External services: control plane at `ACORNOPS_AGENT_PLATFORM_URL`.

## Source Layout

```text
src/config.ts                 environment parsing and validation
src/index.ts                  process entrypoint and shutdown handling
src/adapters/                 narrow Linux, procfs, systemd, journald, filesystem, and socket adapters
src/windows/                  separate native Windows read collectors, tools, and snapshots
src/windows-runtime.ts        Windows composition using the shared authenticated lifecycle
src/windows-service-entry.ts  private native-host START/STOP boundary
src/actions/                  helper protocol, client, policy enforcement, and durable ledger
src/core/                     authenticated lifecycle and snapshot manager
src/mcp/                      JSON-RPC request router
src/tools/                    strict registry, schemas, executor, projection, and tool handlers
src/transport/                outbound WebSocket client
packaging/systemd/            Linux systemd install assets
packaging/windows/            SCM host and transactional installer/recovery assets
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

The Linux helper persists bounded operation receipts so reconnect retries are
idempotent and crash-surviving in-progress writes remain unknown. The Windows
service publishes launch-bound authentication evidence; its separate elevated
installer owns protected configuration and transaction recovery state. Neither
runtime owns the control-plane database.

## High-Risk Areas

- Agent key handling and log redaction.
- Host log collection boundaries and byte limits.
- Snapshot size bounding and truncation behavior.
- Live Linux/systemd command adapters.
- Any change that adds write-capable host tools or shell execution.
- Reconnect behavior and timer cleanup.

## Validation

Run `npm run validate` before handoff. For contract-sensitive changes, also run `npm run contracts:check` and the workspace platform contract check from the parent workspace when available.

## Windows runtime composition

`src/windows-runtime.ts` selects isolated native or explicitly synthetic Windows
adapters and eight read tools. `LifecycleManager.forWindows` composes the shared
authenticated transport with a separate cancellable Windows snapshot lifecycle;
the Linux constructor, HostAdapter, SnapshotManager, runner and tool contracts
retain their existing behavior. `src/windows-service-entry.ts` waits for the
native host's private START gate before dynamic runtime import and retains STOP
during startup. Native SCM hosting and installer transactions are separate.
The [Windows contract](docs/contracts/windows-read-runtime.md) specifies native
fields, conservative service evidence and unqualified platform boundaries.
