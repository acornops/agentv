# Reliability

## Failure Modes

- Control plane unavailable: the agent logs connection errors and reconnects after a short delay.
- WebSocket closed after a successful handshake: heartbeat and snapshot timers are cleared before reconnecting.
- Live collector command unavailable: snapshot collection logs a warning and retries on the next snapshot interval.
- Snapshot too large: logs are dropped first, then process entries are reduced while keeping a minimum process sample.
- Invalid environment: startup fails fast with an explicit configuration error.

## Required Validation

Run `npm run validate` before handoff. Run targeted tests for changes to reconnect behavior, snapshot bounding, collector parsing, redaction, and JSON-RPC tool handling.

## Runtime Signals

The agent emits structured logs for:

- startup configuration without secrets
- control-plane connection attempts
- WebSocket errors and closes
- handshake acknowledgement
- snapshot upload byte size and object counts
- snapshot collection failures
- shutdown signals

## Backpressure And Limits

- `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES` bounds serialized snapshots.
- `ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS` controls snapshot cadence.
- `get_logs` and `search_logs` clamp line count and byte limits.
- Tool definitions carry per-tool timeout metadata for control-plane enforcement.

## Recovery And Rollback

The agent keeps no required local durable state. Restarting the process reconnects and re-handshakes. For systemd installs, rollback by restoring the previous release under `/opt/acornops/agentv` and restarting `acornops-agentv`.
