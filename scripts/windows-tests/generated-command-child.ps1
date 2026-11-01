[CmdletBinding()]
param([switch]$AllowDisposableCi,[string]$Control,[ValidateSet('initial','repair','replacement')][string]$Case,[ValidateSet('success','untrusted','http-error','bootstrap-error')][string]$Mode)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){exit 2}
# Parent assigns this process to its owned job before releasing the gate. Curl
# descendants therefore inherit containment, including on a command deadline.
$clock=[Diagnostics.Stopwatch]::StartNew()
while(-not(Test-Path -LiteralPath (Join-Path $Control 'go'))){if($clock.Elapsed.TotalSeconds -gt 15){exit 3};Start-Sleep -Milliseconds 50}
$env:TEMP=$Control;$env:TMP=$Control
$env:AGENTV_WRAPPER_CAPTURE=Join-Path $Control 'capture.json'
$env:AGENTV_WRAPPER_FAILURE=$Mode
$fixture=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'generated-command-fixtures.json') -Raw|ConvertFrom-Json
$selected=@($fixture.cases|Where-Object {$_.name -ceq $Case})
if($selected.Count -ne 1){exit 4}
$agentvTemporaryFile=$null;$agentvInstaller=$null;$LASTEXITCODE=$null;$failed=$false
try{
    # Execute the complete exact generated command, unchanged. Dot sourcing keeps
    # its actual two temp-path variables available for post-execution checks.
    $ErrorActionPreference='Continue'
    . ([ScriptBlock]::Create($selected[0].command))
}catch{$failed=$true}finally{$ErrorActionPreference='Stop'}
$result=[ordered]@{
    failed=$failed;curlExitCode=$LASTEXITCODE
    allocatedBoth=([bool]$agentvTemporaryFile -and [bool]$agentvInstaller)
    temporaryRemoved=($null -ne $agentvTemporaryFile -and -not(Test-Path -LiteralPath $agentvTemporaryFile))
    installerRemoved=($null -ne $agentvInstaller -and -not(Test-Path -LiteralPath $agentvInstaller))
    pathsOwned=($null -ne $agentvTemporaryFile -and [IO.Path]::GetDirectoryName($agentvTemporaryFile) -ceq $Control -and $agentvInstaller -ceq ($agentvTemporaryFile+'.ps1'))
}
[IO.File]::WriteAllText((Join-Path $Control 'result.json'),($result|ConvertTo-Json -Compress))
exit 0
