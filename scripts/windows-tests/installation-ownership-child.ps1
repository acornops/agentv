[CmdletBinding()]
param([switch]$AllowDisposableCi,[ValidateSet('winner','loser')][string]$Role,[string]$Control)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
$modulePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\packaging\windows\Installation.psm1'))
$global:OwnershipCiControl=$Control
if($Role -eq 'loser'){
    # Debugger scheduling changes no product code. Pause the actual creation
    # statement after this contender has observed an absent installation root.
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile($modulePath,[ref]$tokens,[ref]$errors)
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Enter-AgentVInstallationOwner'},$true)
    $commands=@($function.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'New-AgentVProtectedDirectory'},$true))
    if($errors.Count -or $commands.Count -ne 1){throw 'Missing unique ownership creation boundary.'}
    $null=Set-PSBreakpoint -Script $modulePath -Line $commands[0].Extent.StartLineNumber -Action {
        [IO.File]::WriteAllText((Join-Path $global:OwnershipCiControl 'loser-paused'),'ready')
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while(-not(Test-Path (Join-Path $global:OwnershipCiControl 'release-loser'))){if($clock.Elapsed.TotalSeconds -gt 30){throw 'Ownership barrier deadline.'};Start-Sleep -Milliseconds 50}
    }
}
$module=Import-Module $modulePath -PassThru -Force
try{
    & $module {
        param($Role,$Control)
        $ownership=Enter-AgentVInstallationOwner
        try{
            if($Role -eq 'winner'){
                # A prepared journal is enough to exercise the real recovery
                # owner consistency check without synthetic SCM registration.
                Write-AgentVDurableJson -Path $script:Paths.Journal -Value @{ownerId=$ownership.Owner.id;terminal=$null;transaction=$null}
                [IO.File]::WriteAllText((Join-Path $Control 'winner-held'),'ready')
                $clock=[Diagnostics.Stopwatch]::StartNew()
                while(-not(Test-Path (Join-Path $Control 'release-winner'))){if($clock.Elapsed.TotalSeconds -gt 30){throw 'Ownership barrier deadline.'};Start-Sleep -Milliseconds 50}
            }
        }finally{$ownership.Lock.Dispose()}
    } -Role $Role -Control $Control
    exit 0
}catch{[Console]::Error.WriteLine('Ownership fixture contender refused.');exit 7}
