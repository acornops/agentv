# Runtime validation security

## Release integration — 2026-10-26

Implementation and independent review are complete. The user subsequently
authorized main integration and a demo release. The original implementation
record below is historical; publication and deployment acceptance are tracked
in the deployment repository's security-maintenance-release plan. Remaining
production gates are not cleared by this source qualification.

Status: implemented and independently reviewed on `fix/runtime-validation-security`;
uncommitted and unpublished. No findings remain in this focused migration.

## Scope

Qualify Zod 4.6.7 and migrate the tool input schema converter to supported APIs.
Preserve input defaults, JSON-RPC optionality, helper validation, read-only
defaults, and existing restart authorization. No host changes or release work.

## Work and checks

- Cover malformed/oversized helper results and advertised tool input constraints.
- Compare valid input behavior before and after the dependency migration.
- Run full validation, local protocol integration, platform contracts, and runtime
  audit. Record compatibility decisions and independent review results.

## Coordination

Control Plane and AgentK qualify the same patched dependency. Deployment owns
the production audit. No protocol version or deployment change is intended.

## Evidence and compatibility

- `npm run validate`: 104 tests, lint/types, contracts, harness, and build passed.
  `npm run test:e2e`: 4 loopback protocol tests passed.
- Main checks used Node 24.2.0; the full suite including e2e also passed on
  verified temporary Node 22.23.4 (108 tests).
- `npm run smoke:package`: runtime package and bootstrap failure checks passed;
  no archive was published and no real host installation was attempted.
- The helper still rejects more than 32 restart services and malformed results.
  This is the only production Zod array parser, behind the root-owned helper.
- Native input-schema conversion restores the previously missing `query_logs`
  fields/limits and correctly advertises a strictly positive PID. Those rules
  were already enforced at execution. Defaults remain optional, and cross-field
  refinements remain enforced locally.
- All 17 AgentK/AgentV schemas passed real execution-engine sanitization and
  gateway provider rendering, with representative preapproval cases. No live
  provider API was called.
- `npm audit --omit=dev --json`: zero runtime advisories. Only Zod changed in
  the lockfile. Input integers now reject unsafe values under Zod 4.
- Independent final review found no Critical, Important, or Minor issues;
  protocol optionality and every captured schema were checked separately.

No privilege, write policy, helper protocol, tool names, install behavior, or
release coordinates changed. Real Linux/systemd and reboot acceptance remain
release gates; this macOS check is not a replacement.
