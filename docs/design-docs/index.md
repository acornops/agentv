# Design Docs

Record durable design decisions here. Keep transient task notes in execution plans instead.

| Document | Status | Notes |
| --- | --- | --- |
| Core beliefs | Verified | AgentV is outbound-only and read-only by default; helper writes are isolated and allowlisted. |

- [Core Beliefs](core-beliefs.md)
- [Windows VM support with Linux compatibility](windows-vm-linux-compatibility.md) — Approved; preserves Linux contracts and stages Windows qualification.
- [Windows service host](windows-service-host.md) — Reviewed native host boundary; packaging and qualification pending.
- [Windows installer recovery](windows-installer-recovery.md) — Reviewed transaction and SCM ordering; native interruption qualification pending.
