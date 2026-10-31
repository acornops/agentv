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
    # Package manifests include both explicit no-BOM UTF8 and the native PS5.1
    # Set-Content UTF8 encoding used by the compiled host manifest builder.
    $manifest=Join-Path $root 'host-manifest.json'
    '{"schema":"acornops.agentv-windows-host.v1","architecture":"x64"}' | Set-Content -LiteralPath $manifest -Encoding UTF8
    Set-AgentVAcl -Path $manifest
    $bom=[IO.File]::ReadAllBytes($manifest)
    Assert ($bom.Length -gt 3 -and $bom[0] -eq 239 -and $bom[1] -eq 187 -and $bom[2] -eq 191) 'Native PS5 UTF8 fixture did not contain its expected BOM.'
    Assert ((Read-AgentVJson -Path $manifest).architecture -ceq 'x64') 'BOM-bearing native host manifest could not be read.'
    [IO.File]::WriteAllText($manifest,'{"schema":"acornops.agentv-windows-host.v1","architecture":"x64"}',[Text.UTF8Encoding]::new($false))
    Assert ((Read-AgentVJson -Path $manifest).architecture -ceq 'x64') 'BOM-free package manifest could not be read.'
    $tree=Join-Path $root 'runtime';New-AgentVProtectedDirectory $tree
    $nested=Join-Path $tree 'nested';New-AgentVProtectedDirectory $nested
    $leaf=Join-Path $nested 'dependency.json';Write-AgentVDurableJson -Path $leaf -Value @{fixture=$true}
    $users=[Security.Principal.SecurityIdentifier]'S-1-5-32-545'
    $acl=Get-Acl $leaf;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'Write','Allow'));Set-Acl $leaf $acl
    $rejected=$false;try{Assert-AgentVTrustedPath -Path $tree -Tree}catch{$rejected=$true}
    Assert $rejected 'Tree validation hid a writable existing dependency beneath a protected parent.'
    Set-AgentVAcl $leaf
    $acl=Get-Acl $nested;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'DeleteSubdirectoriesAndFiles','Allow'));Set-Acl $nested $acl
    $rejected=$false;try{Assert-AgentVTrustedPath -Path $leaf}catch{$rejected=$true}
    Assert $rejected 'A writable ancestor could replace a trusted dependency.'
    Set-AgentVAcl $nested
    $acl=Get-Acl $tree;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'Write','ContainerInherit, ObjectInherit','InheritOnly','Allow'));Set-Acl $tree $acl
    Assert-AgentVTrustedPath -Path $tree -Tree
    $inherited=Join-Path $tree 'inherited.json';[IO.File]::WriteAllText($inherited,'{}')
    $acl=Get-Acl $inherited;$acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544');Set-Acl $inherited $acl
    $rejected=$false;try{Assert-AgentVTrustedPath -Path $tree -Tree}catch{$rejected=$true}
    Assert $rejected 'Inherit-only parent permission hid effective inherited dependency writes.'
    Set-AgentVAcl $inherited;Set-AgentVAcl $tree
    $validationOutput=@(Assert-AgentVTrustedPath -Path $tree -Tree)
    Assert ($validationOutput.Count -eq 0) 'Void trust validation emitted pipeline data.'
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
