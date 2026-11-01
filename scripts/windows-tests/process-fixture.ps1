# Shared by disposable native qualification fixtures only.
function Start-CiInstallerProcess([string[]]$Arguments,[string]$Name){
    $quoted=@($Arguments | ForEach-Object { if($_.Contains('"')){throw 'Unsafe CI argument'}; '"'+$_+'"' })
    $process=Start-Process -FilePath $ps -ArgumentList $quoted -PassThru -RedirectStandardOutput (Join-Path $work ($Name+'.stdout')) -RedirectStandardError (Join-Path $work ($Name+'.stderr'))
    # PS5 Start-Process can lose ExitCode after the child exits unless its
    # native process handle was retained while it was still running.
    $null=$process.Handle
    $script:CiProcesses.Add($process)
    return $process
}
