[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReleaseBaseUrl,[Parameter(Mandatory=$true)][string]$PlatformUrl,[Parameter(Mandatory=$true)][string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential,[string]$NodePath,[string]$AdditionalCaBundleFile)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$EmbeddedReleaseVersion = '@@VERSION@@'
$stage=$null
$ambient=@{}
foreach($name in @('CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY')) { $ambient[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
function Assert-BootstrapPath {
    param([string]$Path,[switch]$SharedParent,[switch]$PublicRead)
    $current=$Path; $leaf=-not $SharedParent
    $privileged=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    while ($current) {
        $item=Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Untrusted bootstrap path.' }
        $acl=Get-Acl -LiteralPath $current
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $privileged) { throw 'Untrusted bootstrap owner.' }
        foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -or $rule.IdentityReference.Value -in $privileged) { continue }
            $bits=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$rule.FileSystemRights),0)
            if (($leaf -and -not $PublicRead) -or ($bits -band $(if($leaf){0x500d0156}else{0x500d0040}))) { throw 'Untrusted bootstrap permissions.' }
        }
        $current=Split-Path $current -Parent; $leaf=$false
    }
}
function Set-BootstrapAcl {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Container) { $acl=New-Object Security.AccessControl.DirectorySecurity; $inherit='ContainerInherit, ObjectInherit' } else { $acl=New-Object Security.AccessControl.FileSecurity; $inherit='None' }
    $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
    foreach($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$sid,'FullControl',$inherit,'None','Allow')) }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-BootstrapUrl {
    param([string]$Value)
    $uri=$null
    if ($Value -notmatch '^[\x21-\x7e]+$' -or $Value -match '[\x22\x27\x60\\]' -or -not [Uri]::TryCreate($Value,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Literal HTTPS URL required.' }
}
try {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or -not [Environment]::Is64BitProcess) { throw 'Elevated x64 PowerShell required.' }
    if ($EmbeddedReleaseVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Use a versioned release bootstrap.' }
    Assert-BootstrapUrl $ReleaseBaseUrl; Assert-BootstrapUrl $PlatformUrl
    if ($TargetId -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw 'Invalid target identifier.' }
    $parent=[Environment]::GetFolderPath('CommonApplicationData'); Assert-BootstrapPath -Path $parent -SharedParent
    $stagingRoot=Join-Path $parent 'AcornOpsAgentV-Staging'
    if (Test-Path -LiteralPath $stagingRoot) { Assert-BootstrapPath $stagingRoot; if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot 'owned-v1'))) { throw 'Unrelated staging directory.' } }
    else { $null=New-Item -ItemType Directory -Path $stagingRoot; Set-BootstrapAcl $stagingRoot; [IO.File]::WriteAllText((Join-Path $stagingRoot 'owned-v1'),'acornops-agentv-staging-v1'); Set-BootstrapAcl (Join-Path $stagingRoot 'owned-v1') }
    $stage=Join-Path $stagingRoot ([Guid]::NewGuid().ToString('N')); $null=New-Item -ItemType Directory -Path $stage; Set-BootstrapAcl $stage
    $curl=Join-Path ([Environment]::SystemDirectory) 'curl.exe'
    $name='agentv-'+$EmbeddedReleaseVersion+'-windows-x64.zip'; $archive=Join-Path $stage $name; $checksum=$archive+'.sha256'
    $base=$ReleaseBaseUrl.TrimEnd('/')+'/v'+$EmbeddedReleaseVersion+'/'
    $tls=@(); if ($AdditionalCaBundleFile) { Assert-BootstrapPath -Path $AdditionalCaBundleFile -PublicRead; $tls=@('--cacert',$AdditionalCaBundleFile) }
    foreach ($asset in @(@{name=$name;path=$archive;limit='52428800'},@{name=($name+'.sha256');path=$checksum;limit='1024'})) {
        & $curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize $asset.limit @tls --output $asset.path ($base+$asset.name)
        if ($LASTEXITCODE -ne 0) { throw 'Pinned Windows asset download failed.' }; Set-BootstrapAcl $asset.path
    }
    $expected=[IO.File]::ReadAllText($checksum).Trim()
    if ($expected -notmatch ('^([0-9a-fA-F]{64})\s+\*?'+[Regex]::Escape($name)+'$') -or (Get-FileHash $archive -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Windows archive checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    $package=Join-Path $stage 'package'; $null=New-Item -ItemType Directory -Path $package; Set-BootstrapAcl $package
    try {
        $names=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase); $total=0
        foreach($entry in $zip.Entries) {
            $relative=$entry.FullName.Replace('\','/'); $trimmed=$relative.TrimEnd('/')
            if (-not $trimmed -or $relative -notmatch '^[A-Za-z0-9_@./+-]+$' -or $relative.StartsWith('/') -or $trimmed.Split('/') -contains '..' -or $trimmed.Split('/') -contains '.' -or -not $names.Add($trimmed) -or (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000 -or ($entry.ExternalAttributes -band 0x400)) { throw 'Unsafe Windows archive entry.' }
            $total += $entry.Length; if ($total -gt 104857600 -or $names.Count -gt 20000) { throw 'Windows archive exceeds unpacked limits.' }
        }
        foreach($entry in $zip.Entries) {
            $relative=$entry.FullName.Replace('/','\'); $destination=Join-Path $package $relative
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { if (-not (Test-Path -LiteralPath $destination)) { $null=New-Item -ItemType Directory -Path $destination -Force; Set-BootstrapAcl $destination }; continue }
            $directory=Split-Path $destination -Parent; if (-not(Test-Path -LiteralPath $directory)){ $null=New-Item -ItemType Directory -Path $directory -Force }
            $entryStream=$entry.Open(); $output=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try { $buffer=New-Object byte[] 16384; $length=0; while(($count=$entryStream.Read($buffer,0,$buffer.Length)) -gt 0){$length+=$count;if($length -gt $entry.Length){throw 'Archive entry exceeds declared length.'};$output.Write($buffer,0,$count)};if($length -ne $entry.Length){throw 'Incomplete archive entry.'};$output.Flush($true) } finally {$entryStream.Dispose();$output.Dispose()}
            Set-BootstrapAcl $destination
        }
    } finally { $zip.Dispose() }
    foreach($item in Get-ChildItem -LiteralPath $package -Recurse -Force){Set-BootstrapAcl $item.FullName}
    Import-Module (Join-Path $package 'windows\Package.psm1') -Force
    $null=Assert-AgentVPackage -Directory $package -Version $EmbeddedReleaseVersion
    & (Join-Path $package 'windows\install-worker.ps1') -Version $EmbeddedReleaseVersion -PlatformUrl $PlatformUrl -TargetId $TargetId -EnrollmentToken $EnrollmentToken -ReplaceCredential:$ReplaceCredential -NodePath $NodePath -AdditionalCaBundleFile $AdditionalCaBundleFile
    if (-not $?) { throw 'Windows installation did not complete.' }
} catch { Write-Error 'AgentV Windows installation could not complete. Existing configuration and any protected recovery journal were retained.'; exit 1 }
finally { foreach($name in $ambient.Keys){[Environment]::SetEnvironmentVariable($name,$ambient[$name],'Process')}; if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force } }
