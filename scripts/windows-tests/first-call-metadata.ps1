# Fixed labels and numeric codes only. Never serialize messages, type names,
# stacks, Data, paths, command lines or environment values.
function Get-FirstCallFailureMetadata([Exception]$Exception) {
    $kinds = @{
        'System.Management.Automation.MethodInvocationException' = 'method_invocation'
        'System.Management.Automation.RuntimeException' = 'powershell_runtime'
        'System.ComponentModel.Win32Exception' = 'win32'
        'System.InvalidOperationException' = 'invalid_operation'
        'System.ArgumentException' = 'argument'
        'System.ArgumentNullException' = 'argument_null'
        'System.IO.FileNotFoundException' = 'file_not_found'
        'System.IO.DirectoryNotFoundException' = 'directory_not_found'
        'System.UnauthorizedAccessException' = 'access_denied'
        'System.PlatformNotSupportedException' = 'platform_not_supported'
    }
    for ($depth = 0; $null -ne $Exception -and $depth -lt 4; $depth++) {
        $type = $Exception.GetType().FullName
        $kind = if ($kinds.ContainsKey($type)) { $kinds[$type] } else { 'other' }
        $safe = @{ kind = $kind; hresult = [int]$Exception.HResult }
        if ($Exception -is [ComponentModel.Win32Exception]) { $safe.native_code = [int]$Exception.NativeErrorCode }
        $safe
        $Exception = $Exception.InnerException
    }
}

function Get-FirstCallStatus([System.Collections.IDictionary]$Report) {
    $worker = $Report.worker
    $native = $Report.native
    $collector = $null -ne $worker -and $worker.Contains('completed') -and $worker.completed -and $worker.Contains('gate_passed') -and $worker.gate_passed
    $measurement = $null -ne $native -and -not $native.Contains('target_unavailable') -and -not $native.Contains('timing_unavailable') -and $native.cpu_samples.Count -gt 0
    foreach ($name in @('process_lifetime_ms', 'user_cpu_ms', 'kernel_cpu_ms')) {
        $measurement = $measurement -and $native.Contains($name) -and $native[$name] -ge 0
    }
    $cleanup = $Report.cleanup_confirmed -and $Report.Contains('owned_job_empty') -and $Report.owned_job_empty -and $Report.Contains('worker_exit_code') -and $Report.worker_exit_code -eq 0 -and $null -ne $worker -and -not $worker.Contains('cleanup_failure')
    $watchdog = $Report.watchdog_fired -and $Report.Contains('watchdog_termination_succeeded') -and $Report.watchdog_termination_succeeded -and $Report.Contains('watchdog_pre_cleanup')
    if ($watchdog) { $watchdog = $Report.watchdog_pre_cleanup.worker_exited -and $Report.watchdog_pre_cleanup.target_exited -and $Report.watchdog_pre_cleanup.job_empty }
    return @{ collector_passed = [bool]$collector; measurement_complete = [bool]$measurement; cleanup_complete = [bool]$cleanup; watchdog_proven = [bool]$watchdog }
}

function Select-FirstCallExecutable([object[]]$Commands) {
    # Get-Command can return multiple application matches. Preserve its order;
    # assigning all Source values to a string would create an invalid path.
    return [string]$Commands[0].Source
}
