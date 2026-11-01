# Windows candidate and reboot qualification tools

Windows remains unqualified for rollout. These tools prepare evidence; they do
not change the Linux runtime, publish a Windows release, enable enrollment or
resolve the intermittent collector timeout.

## Candidate artifacts

The **Windows candidate preparation** Actions workflow runs on pull requests or
manual dispatch. Its `windows-candidate-<revision>` artifact expires after 14 days
and contains the existing versioned ZIP, pinned installer, both SHA256 sidecars
and `candidate-evidence.json`. The report binds the assets to the checked-out
source revision (a pull-request run normally checks out the merge commit).

Verification checks the pinned installer, exact package inventory, every file
hash, native manifest and source revision. The workflow also corrupts disposable
outputs to check rejection, restores the original bytes and verifies them again
before upload. These downloadable candidates are not published release assets.
Immutable production hosting, signing/provenance policy and rollout approval
remain separate release work. The Linux release workflow is unchanged.

## Read-only reboot check

Use a disposable Windows Server 2022/2025 x64 host with an already settled AgentV
installation and an available control plane. Run from a trusted checkout of this
feature branch in elevated Windows PowerShell 5.1. Use a new evidence directory
outside the AgentV installation directories:

```powershell
.\scripts\windows-qualification\reboot.ps1 -Mode prepare -EvidenceDirectory C:\ProgramData\AgentV-Reboot-Check-1
```

Preparation validates the package, service identity and protected configuration,
then saves an administrator/SYSTEM-only checkpoint. It records hashes, boot and
launch identity, and active authentication evidence; it never saves the agent
key or full configuration. Keep the checkpoint private. A second prepare refuses
to overwrite it. The script uses the trusted Node executable already selected by
the installation; an explicit `-NodePath` must name that same executable.

Reboot the disposable host through your normal authorized procedure, wait for
automatic service startup and connection, then run:

```powershell
.\scripts\windows-qualification\reboot.ps1 -Mode verify -EvidenceDirectory C:\ProgramData\AgentV-Reboot-Check-1
```

The script never reboots, restarts, installs, reenrolls or invokes recovery. Each
invocation observes once and writes `report.json`. A rejected observation exits
nonzero; inspect the report's check IDs and rerun verify after recovery settles.
Missing service evidence, a pending transaction or any changed credential,
package, Node or service identity fails qualification. A same-boot service restart
cannot pass. Successful verification reports `observed-reboot-pass` only for a
later boot on the same machine with a new launch and active authentication after
that boot, bound to the unchanged configuration.

This result is local service/authentication evidence, not proof of durable
backend status or every reboot recovery path. Separately check control-plane
reconnection/snapshots. Interrupted installation, power loss, minimum hardware,
Core/Desktop variants and combined real-backend tests remain qualification gates.
Delete only your evidence directory when finished.

## Hosted checks and current boundary

Hosted CI tests the evaluator with synthetic before/after observations and runs
the actual native probe during the disposable installer startup scenario. It
checks preparation, refusal to overwrite a checkpoint, same-boot rejection and
stopped-service rejection. Its artifacts explicitly record reboot qualification
as **not executed**. No actual reboot has been qualified by these fixtures.

Companion control-plane tests use real PostgreSQL/Redis to preserve committed
replacement identity and characterize the existing intermediate offline state
when a missing Redis response is delayed across a replacement claim. They do not
repair orphaned status after an outage or establish cross-store atomicity.

Exact source revisions, hosted runs, retained failure evidence and remaining
gates are recorded in the [completed preparation plan](exec-plans/completed/windows-qualification-preparation.md).
