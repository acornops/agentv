[CmdletBinding()]
param([switch]$AllowDisposableCi, [switch]$TestAssignmentFailure)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or -not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:AGENTV_OVERLAP_ALLOW -ne 'true') { throw 'Explicit disposable hosted-CI authorization is required.' }
# Reuse the existing independent 12s watchdog and unnamed kill-on-close job.
# Only owned-job accounting is sampled; no process lookup, wait-chain or ETW path.
Add-Type -Path (Join-Path $PSScriptRoot 'FirstCallJob.cs')
. (Join-Path $PSScriptRoot 'first-call-metadata.ps1')
. (Join-Path $PSScriptRoot 'overlap-metadata.ps1')
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$report = [ordered]@{
    schema_version = 'acornops.overlap-native.v1'; diagnostic_only = $true
    fixture_kind = $(if ($TestAssignmentFailure) { 'assignment_negative' } else { 'component_composition' })
    startup_preflight = 'bypassed_component_only'; minimum_vm_representative = 'unknown'
    diagnostic_watchdog_ms = 12000; cleanup_budget_ms = 2000
    provenance = @{}; go_sent = $false; worker = $null
    watchdog_fired = $false; watchdog_termination_succeeded = $false; supervisor_deadline_reached = $false
    worker_exited = $false; owned_job_empty = $false; cleanup_confirmed = $false
    job_count_convention = 'includes_worker_and_all_owned_descendants'; job_sampling_interval_ms = 100
    owned_job_peak_including_worker = 0; owned_process_count_corroborated = $false
    job_sample_failures = 0; job_samples = @()
}
# Source/run/image provenance only; no arbitrary environment or paths.
foreach ($entry in @(
    @('revision', $env:GITHUB_SHA, '^[0-9a-f]{40}$'),
    @('run_id', $env:GITHUB_RUN_ID, '^[0-9]{1,20}$'),
    @('run_attempt', $env:GITHUB_RUN_ATTEMPT, '^[0-9]{1,6}$'),
    @('image_version', $env:ImageVersion, '^[0-9.]{1,32}$')
)) { if ($entry[1] -cmatch $entry[2]) { $report.provenance[$entry[0]] = $entry[1] } }
$image = Get-OverlapImageLabel $env:ImageOS
if ($null -ne $image) { $report.provenance.image = $image }
$job = $null; $worker = $null; $assigned = $false; $operation = 'setup'; $bytes = 0
try {
    $job = [FirstCallJob]::new()
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = Select-FirstCallExecutable @(Get-Command node -CommandType Application)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.WorkingDirectory = $repo
    $info.ArgumentList.Add((Join-Path $PSScriptRoot 'overlap-worker.mjs'))
    $operation = 'worker_start'
    $worker = [Diagnostics.Process]::Start($info)
    $stderr = $worker.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $operation = 'job_assignment'
    if ($TestAssignmentFailure) { throw 'FIXED_ASSIGNMENT_FAILURE' }
    # Worker cannot invoke any collector before the owning job is assigned.
    $job.Assign($worker.Handle); $assigned = $true
    $clock = [Diagnostics.Stopwatch]::StartNew(); $job.StartWatchdog()
    $worker.StandardInput.WriteLine('GO'); $worker.StandardInput.Close(); $report.go_sent = $true
    $pending = $worker.StandardOutput.ReadLineAsync(); $operation = 'observation'; $nextSample = 0
    while ($clock.ElapsedMilliseconds -lt 12000) {
        # Kernel accounting corroborates callback-derived counts even if Node
        # callbacks are delayed. This counts all owned descendants, not identities.
        if ($clock.ElapsedMilliseconds -ge $nextSample -and $report.job_samples.Count -lt 120) {
            $nextSample = $clock.ElapsedMilliseconds + 100
            $active = $job.ActiveProcesses()
            if ($active -lt 0 -or $active -gt 1000) { $report.job_sample_failures++ }
            else {
                $workerAlive = -not $worker.HasExited
                $report.job_samples += @{ at_ms = $clock.ElapsedMilliseconds; active_including_worker = $active; worker_alive = $workerAlive }
                $report.owned_job_peak_including_worker = [math]::Max($report.owned_job_peak_including_worker, $active)
                if (Test-OverlapOwnedProcessCorroboration $active $workerAlive) { $report.owned_process_count_corroborated = $true }
            }
        }
        if ($pending.IsCompleted) {
            $line = $pending.GetAwaiter().GetResult()
            if ($null -eq $line) { break }
            $bytes += [Text.Encoding]::UTF8.GetByteCount($line)
            if ($bytes -gt 1048576 -or $line.Length -gt 16384) { throw 'DIAGNOSTIC_OUTPUT_LIMIT' }
            # Only the fixed worker writes this stream; native output never does.
            $report.worker = $line | ConvertFrom-Json -AsHashtable
            $pending = $worker.StandardOutput.ReadLineAsync()
        }
        Start-Sleep -Milliseconds 10
    }
    $report.supervisor_deadline_reached = $clock.ElapsedMilliseconds -ge 12000
} catch {
    $report.diagnostic_failure = 'NATIVE_MEASUREMENT_UNAVAILABLE'; $report.diagnostic_failure_stage = $operation
    $report.exception = @(Get-FirstCallFailureMetadata $_.Exception)
} finally {
    # One shared finite budget for worker exit and aggregate owned descendants.
    # No nine fresh waits, no external PID lookup, no machine-wide termination.
    $cleanupClock = [Diagnostics.Stopwatch]::StartNew()
    if ($assigned) {
        $report.watchdog_fired = $job.WatchdogFired
        $report.watchdog_termination_succeeded = $job.WatchdogTerminationSucceeded
    }
    if ($null -ne $job) { $job.StopWatchdog() }
    try {
        if ($assigned) {
            # On EOF the worker normally has exited. Preserve its natural exit
            # before terminating any descendants still owned by the job.
            if (-not $worker.HasExited) { $null = $worker.WaitForExit(100) }
            $report.termination_requested = $job.Terminate()
        } elseif ($null -ne $worker -and -not $worker.HasExited) { $worker.Kill() }
        if ($null -ne $worker) {
            $report.worker_exited = $worker.WaitForExit([int][math]::Max(0, 2000 - $cleanupClock.ElapsedMilliseconds))
            if ($report.worker_exited) { $report.worker_exit_code = $worker.ExitCode }
        }
        if ($null -ne $job) {
            do {
                $report.owned_job_empty = $job.Empty()
                if ($report.owned_job_empty -or $cleanupClock.ElapsedMilliseconds -ge 2000) { break }
                Start-Sleep -Milliseconds 10
            } while ($true)
        }
        $report.cleanup_confirmed = $report.worker_exited -and $report.owned_job_empty
    } catch { $report.cleanup_failure = 'OWNED_CLEANUP_FAILED' }
    if ($null -ne $job) { $job.Dispose() }
    if ($null -ne $worker) { $worker.Dispose() }
    $report.status = Get-OverlapStatus $report
    $json = $report | ConvertTo-Json -Depth 12
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536) { throw 'Sanitized diagnostic exceeded 64 KiB.' }
    $artifact = Join-Path $repo 'artifacts/windows-collectors'
    $null = New-Item -ItemType Directory -Path $artifact -Force
    $name = if ($TestAssignmentFailure) { 'overlap-assignment-test.json' } else { 'overlap-native.json' }
    [IO.File]::WriteAllText((Join-Path $artifact $name), $json)
}
if ($TestAssignmentFailure) {
    if ($report.go_sent -or $null -ne $report.worker -or -not $report.cleanup_confirmed -or $report.diagnostic_failure_stage -ne 'job_assignment') { throw 'Assignment failure did not fail closed.' }
} elseif ($report.status -ne 'passed') { throw 'Composition observation failed or incomplete; inspect sanitized evidence.' }
