# AgentV Contract

The AgentV talks to the control plane over the existing outbound WebSocket
agent bridge.

## Dependency Matrix

| Producer | Consumer | Surface | Compatibility |
| --- | --- | --- | --- |
| `agentv` | `control-plane` | `lifecycle/handshake`, `lifecycle/heartbeat`, `notify/snapshot`, `tools/list`, `tools/call` | Additive fields are preferred; removing or renaming fields requires a coordinated control-plane change. |
| `control-plane` | `agentv` | WebSocket endpoint, JSON-RPC requests, handshake acknowledgement, session policy | The AgentV expects a JSON-RPC result for handshake acknowledgement before it starts heartbeats and snapshots. |

## Handshake

Method: `lifecycle/handshake`

Required params:

- `agentKey`
- `targetId`
- `targetType = "virtual_machine"`
- `agentType = "agentv"`
- `osFamily = "linux"`
- `serviceManager = "systemd"`
- `supportedCapabilities[]`

The control plane responds with `workspaceId`, `targetId`, `targetType`,
`sessionPolicy`, and snapshot config.

## Snapshot

Method: `notify/snapshot`

Payload:

- `timestamp`
- `data.host`
- `data.metrics`
- `data.services`
- `data.processes`
- `data.listeners`
- `data.logs`
- `data.findings`

Snapshots are bounded by `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES`.

## Tools

The agent supports `tools/list` and `tools/call`. All built-in VM tools declare
`capability = "read"`.

Built-in tool names:

- `get_host_summary`
- `list_processes`
- `get_process`
- `list_services`
- `get_service_status`
- `get_logs`
- `search_logs`
- `check_port`
- `list_listening_ports`

## Shared Invariants

- AgentV instances are outbound-only and authenticate with the agent key assigned by the control plane.
- `targetType` is `virtual_machine` for this repository.
- `agentType` is `agentv`.
- V1 OS support is `linux`; v1 service manager support is `systemd`.
- Built-in VM tools are read-only and must not mutate packages, files, processes, services, or host configuration.
- Snapshot and log payloads must remain bounded and redact token-like process arguments.

## Validation

Run `npm run contracts:check` in this repository after contract documentation changes. For behavior changes that alter the shared agent bridge, also update the matching control-plane contract docs and run the workspace platform contract check from the parent workspace.
