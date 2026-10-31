# Shared by disposable native qualification fixtures only.
function Start-CiInstallerProcess([string[]]$Arguments,[string]$Name){
    $quoted=@($Arguments | ForEach-Object { if($_.Contains('"')){throw 'Unsafe CI argument'}; '"'+$_+'"' })
    $process=Start-Process -FilePath $ps -ArgumentList $quoted -PassThru -RedirectStandardOutput (Join-Path $work ($Name+'.stdout')) -RedirectStandardError (Join-Path $work ($Name+'.stderr'))
    $script:CiProcesses.Add($process)
    return $process
}
