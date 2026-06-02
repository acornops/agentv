# Tech Debt Tracker

Track durable gaps that should not be lost between agent sessions.

| Gap | Impact | Owner | Target | Status |
| --- | --- | --- | --- | --- |
| Add live Linux/systemd replay fixtures | Improves confidence in collector parsing and redaction | VM agent maintainers | Before broad VM beta | Open |
| Add degraded WebSocket runtime test | Validates reconnect and timer cleanup under real transport failure | VM agent maintainers | Before production rollout | Open |
| Add metrics or health signal | Improves operations beyond structured logs | VM agent maintainers | Future runtime hardening | Open |
