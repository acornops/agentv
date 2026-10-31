[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
$module=Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Installation.psm1') -PassThru -Force
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$paths=Get-AgentVPaths
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AgentV Ownership CI'
$parent=Split-Path $paths.Root -Parent;$parentExisted=Test-Path -LiteralPath $parent;$owned=$false
$ps=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$script:CiProcesses=[Collections.Generic.List[Diagnostics.Process]]::new()
. (Join-Path $PSScriptRoot 'process-fixture.ps1')
function Wait-OwnershipCi([string]$Name){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not(Test-Path (Join-Path $work $Name))){if($clock.Elapsed.TotalSeconds -gt 20){throw 'Ownership interleaving was not reached.'};Start-Sleep -Milliseconds 50}}
foreach($interleaving in @('held','released')){
$script:CiProcesses=[Collections.Generic.List[Diagnostics.Process]]::new();$owned=$false
if((Test-Path $work) -or (Test-Path $paths.Root) -or (Test-Path $paths.Program) -or (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -or (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)){throw 'Refusing preexisting installation resources.'}
try{
    & $module {Assert-AgentVAdministrator}
    New-AgentVProtectedDirectory -Path $work;$owned=$true
    $child=Join-Path $PSScriptRoot 'installation-ownership-child.ps1'
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$child,'-AllowDisposableCi','-Control',$work)
    $loser=Start-CiInstallerProcess -Name 'loser' -Arguments ($arguments+@('-Role','loser'))
    Wait-OwnershipCi 'loser-paused'
    $winner=Start-CiInstallerProcess -Name 'winner' -Arguments ($arguments+@('-Role','winner'))
    Wait-OwnershipCi 'winner-held'
    $owner=Read-AgentVJson -Path $paths.Owner -Secret
    $journal=Read-AgentVJson -Path $paths.Journal -Secret
    $before=(Get-FileHash $paths.Owner -Algorithm SHA256).Hash
    if($interleaving -eq 'released'){
        [IO.File]::WriteAllText((Join-Path $work 'release-winner'),'continue')
        if(-not $winner.WaitForExit(10000) -or $null -eq $winner.ExitCode -or $winner.ExitCode -ne 0){throw 'Winning owner did not release its lock.'}
    }
    [IO.File]::WriteAllText((Join-Path $work 'release-loser'),'continue')
    $expectedExit=if($interleaving -eq 'held'){7}else{0}
    if(-not $loser.WaitForExit(10000) -or $null -eq $loser.ExitCode -or $loser.ExitCode -ne $expectedExit){throw 'Fresh contender did not respect the actual lock state.'}
    $unchanged=(Get-FileHash $paths.Owner -Algorithm SHA256).Hash -ceq $before
    Write-Output ('Fresh ownership interleaving='+$interleaving+' loserExit='+$loser.ExitCode+' ownerUnchanged='+$unchanged)
    if(-not $unchanged -or (Read-AgentVJson -Path $paths.Owner -Secret).id -cne $journal.ownerId -or $owner.id -cne $journal.ownerId){throw 'Losing fresh installer changed the winning owner identity or journal binding.'}
    [IO.File]::WriteAllText((Join-Path $work 'release-winner'),'continue')
    if(-not $winner.WaitForExit(10000) -or $null -eq $winner.ExitCode -or $winner.ExitCode -ne 0){throw 'Winning owner did not complete.'}
    if((Invoke-AgentVRecovery) -cne 'prepared'){throw 'Subsequent recovery did not retain consistent prepared ownership.'}
    Write-Output 'Concurrent fresh installation preserves owner and journal identity; actual prepared recovery accepts ownership.'
    # A validation failure after acquiring ownership must release the lock and
    # preserve the rejected owner, never repair or replace it implicitly.
    Write-AgentVDurableJson -Path $paths.Owner -Value @{schema='invalid';id=$owner.id}
    $rejected=$false
    try{& $module {$lease=Enter-AgentVInstallationOwner;$lease.Lock.Dispose()}}catch{$rejected=$true}
    if(-not $rejected -or (Read-AgentVJson -Path $paths.Owner -Secret).schema -cne 'invalid'){throw 'Invalid owner was accepted or changed.'}
    $released=Enter-AgentVLock -Path $paths.Lock;$released.Dispose()
    Remove-Item -LiteralPath $paths.Owner -Force
    $before=(Get-FileHash $paths.Journal -Algorithm SHA256).Hash
    $rejected=$false
    try{& $module {$lease=Enter-AgentVInstallationOwner;$lease.Lock.Dispose()}}catch{$rejected=$true}
    if(-not $rejected -or (Test-Path $paths.Owner) -or (Get-FileHash $paths.Journal -Algorithm SHA256).Hash -cne $before){throw 'Unowned existing root was adopted or changed.'}
    Write-Output 'Initialization validation releases its lock and refuses an existing root without ownership.'
}finally{
    foreach($process in $script:CiProcesses){if(-not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null};$process.Dispose()}
    if($owned){if(Test-Path $paths.Root){Remove-Item -LiteralPath $paths.Root -Recurse -Force};if(-not $parentExisted -and (Test-Path $parent)){[IO.Directory]::Delete($parent)};Remove-Item -LiteralPath $work -Recurse -Force}
}
}
