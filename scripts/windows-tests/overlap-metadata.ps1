# Counts include the live worker and all descendants. This corroborates the
# callback evidence; it does not identify collectors or measure native duration.
function Test-OverlapOwnedProcessCorroboration([long]$Active, [bool]$WorkerAlive) {
    return $WorkerAlive -and $Active -ge 10 -and $Active -le 1000
}

function Get-OverlapImageLabel([string]$Image) {
    if (@('win22', 'win25', 'win25-vs2026') -ccontains $Image) { return $Image }
    return $null
}

# Status derives independently from health, native overlap and owned cleanup.
function Get-OverlapStatus([System.Collections.IDictionary]$Report) {
    $worker = $Report.worker
    if ($null -eq $worker -or -not $worker.completed -or $Report.watchdog_fired -or $Report.supervisor_deadline_reached -or $Report.Contains('diagnostic_failure')) { return 'incomplete' }
    if (-not $Report.cleanup_confirmed -or -not $Report.owned_job_empty -or -not $worker.cleanup_complete) { return 'failed' }
    if ($worker.status -eq 'failed') { return 'failed' }
    if ($worker.status -eq 'inconclusive') { return 'inconclusive' }
    if ($worker.status -ne 'passed' -or -not $Report.Contains('worker_exit_code') -or $Report.worker_exit_code -ne 0) { return 'failed' }
    if (-not $Report.owned_process_count_corroborated -or $Report.job_sample_failures -gt 0) { return 'inconclusive' }
    return 'passed'
}
