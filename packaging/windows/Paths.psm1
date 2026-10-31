Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AgentVPaths {
    $root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOps\AgentV'
    $program = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AcornOps\AgentV'
    return [pscustomobject]@{ Root=$root; Program=$program; Releases=(Join-Path $program 'releases'); Maintenance=(Join-Path $program 'maintenance'); State=(Join-Path $root 'state'); Logs=(Join-Path $root 'logs'); Config=(Join-Path $root 'config.json'); Selection=(Join-Path $root 'selection.json'); Owner=(Join-Path $root 'owner.json'); Journal=(Join-Path $root 'transaction.json'); Marker=(Join-Path $root 'active.json'); Lock=(Join-Path $root 'installation.lock'); Task='AcornOpsAgentVRecovery'; Service='AcornOpsAgentV' }
}
function Get-AgentVServiceSid { return ([Security.Principal.NTAccount]'NT SERVICE\AcornOpsAgentV').Translate([Security.Principal.SecurityIdentifier]).Value }
function Set-AgentVAcl {
    param([Parameter(Mandatory=$true)][string]$Path, [string]$ServiceSid, [string]$Rights='ReadAndExecute')
    if (Test-Path -LiteralPath $Path -PathType Container) { $acl = New-Object Security.AccessControl.DirectorySecurity; $inherit = 'ContainerInherit, ObjectInherit' }
    else { $acl = New-Object Security.AccessControl.FileSecurity; $inherit = 'None' }
    $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$sid,'FullControl',$inherit,'None','Allow')) }
    if ($ServiceSid) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$ServiceSid,$Rights,$inherit,'None','Allow')) }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-AgentVTrustedPath {
    param([Parameter(Mandatory=$true)][string]$Path, [switch]$Tree, [switch]$Ancestor, [switch]$Secret, [string]$ServiceReadSid, [string]$ServiceWriteSid)
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('\\') -or [IO.Path]::GetFullPath($Path) -cne $Path) { throw 'AgentV requires a normalized local absolute path.' }
    $privileged = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $current = $Path; $leaf = -not $Ancestor
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'AgentV refuses reparse paths.' }
        $acl = Get-Acl -LiteralPath $current
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $privileged) { throw 'AgentV refuses an untrusted path owner.' }
        $writes = [int][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int][Security.AccessControl.FileSystemRights]::TakeOwnership -bor [int][Security.AccessControl.FileSystemRights]::Delete -bor [int][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
        if ($leaf) { $writes = $writes -bor [int][Security.AccessControl.FileSystemRights]::Write }
        foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
            $sid = $rule.IdentityReference.Value
            if ($sid -in $privileged) { continue }
            $bits = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights),0)
            if ((($bits -band $writes) -ne 0 -or ($bits -band 0x50000000) -ne 0) -and -not ($leaf -and $ServiceWriteSid -and $sid -eq $ServiceWriteSid)) { throw 'AgentV refuses effective untrusted write access.' }
            if ($leaf -and $Secret -and $sid -ne $ServiceReadSid) { throw 'AgentV confidential state has an unrelated access rule.' }
        }
        $current = Split-Path $current -Parent; $leaf = $false
    }
    if ($Tree) {
        # Visit each directory before enumerating it, so a junction is never traversed.
        $stack = New-Object 'Collections.Generic.Stack[string]'; $stack.Push($Path); $count = 0
        while ($stack.Count) {
            $directory = $stack.Pop()
            foreach ($child in Get-ChildItem -LiteralPath $directory -Force) {
                $count++; if ($count -gt 20000) { throw 'AgentV runtime tree exceeds the package limit.' }
                Assert-AgentVTrustedPath -Path $child.FullName
                if ($child.PSIsContainer) { $stack.Push($child.FullName) }
            }
        }
    }
}
function New-AgentVProtectedDirectory {
    param([string]$Path, [string]$ServiceSid, [string]$Rights='ReadAndExecute')
    if (Test-Path -LiteralPath $Path) {
        if ($ServiceSid -and $Rights -eq 'Modify') { Assert-AgentVTrustedPath -Path $Path -ServiceWriteSid $ServiceSid } else { Assert-AgentVTrustedPath -Path $Path }
        return
    }
    $parent = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $parent)) { New-AgentVProtectedDirectory -Path $parent }
    elseif ($parent -in @([Environment]::GetFolderPath('CommonApplicationData'),[Environment]::GetFolderPath('ProgramFiles'))) { Assert-AgentVTrustedPath -Path $parent -Ancestor }
    else { Assert-AgentVTrustedPath -Path $parent }
    $null = New-Item -ItemType Directory -Path $Path
    Set-AgentVAcl -Path $Path -ServiceSid $ServiceSid -Rights $Rights
}
function Write-AgentVDurableJson {
    param([string]$Path, $Value, [string]$ServiceReadSid)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 16 -Compress))
    if ($bytes.Length -gt 262144) { throw 'AgentV durable state exceeds its bound.' }
    Write-AgentVDurableBytes -Path $Path -Bytes $bytes -ServiceReadSid $ServiceReadSid
}
function Write-AgentVDurableBytes {
    param([string]$Path, [byte[]]$Bytes, [string]$ServiceReadSid)
    $parent = Split-Path $Path -Parent; Assert-AgentVTrustedPath -Path $parent
    if (Test-Path -LiteralPath $Path) { Assert-AgentVTrustedPath -Path $Path -Secret -ServiceReadSid $ServiceReadSid }
    if ($Bytes.Length -gt 4194304) { throw 'AgentV durable file exceeds its bound.' }
    $temporary = Join-Path $parent ('.pending-' + [Guid]::NewGuid().ToString('N'))
    try {
        $empty = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); $empty.Dispose()
        Set-AgentVAcl -Path $temporary -ServiceSid $ServiceReadSid -Rights 'Read'
        $file = [IO.File]::Open($temporary,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary,$Path,[System.Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($temporary,$Path) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}
function Read-AgentVJson {
    param([string]$Path, [int]$Limit=262144, [switch]$Secret, [string]$ServiceReadSid)
    Assert-AgentVTrustedPath -Path $Path -Secret:$Secret -ServiceReadSid $ServiceReadSid
    $file = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if ($file.Length -gt $Limit) { throw 'AgentV state exceeds its bound.' }
        $buffer = New-Object byte[] ($Limit+1); $length = 0
        while ($length -lt $buffer.Length) { $count = $file.Read($buffer,$length,$buffer.Length-$length); if (-not $count) { break }; $length += $count }
        if ($length -gt $Limit) { throw 'AgentV state exceeds its bound.' }
        # Windows PowerShell5.1 Set-Content UTF8 emits a BOM. Strip exactly
        # that optional byte prefix, retaining the original bounded byte count.
        $offset=0
        if ($length -ge 3 -and $buffer[0] -eq 239 -and $buffer[1] -eq 187 -and $buffer[2] -eq 191) { $offset=3 }
        return [Text.Encoding]::UTF8.GetString($buffer,$offset,$length-$offset) | ConvertFrom-Json
    } finally { $file.Dispose() }
}
function Enter-AgentVLock {
    param([string]$Path)
    Assert-AgentVTrustedPath -Path (Split-Path $Path -Parent)
    if (-not (Test-Path -LiteralPath $Path)) {
        try { $empty = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); $empty.Dispose(); Set-AgentVAcl -Path $Path }
        catch [IO.IOException] { if (-not (Test-Path -LiteralPath $Path)) { throw } }
    }
    Assert-AgentVTrustedPath -Path $Path -Secret
    try { return [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { throw 'Another AgentV installer or recovery operation owns the lock.' }
}
function Assert-AgentVHttpsUrl {
    param([string]$Value)
    $uri = $null
    if ($Value -notmatch '^[\x21-\x7e]+$' -or $Value -match '[\x22\x27\x60\\]' -or -not [Uri]::TryCreate($Value,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Fragment -or $uri.Query) { throw 'AgentV requires a literal HTTPS URL without credentials, query or fragment.' }
}
Export-ModuleMember -Function Get-AgentVPaths,Get-AgentVServiceSid,Set-AgentVAcl,Assert-AgentVTrustedPath,New-AgentVProtectedDirectory,Write-AgentVDurableJson,Write-AgentVDurableBytes,Read-AgentVJson,Enter-AgentVLock,Assert-AgentVHttpsUrl
