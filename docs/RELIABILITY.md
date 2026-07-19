# Reliability

## Failure Modes

- Control plane unavailable: the agent reconnects with one-to-fifteen-second capped equal-jitter backoff.
- WebSocket closed after a successful handshake: heartbeat and snapshot timers are cleared before reconnecting.
- Live collector command unavailable: snapshot collection logs a warning and retries on the next snapshot interval.
- Snapshot too large: optional entries are deterministically reduced while health and critical findings remain; an over-budget gzip payload is dropped.
- Helper crash around a mutation: durable `in_progress` state becomes `unknown` and the same operation ID returns the stored receipt.
- Invalid environment: startup fails fast with an explicit configuration error.

## Required Validation

Run `npm run validate`, `npm run test:coverage:all`, and
`npm run smoke:package` before handoff. Run targeted tests for changes to
reconnect behavior, snapshot bounding, collector parsing, redaction, and
JSON-RPC tool handling. Releases additionally require the hosted Ubuntu
`smoke:systemd` job to pass.

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
- `query_logs` clamps record and byte limits and reports truncation explicitly.
- The executor enforces separate read/write concurrency, a shared queue, input/output limits, local timeouts, generation revocation, and redaction.

## Recovery And Rollback

The main agent keeps no durable state. The helper retains only bounded action receipts for seven days or 1,000 records. Systemd rollback switches the `current` symlink to a preserved release and restarts AgentV.

## Release Evidence

- Full coverage includes real local WebSocket handshake, reconnect, policy,
  tool-call, and snapshot behavior with enforced aggregate floors.
- Package smoke validates the exact archive that systemd installs, including its
  checksum, paths, entrypoints, dependency closure, and executable modes.
- Hosted Ubuntu smoke validates real systemd readiness, doctor checks under the
  service identity, live collectors, helper policy and idempotency, upgrade,
  rollback, and preservation during uninstall.
- RHEL-family parser behavior uses replay fixtures. Broad RHEL rollout still
  requires the same live smoke on a suitable systemd runner.
