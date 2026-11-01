$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'first-call-metadata.ps1')
$inner = [ComponentModel.Win32Exception]::new(2, 'private-path-and-command')
$fixtureError = [InvalidOperationException]::new('private-environment', $inner)
$summary = @(Get-FirstCallFailureMetadata $fixtureError)
if ($summary.Count -ne 2 -or $summary[0].kind -ne 'invalid_operation' -or $summary[1].kind -ne 'win32' -or $summary[1].native_code -ne 2) { throw 'Failure category or code not retained.' }
if ($summary[0].hresult -ne -2146233079 -or $summary[1].hresult -ne -2147467259) { throw 'Numeric HRESULT not retained.' }
if (($summary | ConvertTo-Json -Depth 4) -match 'private|path|command|environment') { throw 'Exception redaction failed.' }
$unknown = @(Get-FirstCallFailureMetadata ([ApplicationException]::new('private')))
if ($unknown[0].kind -ne 'other' -or $unknown[0].ContainsKey('native_code')) { throw 'Unknown exception was not bounded.' }
for ($i = 0; $i -lt 10; $i++) { $fixtureError = [InvalidOperationException]::new('private', $fixtureError) }
if (@(Get-FirstCallFailureMetadata $fixtureError).Count -ne 4) { throw 'Exception chain was not bounded.' }
Write-Output 'Native diagnostic exception metadata checks passed.'
$report = @{
    worker = @{ completed = $true; gate_passed = $true }
    worker_exit_code = 0; cleanup_confirmed = $true; owned_job_empty = $true
    native = @{ cpu_samples = @(@{ user_ms = 1; kernel_ms = 1 }); process_lifetime_ms = 20; user_cpu_ms = 1; kernel_cpu_ms = 1 }
    watchdog_fired = $false; watchdog_termination_succeeded = $false
    watchdog_pre_cleanup = @{ worker_exited = $true; target_exited = $true; job_empty = $true }
}
$status = Get-FirstCallStatus $report
if (-not $status.collector_passed -or -not $status.measurement_complete -or -not $status.cleanup_complete -or $status.watchdog_proven) { throw 'Independent statuses were not preserved.' }
$report.supervisor_deadline_reached = $true
if ((Get-FirstCallStatus $report).watchdog_proven) { throw 'Supervisor deadline falsely proves independent watchdog.' }
$report.watchdog_fired = $true
if ((Get-FirstCallStatus $report).watchdog_proven) { throw 'Callback entry without termination falsely proves watchdog.' }
$report.watchdog_termination_succeeded = $true
$report.watchdog_pre_cleanup.job_empty = $false
if ((Get-FirstCallStatus $report).watchdog_proven) { throw 'Ordinary cleanup falsely proves watchdog cleanup.' }
$report.watchdog_pre_cleanup.job_empty = $true
if (-not (Get-FirstCallStatus $report).watchdog_proven) { throw 'Complete pre-cleanup watchdog evidence rejected.' }
$report.native.cpu_samples = @()
$status = Get-FirstCallStatus $report
if ($status.measurement_complete -or -not $status.collector_passed) { throw 'Missing native measurements must fail observation only.' }
$report.native.cpu_samples = @(@{ user_ms = 1; kernel_ms = 1 })
$report.native.timing_unavailable = $true
if ((Get-FirstCallStatus $report).measurement_complete) { throw 'Unavailable timing passed measurement gate.' }
$report.native.Remove('timing_unavailable'); $report.native.target_unavailable = $true
if ((Get-FirstCallStatus $report).measurement_complete) { throw 'Unavailable target passed measurement gate.' }
$report.worker.cleanup_failure = $true
$status = Get-FirstCallStatus $report
if ($status.cleanup_complete -or -not $status.collector_passed) { throw 'Worker cleanup failure must preserve collector outcome.' }
$report.worker.Remove('cleanup_failure'); $report.worker_exit_code = 1
if ((Get-FirstCallStatus $report).cleanup_complete) { throw 'Nonzero worker exit passed cleanup gate.' }
Write-Output 'Native diagnostic observation and watchdog regression checks passed.'
