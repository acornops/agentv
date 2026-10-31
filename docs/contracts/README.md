# AgentV contract

AgentV uses the outbound control-plane WebSocket bridge. Contract version 2
intentionally replaces the prototype tool, result, and snapshot contracts.

## Dependency Matrix

| Producer | Consumer | Surface | Compatibility |
| --- | --- | --- | --- |
| `agentv` | `control-plane` | handshake, heartbeat, compressed snapshot, `tools/list`, `tools/call` | Coordinated breaking contract; no v1 aliases or dual envelopes. |
| `control-plane` | `agentv` | authenticated session policy and bounded snapshot config | AgentV rejects incomplete, stale, mismatched, or out-of-local-bounds handshake responses. |

The systemd distribution surface publishes a versioned bootstrap script,
archive, checksum, and SBOM under `<release-base-url>/v<version>/<asset>`.
Generated onboarding commands must pin the exact version and the bootstrap must
verify the archive checksum before invoking the packaged systemd installer.

## Handshake

AgentV connects with `x-connector-version: agentv/<package-version>` and sends
the fixed-ID `lifecycle/handshake` request with `targetId`,
`targetType = "virtual_machine"`, `agentType = "agentv"`, supported
capabilities, and Linux/systemd host features. It exposes no
tools, snapshots, or heartbeats until the response matches the target and
contains a non-empty `workspaceId` plus a complete `sessionPolicy`.

Pending enrollment credentials receive a provisional response. AgentV uses it
only to prove local runtime readiness, exposes no tools or telemetry, and
reconnects until the installer commits the credential. Normal readiness is
recorded only after a non-provisional authenticated handshake.

Enrollment exchange returns a non-secret access-policy snapshot. Read-only
requires an empty restart list. Read-write requires one to 32 unique exact
non-AgentV `.service` units. The root installer validates and installs the
snapshot. Ordinary credential replacement carries the already-applied policy;
a host-policy update deliberately carries the new token-bound policy. Repair
uses the validated local policy without contacting the enrollment endpoint.

The installed tool policy is the intersection of compiled tools, remote
`allowedTools`, remote write enablement, local write enablement, and helper
capabilities. A connection-generation change revokes queued and future work.

`advertisedTools` is derived from AgentV's live tool definitions. Each entry
identifies the exact registered tool name and its read/write capability; it is
recomputed for every connection and is not a fallback grant. Write tools are
advertised only when the local helper is ready.

## Snapshot

`notify/snapshot` is gzip-compressed and contains `host_summary`, bounded
`filesystems`, failed/degraded service summaries, top processes, listeners,
findings, collector health, and explicit truncation counts. It never contains
raw logs and is dropped rather than sent when the negotiated hard byte limit
cannot be met.

The optional `finding_coverage.filesystems` and `finding_coverage.services` are
independently `complete` only after successful, untruncated enumeration and
finding evaluation, otherwise `incomplete`.
Raw inventory trimming does not change it: findings and coverage are retained
together or the entire snapshot is dropped. Older receivers ignore this additive
field. New receivers still require healthy collector status before recovering an
issue from absent findings; without the marker they use retained inventory and
truncation counts conservatively. No snapshot schema version bump is required.

## Tools

Read tools:

- `get_host_summary`
- `list_filesystems`
- `list_processes`
- `get_process`
- `list_services`
- `get_service`
- `query_logs`
- `list_listeners`

The optional `restart_service` write tool is disabled by default and is only
advertised when the root-owned helper has a valid exact unit allowlist.

Before each restart request, read `get_service` for the same unit and copy
`restart_preconditions.active_state`, `.sub_state` and, when present,
`.invocation_id` exactly into the corresponding `expected_*` inputs. Active and
sub states are separate machine values (`active` and `running`). As a compatible
input convenience, the tool accepts the exact display form `state (substate)`
only if its embedded substate matches `expected_sub_state`. It normalizes a
parsed copy before the action client, leaving all other inputs unchanged;
malformed/conflicting state inputs return `INVALID_ARGUMENTS` before helper access.
An invocation ID is observed systemd state, never a generated tool-call ID.
After `PRECONDITION_FAILED`, read the service again before requesting another
restart. The helper still rejects mismatched preconditions before any mutation
and identifies the first mismatched field without assuming the service changed.
No expected value is refreshed from the live service after approval. Required
fields, helper protocol, result envelopes, approval, allowlists and write policy
are unchanged; canonicalized helper requests retain idempotent replay semantics.

`tools/list` uses canonical `inputSchema`, `outputSchema`, `artifactPolicy`,
`timeout_ms`, `version`, and `deprecated` metadata. `tools/call` returns model
context in `content`, full data in `structuredContent` under
`acornops.full-tool-result.v1`, explicit truncation/omission metadata, and
`isError` for tool-level failures.

Input schemas use JSON Schema draft 2020-12 and describe inputs before defaults.
Defaulted fields remain optional. Refined objects such as `query_logs` advertise
their fields and limits; cross-field rules such as log time ordering remain
enforced by the agent. `get_process` requires a positive integer PID, not zero.

## Shared Invariants

- AgentV remains network-outbound-only and unprivileged.
- Host commands use fixed executables and structured arguments; caller-supplied shell is prohibited.
- Journald is the only production log backend, and process environments are never collected.
- Reads and writes are separately bounded; ambiguous writes return `outcome = "unknown"` and are never retryable.
- `restart_service` crosses privilege only through `/run/acornops-agentv/actions.sock` and an exact root-owned policy.

## Validation

Run `npm run validate`, the packaging smoke, live systemd smoke where available,
and the parent workspace platform contract validation for every contract change.

## Windows backend boundary

The control plane defaults omitted registration/stored identity to Linux/systemd.
Both handshake identity fields remain required and must match immutable stored
identity before provisional credential verification. Windows uses
`osFamily: windows`, `serviceManager: scm`; it is independently gated by
`AGENTV_WINDOWS_ENABLED` (default false), a pinned
`AGENTV_WINDOWS_RELEASE_VERSION`, and an HTTPS
`AGENTV_WINDOWS_RELEASE_BASE_URL`.

Windows enrollment and policy updates permit read-only access. Its backend tool
ceiling is the eight existing read names: `get_host_summary`, `list_filesystems`,
`list_processes`, `get_process`, `list_services`, `get_service`, `query_logs`,
`list_listeners`. Discovery, synchronization, and local/remote-owner dispatch
reject other names, including `restart_service` falsely advertised as read.
Linux tool schemas, helper rules, and install commands remain unchanged.

The Windows bootstrap contract is `v<version>/install-agentv.ps1` with
`-ReleaseBaseUrl`, `-PlatformUrl`, `-TargetId`, optional `-EnrollmentToken` and
`-ReplaceCredential`. Repair reuses the protected credential. Commands download
to a fresh temporary `.ps1` file and remove it in `finally`. Native packaging,
telemetry and host qualification remain prerequisites for enabling rollout.
