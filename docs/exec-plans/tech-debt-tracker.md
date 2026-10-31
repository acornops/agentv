# Tech Debt Tracker

Track durable gaps that should not be lost between agent sessions.

| Gap | Impact | Owner | Target | Status |
| --- | --- | --- | --- | --- |
| Linux synthetic list-service output exceeds its summary schema | Released experimental.14 and the unchanged Linux mock return detail fields from `listServices`; actual mixed-target calls succeed but both Linux mock results fail strict list-output validation. Preserve the released contract during Windows work; qualify a separate correction. | AgentV maintainers | Separate Linux mock contract change | Open |
| Attribute Windows cold collector timeouts | Hosted Server 2022 Node 22/24 and earlier Server 2025 Node 24 calls exceeded the unchanged eight-second bound; a later diagnostic also took 8,369 ms. [Qualification decision](../design-docs/windows-qualification-decision.md) preserves failures and unmet gates; no causal production remedy is established. | AgentV maintainers | Before Windows rollout | Open |
| Resolve Windows service-identity collector failure | Native host CI 41243496972 failed under LocalService on Server 2022/Node 24; cause is unknown. Later diagnostic CI passes and retained failure instrumentation are not a production fix. See [qualification decision](../design-docs/windows-qualification-decision.md). | AgentV maintainers | Before Windows rollout or action design | Open |
| Complete staging reboot-canary acceptance | Experimental `.8` hosted Ubuntu 24.04 Node 22/24 gates, published assets and signed provenance passed on 2026-10-25; production promotion still needs a staging power-cycle during incomplete transaction recovery | AgentV maintainers | Before AgentV production rollout | Open |
| Publish patched Zod runtime | [Zod 4.6.7 qualification](active/runtime-validation-security.md) passes helper-limit, tool-schema, protocol, and package checks with zero runtime advisories. Installed VMs still require the patched AgentV release. | AgentV maintainers | Before production promotion | Implemented and reviewed locally; publication pending |
| Add metrics or health signal | Improves operations beyond structured logs | AgentV maintainers | Future runtime hardening | Open |
