[CmdletBinding()]
param([switch]$AllowDisposableCi, [switch]$TestWatchdog)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:AGENTV_FIRST_CALL_ALLOW -ne 'true') { throw 'Explicit disposable hosted-CI authorization is required.' }
# No ETW session is started: available tooling does not establish a validated,
# bounded, allowlisted headless scheduling/stack summarizer.
Add-Type -Path (Join-Path $PSScriptRoot 'FirstCallJob.cs')
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$artifact = Join-Path $repo 'artifacts/windows-collectors'
$report = [ordered]@{
    schema_version = 'acornops.first-call-native.v1'; diagnostic_only = $true
    diagnostic_watchdog_ms = 12000; sampling_interval_ms = 100
    etw = 'unavailable_no_validated_bounded_summarizer'; warm_control = 'not_run'
    provenance = @{ revision = $env:GITHUB_SHA; run_id = $env:GITHUB_RUN_ID; run_attempt = $env:GITHUB_RUN_ATTEMPT; image = $env:ImageOS; image_version = $env:ImageVersion }
    tooling = @{ wpr_present = (Test-Path (Join-Path ([Environment]::SystemDirectory) 'wpr.exe')); wpaexporter_present = (Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Windows Performance Toolkit\wpaexporter.exe") }
    watchdog_fired = $false; cleanup_confirmed = $false; worker = $null
    native = @{ samples = 0; sample_failures = 0; thread_states = @(0,0,0,0,0,0,0,0); wait_reasons = @(0,0,0,0,0,0,0,0,0,0,0,0,0,0); thread_sample_truncated = $false; cpu_samples = @() }
}
$job = $null; $worker = $null; $target = $null; $assigned = $false; $pending = $null; $bytes = 0; $operation = 'setup'
try {
    $job = [FirstCallJob]::new()
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command node -CommandType Application).Source
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.WorkingDirectory = $repo
    if ($TestWatchdog) {
        # Fixed negative fixture starts only after assignment; its child must die
        # with the unnamed job. The first production call always runs before this.
        $info.ArgumentList.Add('-e')
        $info.ArgumentList.Add('process.stdin.once("data",()=>{const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log("PID:"+c.pid);setInterval(()=>{},1000)});')
    } else { $info.ArgumentList.Add((Join-Path $PSScriptRoot 'first-call-worker.mjs')) }
    $operation = 'worker_start'
    $worker = [Diagnostics.Process]::Start($info)
    # Worker is inert until GO, so no descendant can escape pre-assignment.
    $operation = 'job_assignment'
    $job.Assign($worker.Handle); $assigned = $true
    $stderr = $worker.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null) # Discard without retention.
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $job.StartWatchdog()
    $worker.StandardInput.WriteLine('GO'); $worker.StandardInput.Close()
    $pending = $worker.StandardOutput.ReadLineAsync()
    $nextSample = 0
    $operation = 'observation'
    while ($clock.ElapsedMilliseconds -lt 12000) {
        if ($pending.IsCompleted) {
            $line = $pending.GetAwaiter().GetResult()
            if ($null -eq $line) { break }
            $bytes += [Text.Encoding]::UTF8.GetByteCount($line)
            if ($bytes -gt 1048576 -or $line.Length -gt 65536) { throw 'DIAGNOSTIC_OUTPUT_LIMIT' }
            if ($line -match '^PID:([0-9]{1,10})$') {
                if ($null -ne $target) { throw 'DUPLICATE_TARGET' }
                $target = [Diagnostics.Process]::GetProcessById([int]$Matches[1])
                if (-not $job.Contains($target.Handle)) { $target.Dispose(); $target = $null; throw 'TARGET_NOT_OWNED' }
            } else {
                # Input comes only from the fixed allowlisting worker; never copy
                # process stdout or stderr from the production PowerShell child.
                $report.worker = $line | ConvertFrom-Json -AsHashtable
                if (-not $report.Contains('observation_origin_received_ms')) { $report.observation_origin_received_ms = $clock.ElapsedMilliseconds }
            }
            $pending = $worker.StandardOutput.ReadLineAsync()
        }
        if ($null -ne $target -and $clock.ElapsedMilliseconds -ge $nextSample -and $report.native.samples -lt 120) {
            $nextSample = $clock.ElapsedMilliseconds + 100
            try {
                $target.Refresh()
                if ($target.HasExited -and -not $report.native.ContainsKey('exit_observed_by_supervisor_ms')) { $report.native.exit_observed_by_supervisor_ms = $clock.ElapsedMilliseconds }
                if (-not $target.HasExited) {
                    $report.native.samples++
                    $report.native.cpu_samples += @{ at_supervisor_ms = $clock.ElapsedMilliseconds; user_ms = [math]::Round($target.UserProcessorTime.TotalMilliseconds); kernel_ms = [math]::Round($target.PrivilegedProcessorTime.TotalMilliseconds) }
                    $count = 0
                    foreach ($thread in $target.Threads) {
                        if (++$count -gt 128) { $report.native.thread_sample_truncated = $true; break }
                        $state = [int]$thread.ThreadState
                        if ($state -ge 0 -and $state -lt 8) { $report.native.thread_states[$state]++ }
                        if ($state -eq 5) { $reason = [int]$thread.WaitReason; if ($reason -ge 0 -and $reason -lt 14) { $report.native.wait_reasons[$reason]++ } }
                    }
                }
            } catch { $report.native.sample_failures++ }
        }
        Start-Sleep -Milliseconds 10
    }
    if ($clock.ElapsedMilliseconds -ge 12000 -or $job.WatchdogFired) { $report.watchdog_fired = $true }
} catch { $report.diagnostic_failure = 'NATIVE_MEASUREMENT_UNAVAILABLE'; $report.diagnostic_failure_stage = $operation }
finally {
    if ($null -ne $target) {
        try { if ($target.HasExited -and -not $report.native.ContainsKey('exit_observed_by_supervisor_ms')) { $report.native.exit_observed_by_supervisor_ms = $clock.ElapsedMilliseconds } } catch { }
    }
    # Always terminate only this invocation's owned job, including success. No
    # system-wide taskkill, trace cancellation, or PID-based termination.
    if ($null -ne $job) { $job.StopWatchdog() }
    try {
    if ($assigned) { $report.watchdog_fired = $report.watchdog_fired -or $job.WatchdogFired; $report.termination_requested = $job.Terminate() }
    elseif ($null -ne $worker -and -not $worker.HasExited) { $worker.Kill() }
    if ($null -ne $worker) {
        $report.cleanup_confirmed = $worker.WaitForExit(2000)
    }
    if ($null -ne $target) {
        try {
            $exited = $target.WaitForExit(2000)
            $report.cleanup_confirmed = $report.cleanup_confirmed -and $exited
            if ($exited) {
                $report.native.process_lifetime_ms = [math]::Round(($target.ExitTime - $target.StartTime).TotalMilliseconds)
                $report.native.user_cpu_ms = [math]::Round($target.UserProcessorTime.TotalMilliseconds)
                $report.native.kernel_cpu_ms = [math]::Round($target.PrivilegedProcessorTime.TotalMilliseconds)
                $report.native.exited_before_cleanup = $report.native.ContainsKey('exit_observed_by_supervisor_ms')
            }
        } catch { $report.native.timing_unavailable = $true; $report.cleanup_confirmed = $false }
        $target.Dispose()
    } else { $report.native.target_unavailable = $true }
    if ($assigned) { $report.owned_job_empty = $job.Empty(); $report.cleanup_confirmed = $report.cleanup_confirmed -and $report.owned_job_empty }
    } catch { $report.cleanup_confirmed = $false; $report.cleanup_failure = 'OWNED_CLEANUP_FAILED' }
    if ($null -ne $job) { $job.Dispose() }
    if ($null -ne $worker) { $worker.Dispose() }
    $null = New-Item -ItemType Directory -Path $artifact -Force
    $name = if ($TestWatchdog) { 'first-call-watchdog-test.json' } else { 'first-call-diagnostic.json' }
    $json = $report | ConvertTo-Json -Depth 12
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536) { throw 'Sanitized diagnostic exceeded 64 KiB.' }
    [IO.File]::WriteAllText((Join-Path $artifact $name), $json)
}
if ($TestWatchdog) {
    if (-not $report.watchdog_fired -or -not $report.cleanup_confirmed -or $null -eq $target) { throw 'Owned watchdog cleanup test failed.' }
} elseif ($report.Contains('diagnostic_failure') -or $report.watchdog_fired -or -not $report.cleanup_confirmed -or $null -eq $report.worker -or -not $report.worker.ContainsKey('completed') -or -not $report.worker.gate_passed) {
    throw 'First call failed or diagnostic unavailable; inspect sanitized evidence.'
}
