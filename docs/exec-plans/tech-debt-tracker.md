# Tech Debt Tracker

Track durable gaps that should not be lost between agent sessions.

| Gap | Impact | Owner | Target | Status |
| --- | --- | --- | --- | --- |
| Complete staging reboot-canary acceptance | Experimental `.8` hosted Ubuntu 24.04 Node 22/24 gates, published assets and signed provenance passed on 2026-10-25; production promotion still needs a staging power-cycle during incomplete transaction recovery | AgentV maintainers | Before AgentV production rollout | Open |
| Publish patched Zod runtime | [Zod 4.6.7 qualification](active/runtime-validation-security.md) passes helper-limit, tool-schema, protocol, and package checks with zero runtime advisories. Installed VMs still require the patched AgentV release. | AgentV maintainers | Before production promotion | Implemented and reviewed locally; publication pending |
| Add metrics or health signal | Improves operations beyond structured logs | AgentV maintainers | Future runtime hardening | Open |
