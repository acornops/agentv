# AgentV Quality Score

Assessment date: July 19, 2026.

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Contracts | 5/5 | Coordinated AgentV/control-plane v2 manifests, strict complete tool contracts, standard MCP envelopes, workspace contract gate | Keep consumers synchronized when v3 is proposed |
| Host safety | 5/5 | Fixed executables, strict schemas, two-boundary redaction, no process environment reads, helper-only exact allowlisted mutation | Expand secret fixtures as new credential formats emerge |
| Reliability | 4/5 | Authenticated generations, bounded executor, backpressure, jittered reconnects, snapshot coalescing, enforced full-suite coverage, package smoke, and a required hosted Ubuntu systemd/helper gate | Record a green hosted gate and qualify RHEL on an equivalent live runner before broad rollout |
| Maintainability | 4/5 | Narrow injectable adapters, generic registry/executor, clean production build, versioned release layout, and direct critical-boundary tests | Add another host family only behind equivalent replay and live gates |
| Observability | 4/5 | Structured counters and logs, collector health, `doctor`, systemd readiness and main-process watchdog | Export counters centrally without adding an inbound listener |
| Documentation | 5/5 | Indexed architecture, operations, security, reliability, contracts, public VM/tool/deployment docs | Keep install examples pinned to published release coordinates |

Re-score this file when a major architectural or operational change lands.
