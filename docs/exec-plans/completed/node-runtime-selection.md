# AgentV system-wide Node runtime selection

Status: implemented and locally validated on 2026-10-24. Integration and
experimental release authorized on 2026-10-25. Candidate `.7` failed the hosted
fixture preflight; replacement `0.0.1-experimental.8` preserves that tag. Publication
requires the hosted release gates.

## Goal

Allow AgentV installation when a supported Node runtime exists at
`/usr/local/bin/node` alongside an older `/usr/bin/node`, without changing the
host's Node installation or weakening the privileged action helper boundary.

## Evidence

The bootstrap, archive installer, enrollment worker, systemd services, doctor,
and interrupted-install recovery all invoke `/usr/bin/node` directly. Accepting
another binary only in the bootstrap would leave the installed services and
recovery commands using the wrong runtime. The reported VM has both paths; its
actual runtime versions have not been independently verified.

## Approaches

- **Discover and retain a trusted system-wide runtime:** the focused approach
  discussed with the user. It handles the reported installation layout while
  retaining the existing host-managed Node dependency.
- **Bundle Node with AgentV:** removes the host dependency but introduces runtime
  distribution, architecture-specific packaging, and security-update ownership.
  This is outside the requested fix.
- **Rewrite `/usr/bin/node` or use arbitrary `PATH` discovery:** rejected. The
  former changes host-managed software; the latter is unsuitable for a service
  with a root-owned action helper.

The proposed implementation uses the first approach. The precise internal
storage and shell-helper layout are implementation decisions, subject to the
requirements below.

## Scope and behavior

- Keep Node.js 22 as the minimum supported major version.
- Consider the fixed system-wide candidates `/usr/bin/node` and
  `/usr/local/bin/node`. Preserve a valid existing AgentV runtime selection;
  otherwise prefer `/usr/bin/node` when it qualifies, then `/usr/local/bin/node`.
- Validate root ownership and absence of group/world write permission on the
  executable and its path, including resolved symlink targets, before invoking
  a candidate. Do not use a user-controlled `PATH` or home-directory runtime.
- Retain the selected absolute runtime path in root-controlled installation
  state. Use it consistently for installer checks, enrollment, the agent,
  privileged actions, doctor, and interrupted-install recovery.
- Include runtime selection in installation rollback and recovery. Existing
  installations and transactions without this new state retain their legacy
  `/usr/bin/node` meaning. An unusable selected runtime must produce a clear
  failure, not silently switch a running installation to another binary.
- Keep Node as the service's actual main process and preserve existing systemd
  hardening, read-only defaults, action allowlists, and credential handling.
- Improve failure messages to identify checked paths and the reason no runtime
  qualifies, without printing credentials.
- Update AgentV installation, operations, and security documentation with the
  supported locations and trust requirements. Review the demo onboarding guide
  for matching instructions; do not change release pins before publishing.

## Contract and release impact

No platform API, agent protocol, enrollment payload, or credential-mode changes.
No automatic Node installation, dependency addition, support for per-user version
managers, or change to `/usr/bin/node` is included. Publishing a release and
updating the deployed installer pin are separate from implementing this fix.

## Required validation

Add a regression test that fails with the current hardcoded path, then cover:

- an older `/usr/bin/node` with supported `/usr/local/bin/node`;
- supported system Node only, both candidates supported, and neither supported;
- unsafe executable, parent directory, and symlink target permissions;
- an untrusted earlier `node` on `PATH` not being selected;
- consistent runtime use by the agent, root helper, doctor, and recovery;
- first-install failure, upgrade/repair failure, and interrupted-install recovery
  restoring the appropriate runtime selection;
- compatibility with existing installation and transaction state.

Run targeted shell checks, `npm run validate`, `npm run test:coverage:all`, and
`npm run smoke:package`. Exercise the affected paths in the existing disposable
Ubuntu 24.04 live-systemd smoke gate, including Node 22 and Node 24. Local macOS
checks alone are not evidence that live systemd behavior passed; report any
unavailable Linux validation explicitly.

## Completion

The user authorized design evaluation followed by implementation. The design
fits AgentV's host-managed, least-privilege model: no runtime downloader or
package manager was introduced. The shared launcher and path data are used by
installation, both services, doctor, rollback, and recovery. The independent
review's legacy-fallback finding was reproduced and fixed. Validation and
remaining release gates are recorded in
[the execution plan](node-runtime-selection-implementation.md). The user later
authorized integration and a new experimental installer release; this does not
waive the documented production-promotion gates.
