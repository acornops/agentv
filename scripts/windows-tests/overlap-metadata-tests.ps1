$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'overlap-metadata.ps1')
$report = @{
    worker = @{ completed = $true; cleanup_complete = $true; status = 'passed' }
    worker_exit_code = 0; cleanup_confirmed = $true; owned_job_empty = $true
    watchdog_fired = $false; supervisor_deadline_reached = $false
    owned_ten_processes_with_live_worker = $true; job_sample_failures = 0
}
if ((Get-OverlapStatus $report) -ne 'passed') { throw 'Complete owned composition evidence rejected.' }
$report.owned_ten_processes_with_live_worker = $false
if ((Get-OverlapStatus $report) -ne 'inconclusive') { throw 'Observed callback overlap alone falsely proves native overlap.' }
$report.owned_ten_processes_with_live_worker = $true; $report.job_sample_failures = 1
if ((Get-OverlapStatus $report) -ne 'inconclusive') { throw 'Failed accounting query falsely proves native overlap.' }
$report.job_sample_failures = 0; $report.watchdog_fired = $true
if ((Get-OverlapStatus $report) -ne 'incomplete') { throw 'Watchdog truncation manufactured success.' }
$report.watchdog_fired = $false; $report.supervisor_deadline_reached = $true
if ((Get-OverlapStatus $report) -ne 'incomplete') { throw 'Supervisor deadline manufactured success.' }
$report.supervisor_deadline_reached = $false; $report.worker.completed = $false
if ((Get-OverlapStatus $report) -ne 'incomplete') { throw 'Cleanup manufactured completed measurement.' }
$report.worker.completed = $true; $report.worker.cleanup_complete = $false
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Worker cleanup failure lost.' }
$report.worker.cleanup_complete = $true; $report.cleanup_confirmed = $false
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Owned cleanup failure lost.' }
$report.cleanup_confirmed = $true; $report.owned_job_empty = $false
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Active descendant passed cleanup.' }
$report.owned_job_empty = $true; $report.worker_exit_code = 1
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Nonzero worker exit manufactured success.' }
$report.worker.status = 'inconclusive'
if ((Get-OverlapStatus $report) -ne 'inconclusive') { throw 'Incomplete intended overlap was not retained.' }
$report.worker.status = 'failed'
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Native counts manufactured healthy results.' }
$report.diagnostic_failure = 'NATIVE_MEASUREMENT_UNAVAILABLE'
if ((Get-OverlapStatus $report) -ne 'incomplete') { throw 'Diagnostic failure manufactured a complete measurement.' }
$report.worker = $null
if ((Get-OverlapStatus $report) -ne 'incomplete') { throw 'Missing worker evidence passed.' }
Add-Type -Path (Join-Path $PSScriptRoot 'FirstCallJob.cs')
$job = [FirstCallJob]::new()
try {
    if ($job.ActiveProcesses() -ne 0 -or -not $job.Empty()) { throw 'New owned job accounting is not empty.' }
} finally { $job.Dispose() }
# NULL is a valid request for the caller's current job in the native API.
# A disposed fixture must return unavailable without issuing that request.
if ($job.ActiveProcesses() -ne -1 -or $job.Empty()) { throw 'Unavailable job accounting was treated as zero.' }
Write-Output 'Composition completion, native count, cleanup and accounting checks passed.'
