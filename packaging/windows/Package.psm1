Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Paths.psm1')
function Assert-AgentVVersion {
    param([string]$Version)
    if ($Version.Length -gt 100 -or $Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid immutable AgentV version identifier.' }
}
function Assert-AgentVPackage {
    param([string]$Directory, [string]$Version)
    Assert-AgentVVersion -Version $Version
    Assert-AgentVTrustedPath -Path $Directory -Tree
    $manifestPath = Join-Path $Directory 'package-manifest.json'
    $manifest = Read-AgentVJson -Path $manifestPath -Limit 4194304
    if ($manifest.schema -cne 'acornops.agentv-windows-package.v1' -or $manifest.version -cne $Version -or $manifest.architecture -cne 'x64' -or @($manifest.files).Count -gt 20000 -or $manifest.sourceRevision -notmatch '^[0-9a-f]{40}$') { throw 'Invalid Windows package manifest.' }
    # Every actual object was checked by the protected tree walk above. Exact
    # inventory membership prevents aliases or unmanifested files; hashes still
    # cover every entry. Do not repeat the ancestor walk for each manifest row.
    $actual=@(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force)
    $actualNames=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $prefix=$Directory.TrimEnd('\')+'\'
    foreach($item in $actual){
        $relative=$item.FullName.Substring($prefix.Length).Replace('\','/')
        if($relative -ine 'package-manifest.json'){$null=$actualNames.Add($relative)}
    }
    $names = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $total = 0
    foreach ($file in $manifest.files) {
        if ($file.path -isnot [string] -or -not $actualNames.Contains($file.path) -or $file.path -notmatch '^[A-Za-z0-9_@./+-]+$' -or $file.path.StartsWith('/') -or $file.path.Split('/') -contains '..' -or $file.path.Split('/') -contains '.' -or $file.sha256 -notmatch '^[0-9a-f]{64}$' -or $file.size -lt 0 -or -not $names.Add($file.path)) { throw 'Unsafe Windows manifest entry.' }
        $path = Join-Path $Directory $file.path.Replace('/','\')
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -ne $file.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw 'Windows package checksum mismatch.' }
        $total += $file.size; if ($total -gt 104857600) { throw 'Windows package exceeds unpacked size limit.' }
    }
    foreach ($required in @('AgentV.ServiceHost.exe','AgentV.InstallerNative.dll','host-manifest.json','dist/index.js','dist/windows-service-entry.js','windows/install-worker.ps1','windows/doctor.mjs','windows/recover.ps1','windows/Paths.psm1','windows/Package.psm1','windows/Recovery.psm1','windows/Installation.psm1','package.json','node_modules/ws/package.json','node_modules/zod/package.json')) { if (-not $names.Contains($required)) { throw 'Windows package is missing a required asset.' } }
    if ($actualNames.Count -ne $names.Count -or $actual.Count -ne $names.Count+1) { throw 'Windows runtime contains unmanifested files.' }
    $native = Read-AgentVJson -Path (Join-Path $Directory 'host-manifest.json') -Limit 65536
    if ($native.schema -cne 'acornops.agentv-windows-host.v1' -or $native.targetFramework -cne 'net48' -or $native.architecture -cne 'x64' -or $native.sourceRevision -cne $manifest.sourceRevision -or $native.binarySha256 -cne (Get-FileHash (Join-Path $Directory 'AgentV.ServiceHost.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -or $native.installerNative.binarySha256 -cne (Get-FileHash (Join-Path $Directory 'AgentV.InstallerNative.dll') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Windows native manifest mismatch.' }
    return $manifest
}
function Import-AgentVInstallerNative {
    param([string]$Directory,[string]$Version)
    $null = Assert-AgentVPackage -Directory $Directory -Version $Version
    $null = [Reflection.Assembly]::LoadFrom((Join-Path $Directory 'AgentV.InstallerNative.dll'))
}
function Assert-AgentVNode {
    param([string]$NodePath)
    Assert-AgentVTrustedPath -Path $NodePath
    Assert-AgentVTrustedPath -Path (Split-Path $NodePath -Parent) -Tree
    Assert-AgentVServiceReadable -Path (Split-Path $NodePath -Parent) -Tree
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($NodePath)
    if ($version.FileMajorPart -notin @(22,24)) { throw 'A trusted installed x64 Node22 or24 executable is required.' }
    $file = [IO.File]::OpenRead($NodePath); $reader = [IO.BinaryReader]::new($file)
    try { $file.Position=60; $pe=$reader.ReadInt32(); $file.Position=$pe; if ($reader.ReadUInt32() -ne 17744 -or $reader.ReadUInt16() -ne 34404) { throw 'Node must be a Windows x64 executable.' } } finally { $reader.Dispose(); $file.Dispose() }
}
function Assert-AgentVServiceReadable {
    param([string]$Path,[switch]$Tree)
    # Conservative preflight for the standard LocalService token. Unknown group
    # grants are insufficient; effective denies fail closed before token exchange.
    $sids=@('S-1-5-19','S-1-1-0','S-1-5-11','S-1-5-32-545')
    try { $sids += Get-AgentVServiceSid } catch { }
    $current=$Path
    while ($current) {
        $item=Get-Item -LiteralPath $current -Force
        $required=if($item.PSIsContainer -or $item.Extension -ieq '.exe' -or $item.Extension -ieq '.dll'){[int][Security.AccessControl.FileSystemRights]::ReadAndExecute}else{[int][Security.AccessControl.FileSystemRights]::Read}
        $grants=0
        foreach($ace in (Get-Acl -LiteralPath $current).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if (($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -or $ace.IdentityReference.Value -notin $sids) { continue }
            if ($ace.AccessControlType -eq 'Deny' -and ([int]$ace.FileSystemRights -band $required)) { throw 'Node or CA prerequisite denies the service identity.' }
            if ($ace.AccessControlType -eq 'Allow') { $grants=$grants -bor [int]$ace.FileSystemRights }
        }
        if (($grants -band $required) -ne $required) { throw 'Node or CA prerequisite is unreadable by the service identity.' }
        $current=Split-Path $current -Parent
    }
    if ($Tree) { foreach($item in Get-ChildItem -LiteralPath $Path -Recurse -Force) { Assert-AgentVServiceReadable -Path $item.FullName } }
}
Export-ModuleMember -Function Assert-AgentVVersion,Assert-AgentVPackage,Import-AgentVInstallerNative,Assert-AgentVNode,Assert-AgentVServiceReadable
