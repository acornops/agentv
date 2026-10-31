[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
$module=Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Installation.psm1') -PassThru -Force
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$paths=Get-AgentVPaths
$parent=Split-Path $paths.Root -Parent;$parentExisted=Test-Path -LiteralPath $parent;$owned=$false
if((Test-Path -LiteralPath $paths.Root) -or (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -or (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)){throw 'Refusing preexisting installation resources.'}
try{
    & $module {Assert-AgentVAdministrator}
    New-AgentVProtectedDirectory -Path $paths.Root;$owned=$true
    Write-AgentVDurableJson -Path $paths.Marker -Value @{schema='acornops.agentv-windows-active.v1';ownerId=[Guid]::NewGuid().ToString()}
    $before=(Get-FileHash $paths.Marker -Algorithm SHA256).Hash
    $rejected=$false
    try{$null=Invoke-AgentVRecovery}catch{$rejected=$true}
    if(-not $rejected){throw 'Recovery incorrectly reported idle with an active marker and missing journal.'}
    if(-not(Test-Path $paths.Marker) -or (Test-Path $paths.Journal) -or (Get-FileHash $paths.Marker -Algorithm SHA256).Hash -cne $before){throw 'Missing-journal refusal changed protected transaction evidence.'}
    Write-Output 'Recovery refuses active-marker/missing-journal state and preserves evidence.'
}finally{
    if($owned){Remove-Item -LiteralPath $paths.Root -Recurse -Force;if(-not $parentExisted){[IO.Directory]::Delete($parent)}}
}
