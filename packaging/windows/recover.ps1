[CmdletBinding()]
param([switch]$Automatic,[switch]$Uninstall)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# This fixed launcher checks its admin/SYSTEM-only bootstrap files before imports.
function Assert-LauncherPath {
    param([string]$Path)
    $current=$Path; $leaf=$true
    $privileged=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    while ($current) {
        $item=Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Untrusted launcher path.' }
        $acl=Get-Acl -LiteralPath $current
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $privileged) { throw 'Untrusted launcher owner.' }
        foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -or $rule.IdentityReference.Value -in $privileged) { continue }
            $bits=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights),0)
            if ($leaf -or ($bits -band 0x500d0040)) { throw 'Untrusted launcher permissions.' }
        }
        $current=Split-Path $current -Parent; $leaf=$false
    }
}
$timing=[ordered]@{schema='acornops.agentv-recovery-timing.v1';startedAt=[DateTimeOffset]::UtcNow.ToString('o');stage='bootstrap';bootstrapMs=0;treeMs=0;packageMs=0;workerMs=0;totalMs=0;workerSucceeded=$false}
$totalClock=[Diagnostics.Stopwatch]::StartNew();$partClock=[Diagnostics.Stopwatch]::StartNew();$canWriteTiming=$false
try {
    $program=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AcornOps\AgentV'
    $maintenance=Join-Path $program 'maintenance'
    foreach ($name in @('Paths.psm1','Package.psm1','worker.json')) { Assert-LauncherPath (Join-Path $maintenance $name) }
    Import-Module (Join-Path $maintenance 'Paths.psm1')
    Import-Module (Join-Path $maintenance 'Package.psm1')
    $canWriteTiming=$true
    $pointer=Read-AgentVJson -Path (Join-Path $maintenance 'worker.json') -Limit 4096 -Secret
    $owner=Read-AgentVJson -Path (Get-AgentVPaths).Owner -Secret
    if ($pointer.ownerId -cne $owner.id) { throw 'Recovery launcher ownership mismatch.' }
    Assert-AgentVVersion $pointer.version
    if ($pointer.manifestSha256 -notmatch '^[0-9a-f]{64}$' -or $pointer.ownerId -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid protected recovery selection.' }
    $release=Join-Path $program ('releases\'+$pointer.version)
    $timing.bootstrapMs=$partClock.ElapsedMilliseconds;$partClock.Restart();$timing.stage='release-tree'
    # Trust the pointer-hash input first; the following package validation
    # checks the complete tree and every hash before any worker/DLL load.
    Assert-AgentVTrustedPath -Path (Join-Path $release 'package-manifest.json')
    $timing.treeMs=$partClock.ElapsedMilliseconds;$partClock.Restart();$timing.stage='package'
    if ((Get-FileHash (Join-Path $release 'package-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pointer.manifestSha256) { throw 'Recovery package checksum changed.' }
    $null=Assert-AgentVPackage -Directory $release -Version $pointer.version
    $timing.packageMs=$partClock.ElapsedMilliseconds;$partClock.Restart();$timing.stage='worker'
    $action=if($Uninstall){'Uninstall'}else{'Recover'}
    & (Join-Path $release 'windows\install-worker.ps1') -Action $action -Automatic:$Automatic
    $timing.workerSucceeded=$?;$timing.workerMs=$partClock.ElapsedMilliseconds;$timing.stage='finished'
    if (-not $timing.workerSucceeded) { exit 1 }
} catch { Write-Error 'AgentV protected recovery could not run. No untrusted recovery input was executed.'; exit 1 }

finally {
    # Fixed bounded diagnostics only: never read this file as recovery authority.
    if($canWriteTiming){try{$timing.totalMs=$totalClock.ElapsedMilliseconds;Write-AgentVDurableJson -Path (Join-Path $maintenance 'launcher-timing.json') -Value $timing}catch{}}
}
