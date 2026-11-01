# AgentV Quality Score

Assessment date: July 19, 2026.

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Contracts | 5/5 | Coordinated AgentV/control-plane v2 manifests, strict complete tool contracts, standard MCP envelopes, workspace contract gate | Keep consumers synchronized when v3 is proposed |
| Host safety | 5/5 | Fixed executables, strict schemas, two-boundary redaction, no process environment reads, helper-only exact allowlisted mutation | Expand secret fixtures as new credential formats emerge |
| Reliability | 4/5 | Authenticated generations, bounded executor, transactional install recovery, backpressure, jittered reconnects, enforced full-suite coverage, package smoke, and a required live Ubuntu 24.04 systemd gate | Published `.8` evidence is recorded; complete the staging power-cycle recovery canary before production rollout |
| Maintainability | 4/5 | Narrow injectable adapters, generic registry/executor, clean production build, versioned release layout, and direct critical-boundary tests | Add another host family only behind equivalent replay and live gates |
| Observability | 4/5 | Structured counters and logs, collector health, `doctor`, systemd readiness and main-process watchdog | Export counters centrally without adding an inbound listener |
| Documentation | 5/5 | Indexed architecture, operations, security, reliability, contracts, public VM/tool/deployment docs | Keep install examples pinned to published release coordinates |

Re-score this file when a major architectural or operational change lands.

Release follow-up (2026-10-24): the production dependency audit reports
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
against the existing Zod 3 dependency. The Node runtime-path change does not
modify dependencies or resolve this advisory. Track remediation and its schema
compatibility checks in the [tech debt tracker](exec-plans/tech-debt-tracker.md)
before production promotion; the historical scores above are not a release
approval.

Security qualification (2026-10-26): [Zod 4 qualification](exec-plans/completed/runtime-validation-security.md)
uses 4.6.7 with helper-limit, tool input-schema, protocol, and package checks.
The local runtime audit reports zero advisories, and independent review found no
remaining migration issues. Publication and real-host acceptance remain pending;
installed hosts are not automatically updated.

Experimental `.8` release evidence (2026-10-25): both hosted Node 22/24 systemd
gates, published checksums and signed provenance passed. See the
[runtime-selection completion record](exec-plans/completed/node-runtime-selection-implementation.md#published-experimental-release--2026-10-25).

Windows qualification (2026-11-01): the read-only source/integration stage is
complete, but [rollout and writes remain unqualified](design-docs/windows-qualification-decision.md).
The full generated HTTPS wrapper passes both hosted OS fixtures with a synthetic
bootstrap. Host-only ten-second headroom permits an observed 8.9-second read,
but a later first call still timed out before any script marker. Collector and
service-identity reliability, real reboot, Core/Desktop Experience and combined
native/real-backend deployment remain unqualified. Passing samples do not resolve
those limits; the historical scores are not Windows release approval.

Review hardening (2026-11-01): Windows reconnect snapshot and mock/live validation
regressions are covered, producer/consumer compatibility is executable, and
installer failures retain safe categories without changing recovery decisions.
Linux CI passes 259 unit/E2E tests and both Node 22/24 systemd lifecycle gates.
The bounded cold component experiment adds two unhealthy Windows samples; it
does not establish a causal repair. Shared outage-status repair remains at a
separate backend design gate. See the updated qualification decision for exact
evidence and limits; the historical scores remain unchanged. Final fixture checks
pass on all four Windows cells, but the same run records another normal host
collector timeout on Server 2022/Node 24. Earlier passing matrices do not erase it.

Deterministic follow-up (2026-11-01): the Linux mock summary-contract mismatch and
parent linked-workspace validation failures are corrected. Local and hosted
coverage pass 260 tests; both hosted Ubuntu Node 22/24 lifecycle gates pass.
Optional unconfigured Codecov publication skips cleanly while coverage and its
GitHub artifact remain mandatory. Independent review has no findings. This adds
regression evidence without changing live Linux code or Windows qualification.

Qualification preparation (2026-11-01): a separate Windows candidate artifact
workflow and protected read-only reboot probe are implemented. The 32 decision/CLI
tests and all four native startup/probe cells pass. Native testing exposed a
PowerShell UTF8 BOM at the stdin boundary; a reproducing test and one-prefix
parser fix resolve that tooling failure. It is unrelated to the open collector
timeout. Real-store backend characterization passes ten new races without a
production source change. Actual reboot and production release qualification
remain open. The full final Windows installer matrix passes all eighteen jobs;
see [the completion evidence](exec-plans/completed/windows-qualification-preparation.md)
and [tooling guide](windows-qualification.md).
