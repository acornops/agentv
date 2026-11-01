# Design Docs

Record durable design decisions here. Keep transient task notes in execution plans instead.

| Document | Status | Notes |
| --- | --- | --- |
| Core beliefs | Verified | AgentV is outbound-only and read-only by default; helper writes are isolated and allowlisted. |

- [Core Beliefs](core-beliefs.md)
- [Windows VM support with Linux compatibility](windows-vm-linux-compatibility.md) — Approved; preserves Linux contracts and stages Windows qualification.
- [Windows service host](windows-service-host.md) — Reviewed native host boundary; hosted matrix passes, rollout qualification remains open.
- [Windows installer recovery](windows-installer-recovery.md) — Reviewed transaction and SCM ordering; hosted interruption checks pass, reboot recovery remains unqualified.
- [Windows qualification decision](windows-qualification-decision.md) — Unqualified for rollout or writes; native evidence, unmet gates and future action-design requirements.
- [Windows review hardening](windows-review-hardening.md) — Authorized scoped fixes, executable compatibility checks and separate shared-status work.
