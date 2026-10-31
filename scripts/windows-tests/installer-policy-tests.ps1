[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable hosted CI authorization required.' }
$serviceName = 'AcornOpsAgentV'; $sc = Join-Path ([Environment]::SystemDirectory) 'sc.exe'
if (Get-Service $serviceName -ErrorAction SilentlyContinue) { throw 'Refusing preexisting service.' }
$output = Join-Path $PSScriptRoot '..\..\artifacts\windows-installer-native'
$owned = $false
function Invoke-AgentVCiSc([string[]]$Arguments) { & $sc @Arguments | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Native SCM fixture setup failed.' } }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    & (Join-Path $PSScriptRoot '..\build-windows-host.ps1') -OutputDirectory $output
    $manifest = Get-Content (Join-Path $output 'host-manifest.json') -Raw | ConvertFrom-Json
    $library = Join-Path $output 'AgentV.InstallerNative.dll'
    Assert ((Get-FileHash $library -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.installerNative.binarySha256) 'Installer interop binary checksum mismatch.'
    $null = [Reflection.Assembly]::LoadFrom($library)
    $image = '"' + (Join-Path $output 'AgentV.ServiceHost.exe') + '" --node "C:\missing-ci-node.exe"'
    Invoke-AgentVCiSc -Arguments @('create',$serviceName,'binPath=',$image,'obj=','NT AUTHORITY\LocalService','start=','demand'); $owned = $true
    Invoke-AgentVCiSc -Arguments @('failure',$serviceName,'reset=','86400','actions=','restart/10000/restart/30000/restart/60000')
    Invoke-AgentVCiSc -Arguments @('failureflag',$serviceName,'0')
    $policy = [AcornOps.AgentV.InstallerPolicy]::Read()
    Assert ($policy.Standard -and $policy.StartType -eq 3) 'Exact owned failure policy was not recognized.'
    Invoke-AgentVCiSc -Arguments @('failure',$serviceName,'reset=','86400','actions=','restart/12345')
    $rejected = $false; try { [AcornOps.AgentV.InstallerPolicy]::DisableOwned() } catch { $rejected = $true }
    Assert $rejected 'Unknown custom failure policy was accepted.'
    Assert ([AcornOps.AgentV.InstallerPolicy]::Read().StartType -eq 3) 'Unknown-policy rejection mutated startup mode.'
    Invoke-AgentVCiSc -Arguments @('failure',$serviceName,'reset=','86400','actions=','restart/10000/restart/30000/restart/60000')
    [AcornOps.AgentV.InstallerPolicy]::DisableOwned()
    [AcornOps.AgentV.InstallerPolicy]::SuppressOwned()
    $policy = [AcornOps.AgentV.InstallerPolicy]::Read()
    Assert ($policy.Suppressed -and $policy.StartType -eq 4) 'Suppression did not retain disabled startup.'
    # This service has never started, so no queued-restart drain is required.
    [AcornOps.AgentV.InstallerPolicy]::MakeManual()
    Assert ([AcornOps.AgentV.InstallerPolicy]::Read().StartType -eq 3) 'Manual cutover startup not applied.'
    [AcornOps.AgentV.InstallerPolicy]::RestoreOwned(2)
    $policy = [AcornOps.AgentV.InstallerPolicy]::Read()
    Assert ($policy.Standard -and $policy.StartType -eq 2) 'Owned recovery policy did not restore.'
    Write-Output 'Native fixed-service failure policy query/reject/suppress/restore passed.'
} finally { if ($owned) { & $sc delete $serviceName | Out-Null } }
