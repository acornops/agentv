# Windows installer recovery design

Status: independently reviewed for implementation. Packaging and native
interruption qualification remain pending. This design complements the
[Windows service host](windows-service-host.md) and preserves the existing
backend enrollment protocol and Linux installer.

## Existing backend contract (do not redesign)

Source: control-plane `src/controllers/agentv-installation-controller.ts` and
`src/store/repository-agentv-enrollments.ts` at `385339a`.

- Exchange: POST `/api/v1/agentv/enrollments/exchange`, JSON
  `{targetId,enrollmentToken,purpose:'initial'|'replace'}`. A successful response
  gives `{transactionId,transactionSecret,agentKey,purpose,accessPolicy}`. Validate
  target-bound key, exact enrollment ID, expected purpose and read-only policy
  with an empty restart list before using any returned credential.
- Status: GET `/api/v1/agentv/installations/:id/status`, header
  `x-agentv-transaction-secret`. Response is
  `{transactionId,status,credentialState,activeConnected}`.
- Commit and rollback are POST suffixes of that transaction URL, same header.
  Commit returns `{status:'completed'}`; rollback `{status:'cancelled'}`.
- Mutation window is 60 minutes from exchange. A replacement's immediately
  previous active credential has a 30-minute grace window from commit; older
  generations are revoked. Expiry is checked before idempotent mutation retries.
- Status is intentionally readable with the transaction secret after mutation
  expiry. This is the authority for resolving a response lost around commit.
- `activeConnected` tests authenticated key generation and heartbeat against
  activation/update time, without a current freshness bound. For cancelled or
  expired transactions it refers to the target's current active generation,
  which need not be the local backup. It is necessary remote evidence, not
  sufficient evidence that this machine's selected installation reconnected.
- Existing Linux installer/recovery is reference only; leave it unchanged.

## Required local safety rules

- Preflight admin, supported Server/x64/Node/.NET, paths/ACLs/reparse points,
  exact package version/checksums and candidate doctor before consuming a token.
- One exclusive installer/recovery lock under a protected fixed parent; no lock
  or recovery authority in user-controlled temp. Refuse an unrelated existing
  service/task; do not commandeer it. Revalidate durable input on recovery.
- Stage immutable versioned runtime beneath Program Files. Keep protected JSON
  config, transaction journal and bounded state/logs beneath ProgramData.
  Filesystem roots come from OS folder APIs, not caller environment overrides.
- Config readable by the unique AgentV service SID, not all LocalService
  processes. Transaction secrets/backups are Administrators/SYSTEM only.
- Before publishing the active transaction marker, durably save previous and
  candidate runtime/config selection, prior service enabled/running state and
  whether this was an initial install. Flush journal writes and atomically
  replace individual JSON files in the same protected directory.
- A single atomic config/selection document should bind runtime and credential
  where feasible. Any multi-step SCM update must still be recoverable from the
  journal. Never overwrite an immutable release in place or follow junctions.
- Recovery needs elevated access distinct from the LocalService agent. Use a
  fixed protected SYSTEM scheduled recovery task (startup and bounded retry),
  registered and validated before cutover, with a fixed trusted script path.
  No arbitrary script or remote command inputs. During an unresolved transaction,
  journal and suppress the owned service's failure restart actions. First set
  the service disabled, suppress those actions, stop and observe its tree exit,
  and drain any already queued restart delay before switching to manual. Validate
  the existing owned 10/30/60-second policy; fail closed on unknown custom policy.
  Use a monotonic 65-second drain while disabled after stopping (maximum owned
  delay plus margin). Re-entry repeats the full drain, rather than trusting a
  persisted wall-clock timestamp. New services with no prior start skip this
  queued-action drain. Keep manual startup and suppressed failure actions until
  resolution, with only the lock-owning installer/recovery starting the selected
  runtime. Restore intended startup and failure-action policy after durable
  finalization.
  Test interruptions around mode/action changes, a queued restart during upgrade,
  and concurrent startup/recovery. The
  service host retains its four reviewed responsibilities, with no enrollment
  HTTP in C#.
- Readiness requires fresh local authentication evidence bound to the selected
  configuration and this service launch, cleared before each launch and
  invalidated on disconnect. For enrollment transactions, valid authenticated
  backend status is also required; network failure cannot waive this requirement.
  Task 3 exposes callbacks; task 5 owns launch identity and the fixed protected
  marker. LocalService-writable readiness is evidence only and never controls
  recovery paths, privileged commands or journal selection.
- Persist commit/rollback intent before sending the request. After an ambiguous
  response or rejection, query status; a retry may reject after the original
  request already succeeded. Keep unknown outcomes pending without guessing.
- Finalization durably records the terminal selection first, restores the
  intended service startup mode and failure actions, clears the active marker, then deletes secret
  backups/journal. All steps tolerate re-entry after interruption.
- Preserve the additional CA setting on repair; no token exchange for reuse of
  a valid local credential. Repair/upgrade must still reconnect successfully.
- Successful uninstall stops/removes owned service/recovery registration, but
  does not silently delete durable config or revoke credentials. An unresolved
  transaction requires explicit recovery handling rather than silent deletion.

## Failure matrix to implement and test

| Interruption/evidence | Required safe outcome |
| --- | --- |
| Package, runtime, ACL, target or version preflight fails | No token consumed; existing installation unmodified. |
| Duplicate installer/recovery | One owner; other operation fails/retries without mutation. |
| Exchange request definitely rejected | No cutover; original state retained. |
| Exchange succeeds but response is lost | No guessed credential or repeat successful exchange claim; original state retained, consumed token may require replacement. Record limitation clearly. |
| Exchange response received, before journal publication | Candidate response must be safely persisted before cutover; loss cannot overwrite prior config. |
| Pending candidate, verified not committed | Cancel pending transaction before claiming restoration; verify previous authenticated connection if one existed. |
| Commit request/response lost | Query status. `completed` retains candidate; `verified` remains pending. Network/401/unknown status preserves recovery state and cannot be called rollback success. |
| Completed + active credential + authenticated candidate | Keep candidate, finish transaction and remove secret journal only after evidence. |
| Candidate fails after commit, rollback still available | Remote rollback must succeed before declaring previous credential restored; verify its reconnection. |
| Rollback response is lost or retry returns rejection | Resolve via authenticated status; `cancelled` can prove earlier success. Do not infer failure from a late 409 or restore blindly. |
| Completed but rollback denied after mutation/grace expiry | Keep/restore committed candidate and report recovery required; never claim a revoked previous key is usable. |
| Cancelled/expired + revoked candidate | Restore known previous selection; first install cleans up only resources it created. |
| Completed but candidate is later grace/revoked/non-active | Do not guess which historical credential is valid; retain diagnostics and require replacement. |
| Status unreachable/invalid or unknown future state | Retain protected candidate/journal, bounded retry, actionable pending result. |
| Recovery interrupted repeatedly | Re-entry is idempotent; no double enrollment or immutable release overwrite. |
| Repair with existing key fails before/after selection | Restore previous runtime/config and reconnect, without an enrollment call. |
| Runtime upgrade succeeds | Same target/key, new immutable release, authenticated connection; previous version retained for explicit rollback. |
| Uninstall with normal configuration | Owned tree stopped, service/task removed, durable config retained, no credential revocation. |

Minimal sequence: preflight/stage → establish recovery owner → exchange and
durably journal response → publish active marker → disable/suppress/stop and
drain queued recovery → manual service →
atomically select candidate → start and verify provisional authentication →
persist commit intent and commit → resolve status and verify active local
authentication → durable finalization and cleanup. A new enrollment command can
retire abandoned pending state after a lost exchange response; the old secret/key
response cannot be replayed by the existing backend.

SCM queue rationale: [Microsoft ChangeServiceConfig2W documentation](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfig2w)
states that a queued restart cannot be cancelled; disabling the service prevents
its execution. Changing startup type to manual alone is insufficient. The
bounded drain is conservative and needs native interruption qualification.

Hosted tests must exercise native file replacement/ACL/SCM behavior and simulated
API outcomes separately from parser mocks. Kill installer/recovery processes at
durable checkpoints, invoke actual recovery entrypoint, and verify selected
config/runtime and backend credential generation. Actual machine reboot remains
unqualified under the user's hosted-CI-only choice.
