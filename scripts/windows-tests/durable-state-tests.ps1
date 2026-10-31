[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable hosted CI authorization required.' }
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1') -Force
$root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOpsAgentV-Durable-CI'
if (Test-Path -LiteralPath $root) { throw 'Refusing preexisting fixture directory.' }
$owned = $false; $lock = $null
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    New-AgentVProtectedDirectory -Path $root; $owned = $true
    $path = Join-Path $root 'state.json'
    Write-AgentVDurableJson -Path $path -Value @{ version=1; phase='prepared'; secret='synthetic-only' }
    Assert ((Read-AgentVJson -Path $path -Secret).phase -eq 'prepared') 'Initial durable state unreadable.'
    Write-AgentVDurableJson -Path $path -Value @{ version=1; phase='commit-intent'; secret='synthetic-only' }
    Assert ((Read-AgentVJson -Path $path -Secret).phase -eq 'commit-intent') 'Atomic state replacement failed.'
    Assert (@(Get-ChildItem $root -Filter '.pending-*').Count -eq 0) 'Temporary secret state leaked.'
    $lockPath = Join-Path $root 'installation.lock'; $lock = Enter-AgentVLock -Path $lockPath
    $rejected = $false; try { $duplicate = Enter-AgentVLock -Path $lockPath; $duplicate.Dispose() } catch { $rejected = $true }
    Assert $rejected 'Duplicate owner acquired the installation lock.'
    $lock.Dispose(); $lock = Enter-AgentVLock -Path $lockPath; $lock.Dispose(); $lock = $null
    $acl = Get-Acl $path; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-5-19','Read','Allow')); Set-Acl $path $acl
    $rejected = $false; try { $null = Read-AgentVJson -Path $path -Secret } catch { $rejected = $true }
    Assert $rejected 'Broad LocalService access to journal was accepted.'
    Set-AgentVAcl -Path $path
    $link = Join-Path $root 'junction'; $null = New-Item -ItemType Junction -Path $link -Target $root
    $rejected = $false; try { Assert-AgentVTrustedPath -Path $root -Tree } catch { $rejected = $true }
    Assert $rejected 'Runtime validation followed a junction.'
    [IO.Directory]::Delete($link)
    $rejected = $false; try { Read-AgentVJson -Path $path -Limit 2 } catch { $rejected = $true }
    Assert $rejected 'Bounded journal read accepted oversized data.'
    Write-Output 'Native durable JSON replacement, lock, confidential ACL and reparse checks passed.'
} finally { if ($null -ne $lock) { $lock.Dispose() }; if ($owned) { Remove-Item -LiteralPath $root -Recurse -Force } }
