$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'overlap-metadata.ps1')
$report = @{
    worker = @{ completed = $true; cleanup_complete = $true; status = 'passed' }
    worker_exit_code = 0; cleanup_confirmed = $true; owned_job_empty = $true
    watchdog_fired = $false; supervisor_deadline_reached = $false
    owned_process_count_corroborated = $true; job_sample_failures = 0
}
foreach ($case in @(
    @{ active = 10; alive = $true; corroborated = $true; status = 'passed' },
    @{ active = 19; alive = $true; corroborated = $true; status = 'passed' },
    @{ active = 9; alive = $true; corroborated = $false; status = 'inconclusive' },
    @{ active = -1; alive = $true; corroborated = $false; status = 'inconclusive' },
    @{ active = 19; alive = $false; corroborated = $false; status = 'inconclusive' },
    @{ active = 1001; alive = $true; corroborated = $false; status = 'inconclusive' }
)) {
    $report.owned_process_count_corroborated = Test-OverlapOwnedProcessCorroboration $case.active $case.alive
    if ($report.owned_process_count_corroborated -ne $case.corroborated -or (Get-OverlapStatus $report) -ne $case.status) { throw 'Aggregate owned-process corroboration misclassified.' }
}
$report.owned_process_count_corroborated = Test-OverlapOwnedProcessCorroboration 19 $true
$report.worker.status = 'failed'
if ((Get-OverlapStatus $report) -ne 'failed') { throw 'Nineteen owned processes manufactured healthy results.' }
$report.worker.status = 'passed'
foreach ($label in @('win22', 'win25', 'win25-vs2026')) {
    if ((Get-OverlapImageLabel $label) -cne $label) { throw 'Known image label omitted.' }
}
foreach ($label in @('', 'win25-vs2027', 'win22-private', 'WIN25', 'private-credential', ('x' * 10000))) {
    if ($null -ne (Get-OverlapImageLabel $label)) { throw 'Unknown image label entered provenance.' }
}
if ((Get-OverlapStatus $report) -ne 'passed') { throw 'Complete owned composition evidence rejected.' }
$report.owned_process_count_corroborated = $false
if ((Get-OverlapStatus $report) -ne 'inconclusive') { throw 'Observed callback overlap alone falsely proves native overlap.' }
$report.owned_process_count_corroborated = $true; $report.job_sample_failures = 1
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
