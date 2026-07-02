# Tech Debt Tracker

Track durable gaps that should not be lost between agent sessions.

| Gap | Impact | Owner | Target | Status |
| --- | --- | --- | --- | --- |
| Add live Linux/systemd replay fixtures | Improves confidence in collector parsing and redaction | AgentV maintainers | Before broad VM beta | Open |
| Add degraded WebSocket runtime test | Validates reconnect and timer cleanup under real transport failure | AgentV maintainers | Before production rollout | Open |
| Add metrics or health signal | Improves operations beyond structured logs | AgentV maintainers | Future runtime hardening | Open |
