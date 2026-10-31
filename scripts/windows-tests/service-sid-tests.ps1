[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
if(Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue){throw 'SID characterization requires the fixed service to be absent.'}
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$sc=Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$output=(& $sc showsid AcornOpsAgentV | Out-String)
if($LASTEXITCODE -ne 0 -or $output.Length -gt 4096){throw 'Native fixed-name SID observation failed.'}
$matches=[Regex]::Matches($output,'\bS-1-5-80-(?:[0-9]{1,10}-){4}[0-9]{1,10}\b')
if($matches.Count -ne 1){throw 'Native fixed-name SID observation was ambiguous.'}
$expected=$matches[0].Value
$observed=$null
try{$observed=Get-AgentVServiceSid}catch{}
Write-Output ('Absent-registration fixed service SID native='+$expected+' resolved='+($null -ne $observed))
if($null -eq $observed){throw 'Fixed AgentV SID is unavailable without SCM registration.'}
if($observed -cne $expected){throw 'Fixed AgentV SID disagrees with native SCM derivation.'}
if(Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue){throw 'SID observation unexpectedly created SCM registration.'}
Write-Output 'Fixed service SID matches native SCM while registration remains absent; no account or ACL was changed.'
