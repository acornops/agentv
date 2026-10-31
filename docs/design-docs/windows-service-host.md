# Windows service host decision for task 5

Status: approach and detailed corrections approved by independent technical review; native implementation and qualification pending.
Date: 2026-10-31. User already approved staged Windows implementation.

## Decision

Use a small, repository-owned C# SCM host targeting the Windows-provided .NET
Framework 4.8 API surface. Compile it in Windows package CI, include its source
revision and binary checksum in the Windows asset manifest, and install the
prebuilt executable. No NuGet dependencies, runtime compilation, or Linux
dependency/archive changes. Confirm .NET availability during installation;
never install machine prerequisites silently.

The host has exactly four responsibilities: implement SCM start/stop/shutdown,
contain the Node process tree, deliver a private start/stop pipe protocol, and
drain stdout/stderr into bounded files. Enrollment logic belongs in installer
scripts. Agent behavior stays in the existing Node AgentV product.

## Comparison and rationale

WinSW v2.12.0 is a pinned alternative with an existing SCM implementation,
documented LocalService configuration, process-tree stop behavior and rolling
child logs. It would reduce custom SCM code, but is a general-purpose wrapper
with a larger configuration/dependency surface. Its pinned WrapperService source
uses ProcessHelper.StopProcessTree on orderly stop and exits when its child
exits. The inspected source does not establish kernel-enforced descendant
cleanup after an abrupt wrapper failure. We would need additional containment
and environment rules, which erodes the small-adapter advantage. This is a
limited source finding, not a claim that every WinSW failure mode is unsafe.

A native host adds code we must maintain and review, especially handle lifetime
and stop/exit races. It provides a small fixed launch surface and an unnamed
Windows Job Object with KILL_ON_JOB_CLOSE and no breakaway flags. This directly
covers service-host crash, Node crash and collector descendants without a PID
file capable of targeting unrelated processes. Native CI must demonstrate the
claim before the package is qualified.

## Process ownership and startup ordering

1. Create an unnamed Job Object and set KILL_ON_JOB_CLOSE. The job handle is
   non-inheritable and retained only by the service host.
2. Launch the trusted absolute Node executable with a fixed Windows entry module
   and redirected anonymous stdin/stdout/stderr. Start with an allowlisted
   environment; omit all Node preload/debug overrides and unrelated credentials.
3. The fixed entry module initially waits for a bounded newline-delimited start
   command on stdin. It must not import runtime modules, open network connections
   or spawn collectors before that command. A timeout/EOF causes an error exit.
4. Assign the child to the job. If assignment fails, terminate that exact process
   and fail service startup. Send the start command only after successful job
   assignment. This trusted-child gate avoids a post-start collector escape race
   without building a general native CreateProcess command framework.
5. The entry module reads a protected JSON config, copies only named AgentV
   settings, and loads AgentV. No configuration string becomes code. Config path
   is an argument; credentials are never command-line values.
6. Node descendants inherit job membership. An unexpected Node exit (including
   zero) terminates the remaining job members, then exits the host with code 1
   without reporting SERVICE_STOPPED. Configure SCM restart actions explicitly
   (10s, 30s, 60s delays; reset after one day). Do not rely on a nonzero STOPPED
   status to trigger recovery and do not enable non-crash failure recovery.
   Serialize the watcher against an atomic stopping flag: deliberate stop marks
   that flag before sending STOP; the watcher then cannot initiate recovery.

SCM stop/shutdown sends a private stop command to the child. The entry module
invokes an explicit idempotent shutdown callback returned by Windows runtime
composition; standalone Windows uses that callback too. Never import the current
side-effectful Linux entry point from the service bootstrap. Preserve the Linux
signal handler and existing 250ms exit behavior. Retain STOP received while
async Windows startup is pending and invoke shutdown as soon as a handle exists.

Wait at most 15 seconds for graceful Node exit, then terminate remaining job
members while retaining the handle. Query JobObjectBasicAccountingInformation
until ActiveProcesses is zero (bounded 5-second final deadline); a waitable job
handle is not an emptiness signal. Report successful STOPPED only after observed
zero. If teardown cannot be confirmed, report a nonzero stopped status and a
bounded error, dispose the job, and do not claim clean shutdown. Deliberate stop
must not trigger automatic recovery. A host crash closes the last job handle in
the kernel. No persisted PID lookup and no process killing by name.

## Identity, paths and logs

Run as NT AUTHORITY\\LocalService with a unique service SID (AcornOpsAgentV).
Grant read/execute to that service SID on the immutable runtime, read on its
protected configuration, and modify only on its dedicated logs/runtime-state
directories. Administrators and SYSTEM retain full control. Other LocalService
processes must not gain access merely through a broad LocalService ACL.
Use service SID configuration explicitly and test token/ACL behavior natively.

Installer checks existing path components and refuses reparse points or runtime/
configuration paths writable by untrusted principals. Fixed ProgramData and
Program Files paths come from OS folder APIs; a caller environment variable is
not the trust authority. Accept an alternative Node executable only after the
same trust checks as the default installed runtime. Node major 22/24 and x64
are the initial qualification matrix; Windows Server product type/build is
checked independently of the mock/live selector.

Drain stdout and stderr in fixed byte chunks rather than unbounded line buffers.
Use a bounded rotating sink (5 MiB current plus three retained files) and bound
host diagnostics too. Never echo config content, enrollment tokens, transaction
secrets, arbitrary child arguments, or environment dumps. On a sink failure,
keep draining/discarding bytes and emit at most one bounded host diagnostic;
do not deadlock the child on a full pipe.

The executable launch and argument quoting support spaces and Unicode. No
shell, PATH search, profile loading, command expansion or service startup
download. Protected config only influences the known AgentV setting keys.

## Native evidence required

- Service runs with LocalService plus its unique SID, and both an unrelated
  low-privilege user and a separate LocalService service cannot read credentials
  or write runtime/config. Log draining has no unbounded queue and cannot keep
  service teardown waiting indefinitely.
- SCM start/stop/shutdown succeeds on Windows Server 2022/2025, Node22/24.
- Instrumented child does not start a collector before the job-start gate.
- Kill host and kill Node separately while a collector child is alive: all
  descendants terminate and SCM recovers exactly one active agent tree.
- Stop timeout terminates only the contained tree; repeated stop/exit race
  checks terminate cleanly without hanging or accidental restarts.
- Logs remain bounded for oversized lines and large stdout/stderr streams;
  inaccessible/full log destination cannot block shutdown.
- Paths with spaces/non-ASCII, missing/invalid trusted runtime, unsupported
  version, untrusted ACLs and reparse points fail safely.
- Package source/manifest/checksum binds the host. Existing Linux package smoke
  and real systemd gates continue unchanged.

Actual reboot recovery, installer credential commit interruption and Windows
Core vs Desktop Experience remain separate qualification requirements. Passing
this service-host suite alone does not enable Windows onboarding or writes.

## Primary references inspected

- [Pinned WinSW XML configuration](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/doc/xmlConfigFile.md)
- [Pinned WinSW service source](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/WrapperService.cs)
- [Pinned WinSW logging](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/doc/loggingAndErrorReporting.md)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [SCM ServiceBase](https://learn.microsoft.com/en-us/dotnet/api/system.serviceprocess.servicebase)
- [LocalService account](https://learn.microsoft.com/en-us/windows/win32/services/localservice-account)
- [Service SID configuration](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_sid_info)
- [.NET Framework OS availability](https://learn.microsoft.com/en-us/dotnet/framework/install/versions-and-dependencies)

Microsoft documents .NET4.8 with Server2022 and .NET4.8.1 with Server2025. The
host targets the older supported API surface, while installation still checks
that the required component is enabled. These documents establish API intent;
our tests must establish the implementation's behavior.
