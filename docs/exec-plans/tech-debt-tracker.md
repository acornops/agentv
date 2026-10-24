# Tech Debt Tracker

Track durable gaps that should not be lost between agent sessions.

| Gap | Impact | Owner | Target | Status |
| --- | --- | --- | --- | --- |
| Complete staging reboot-canary acceptance | Experimental `.8` hosted Ubuntu 24.04 Node 22/24 gates, published assets and signed provenance passed on 2026-10-25; production promotion still needs a staging power-cycle during incomplete transaction recovery | AgentV maintainers | Before AgentV production rollout | Open |
| Evaluate production Zod advisory GHSA-mrhx-c7xc-m3w5 | `npm audit --omit=dev` on 2026-10-24 reports high-severity resource exhaustion for the existing Zod 3 dependency; the suggested fix is a Zod 4 major upgrade, requiring schema/contract compatibility review. Dependencies are unchanged by the Node-path fix. | AgentV maintainers | Before production promotion | Open |
| Add metrics or health signal | Improves operations beyond structured logs | AgentV maintainers | Future runtime hardening | Open |
