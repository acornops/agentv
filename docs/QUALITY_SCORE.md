# VM Agent Quality Score

Assessment date: May 31, 2026.

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Contracts | 3/5 | VM-agent/control-plane contract docs and manifest, `npm run contracts:check` | No cross-repo consumer-driven contract test yet |
| Host safety | 4/5 | Read-only tool registry, no arbitrary shell execution, security docs and systemd hardening | More redaction fixtures for real process and log samples |
| Reliability | 3/5 | Reconnect loop, heartbeat/snapshot timers, mock collector tests | No long-running degraded-network or live-systemd replay harness |
| Maintainability | 3/5 | TypeScript modules split by config, collector, transport, MCP, and tools | Live collector behavior should grow behind narrower adapters as OS support expands |
| Observability | 2/5 | Structured startup, connection, snapshot, and error logs | No metrics or health endpoint yet |
| Documentation | 4/5 | AGENTS entry point, indexed docs tree, architecture, operations, security, reliability docs | Freshness depends on keeping docs updated with implementation changes |

Re-score this file when a major architectural or operational change lands.
