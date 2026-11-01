# Windows qualification preparation

Approved scope: prepare candidate artifacts, add read-only reboot qualification
automation, and characterize the shared status races with real stores. These
changes do not qualify Windows for rollout or repair the collector timeout.

## Candidate artifacts

A separate read-only GitHub Actions workflow builds the existing Windows ZIP
and pinned installer on Server 2022 with Node 22. It verifies both checksum
sidecars, expands into a new protected staging directory, runs the production
package validator, and binds package/native manifests to the checked-out Git
revision. It retains exactly the ZIP, installer, checksums and a sanitized
candidate report for 14 days. Candidates are explicitly unqualified. No release,
tag, registry publication, enrollment or Windows enablement occurs. The Linux
release workflow remains unchanged.

## Reboot evidence

An elevated Windows PowerShell 5.1 prepare/verify script observes an existing
settled installation; it never installs, restarts, reboots or changes service
policy. It writes only to a separate protected evidence directory. Preparation
captures machine identity, boot time, installation owner, selected manifest and
source revision, Node and service selection, config hash, launch and active
authentication evidence. Credentials and config contents are never written to
evidence or stdout. A second prepare cannot replace an existing checkpoint.

Verification requires a later boot on the same machine, the same installed
release/config/service identity, automatic LocalService startup, a different
launch, and active authentication bound to that launch and config after boot.
Pending installer journals/markers, missing evidence, changed credentials,
stopped services and same-boot runs fail closed. No background polling or
production timeout changes are added. Re-run verify after recovery settles.

The evaluator is pure JavaScript with fixture tests; the native probe uses
existing protected path, package and installation validators. Hosted CI runs
the actual probe against its disposable installation, then verifies same-boot
rejection. Fixture success is not reboot qualification. Even an observed reboot
pass proves local service/authentication evidence only: real backend durability,
interrupted-installation/power-loss recovery and minimum-host qualification are
separate gates.

## Shared status tests

The companion control-plane change uses real PostgreSQL and Redis, with a test
barrier delaying delivery of an actual missing GET response. It records the
existing intermediate offline state while replacement B is only Redis-claimed,
then B's final committed identity. It also protects a committed replacement
against old exact-ID cleanup, including metadata/settings and administrative
state. There are no runtime, schema, retry or periodic repair changes. The
ownership protocol gate in `control-plane/docs/design-docs/vm-connection-status-repair.md`
remains open.
