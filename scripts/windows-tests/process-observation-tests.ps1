[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('AgentV Process CI '+[char]0xfc)
$ps=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$script:CiProcesses=[Collections.Generic.List[Diagnostics.Process]]::new()
. (Join-Path $PSScriptRoot 'process-fixture.ps1')
if(Test-Path -LiteralPath $work){throw 'Refusing a preexisting process fixture directory.'}
$owned=$false
try{
    New-AgentVProtectedDirectory -Path $work;$owned=$true
    $child=Join-Path $work 'child.ps1'
    Write-AgentVDurableBytes -Path $child -Bytes ([Text.Encoding]::ASCII.GetBytes('param([int]$Code) exit $Code'))
    foreach($expected in @(0,7)){
        $process=Start-CiInstallerProcess -Name ('exit-'+$expected) -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$child,'-Code',([string]$expected))
        $completed=$process.WaitForExit(10000)
        $observed=if($completed){$process.ExitCode}else{$null}
        $value=if($null -eq $observed){'null'}else{[string][int]$observed}
        Write-Output ('Owned process observation expected='+$expected+' completed='+$completed+' observed='+$value)
        if(-not $completed -or $null -eq $observed -or $observed -ne $expected){throw 'The installation fixture did not observe its owned child exit code correctly.'}
    }
    Write-Output 'Owned child success and failure exit codes are observed correctly.'
}finally{
    foreach($process in $script:CiProcesses){if(-not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null};$process.Dispose()}
    if($owned){Remove-Item -LiteralPath $work -Recurse -Force}
}
