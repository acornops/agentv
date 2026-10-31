[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Explicit disposable hosted-CI authorization is required.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Native SCM qualification requires administrator rights.' }
$repo = Split-Path $PSScriptRoot -Parent
$root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOps\AgentV'
$release = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AcornOps\AgentV\ci service ü'
$programParent = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AcornOps'
$dataParent = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOps'
$probeRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOpsAgentV-CI-Probe'
$sc = Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$owned = $false; $probeOwned = $false; $userOwned = $false
$user = 'AgentVCIProbe'
$evidence = [ordered]@{ sourceRevision = (& git -C $repo rev-parse HEAD); node = (& node --version); os = [Environment]::OSVersion.VersionString; tests = @() }
function Sc([string[]]$Arguments) { & $sc @Arguments | Out-Null; if ($LASTEXITCODE -ne 0) { throw "SCM command failed: $($Arguments[0])" } }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:evidence.tests += $Message }
function Wait-Until([scriptblock]$Condition, [int]$Seconds = 30) { $clock = [Diagnostics.Stopwatch]::StartNew(); while (-not (& $Condition)) { if ($clock.Elapsed.TotalSeconds -gt $Seconds) { throw 'Native condition deadline exceeded.' }; Start-Sleep -Milliseconds 200 } }
function Acl([string]$Path, [string]$Sid, [string]$Rights = 'ReadAndExecute') {
    $directory = Test-Path -LiteralPath $Path -PathType Container
    if ($directory) { $acl = New-Object Security.AccessControl.DirectorySecurity; $inherit = 'ContainerInherit, ObjectInherit' } else { $acl = New-Object Security.AccessControl.FileSecurity; $inherit = 'None' }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]'S-1-5-32-544')
    foreach ($principal in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$principal, 'FullControl', $inherit, 'None', 'Allow')) }
    if ($Sid) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$Sid, $Rights, $inherit, 'None', 'Allow')) }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Fixture([string]$Mode = 'normal') {
    @{ mode = $Mode } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding ASCII
    Acl (Join-Path $root 'config.json') $script:serviceSid 'Read'
    Remove-Item -LiteralPath (Join-Path $root 'state\fixture.json') -ErrorAction SilentlyContinue
    Start-Service AcornOpsAgentV
    Wait-Until { Test-Path -LiteralPath (Join-Path $root 'state\fixture.json') }
    return Get-Content -LiteralPath (Join-Path $root 'state\fixture.json') -Raw | ConvertFrom-Json
}
function Gone($Tree) { Wait-Until { -not (Get-Process -Id $Tree.pid,$Tree.child -ErrorAction SilentlyContinue) } 10 }
try {
    foreach ($name in @('AcornOpsAgentV','AcornOpsAgentVProbe')) { if (Get-Service -Name $name -ErrorAction SilentlyContinue) { throw 'Refusing a preexisting service.' } }
    foreach ($path in @($dataParent, $programParent, $probeRoot)) { if (Test-Path -LiteralPath $path) { throw 'Refusing preexisting qualification paths.' } }
    if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) { throw 'Refusing a preexisting probe user.' }
    # Refuse reparse ancestors before creating or changing any ownership.
    foreach ($path in @($dataParent, $programParent, $probeRoot)) { $parent = Split-Path $path -Parent; while ($parent) { if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse ancestor refused.' }; $parent = Split-Path $parent -Parent } }
    $null = New-Item -ItemType Directory -Path $root,$release,$probeRoot -Force
    $owned = $true
    $node = Join-Path $release 'node.exe'; Copy-Item -LiteralPath (Get-Command node).Source -Destination $node
    & (Join-Path $PSScriptRoot 'build-windows-host.ps1') -OutputDirectory $release
    $evidence.hostManifest = Get-Content (Join-Path $release 'host-manifest.json') -Raw | ConvertFrom-Json
    $null = New-Item -ItemType Directory -Path (Join-Path $release 'dist'),(Join-Path $root 'state'),(Join-Path $root 'logs')
    Copy-Item (Join-Path $PSScriptRoot 'windows-tests\host-child.mjs') (Join-Path $release 'dist\windows-service-entry.js')
    '{"type":"module"}' | Set-Content (Join-Path $release 'package.json') -Encoding ASCII
    $image = '"' + (Join-Path $release 'AgentV.ServiceHost.exe') + '" --node "' + $node + '"'
    Sc -Arguments @('create','AcornOpsAgentV','binPath=', $image,'start=','demand','obj=','NT AUTHORITY\LocalService')
    Sc -Arguments @('sidtype','AcornOpsAgentV','unrestricted')
    $script:serviceSid = ([Security.Principal.NTAccount]'NT SERVICE\AcornOpsAgentV').Translate([Security.Principal.SecurityIdentifier]).Value
    foreach ($path in @($dataParent,$programParent,(Split-Path $release -Parent),$root,$release)) { Acl $path $serviceSid }
    # Reapply to existing children: a parent ACL cannot hide a writable existing file.
    Get-ChildItem -LiteralPath $release -Recurse -Force | ForEach-Object { Acl $_.FullName $serviceSid }
    Acl (Join-Path $root 'logs') $serviceSid 'Modify'; Acl (Join-Path $root 'state') $serviceSid 'Modify'
    Sc -Arguments @('failure','AcornOpsAgentV','reset=','86400','actions=','restart/10000/restart/30000/restart/60000')
    Sc -Arguments @('failureflag','AcornOpsAgentV','0')
    $compiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $probe = Join-Path $probeRoot 'NativeProbe.exe'
    & $compiler /nologo /target:exe /platform:x64 /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll "/out:$probe" (Join-Path $PSScriptRoot 'windows-tests\NativeProbe.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Probe compilation failed.' }
    Acl $probeRoot 'S-1-5-19' 'Modify'
    $tree = Fixture
    Assert ((Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'").StartName -eq 'NT AUTHORITY\LocalService') 'SCM uses LocalService'
    $token = (& $probe --identity $tree.pid) | ConvertFrom-Json
    Assert ($token.user -eq 'S-1-5-19' -and $token.groups -contains $serviceSid) 'Agent token includes LocalService plus the unique service SID'
    & $probe --job $tree.pid; Assert ($LASTEXITCODE -eq 0) 'Node is contained before fixture descendants'
    & $probe --job $tree.child; Assert ($LASTEXITCODE -eq 0) 'Collector descendant inherits containment'
    Assert ($null -eq $tree.env.PSObject.Properties['NODE_OPTIONS'] -and $null -eq $tree.env.PSObject.Properties['GITHUB_TOKEN']) 'Child environment excludes ambient overrides and credentials'
    $probeOutput = Join-Path $probeRoot 'service.json'
    $probeImage = '"' + $probe + '" --service "' + $root + '" "' + $release + '" "' + $probeOutput + '"'
    Sc -Arguments @('create','AcornOpsAgentVProbe','binPath=', $probeImage,'start=','demand','obj=','NT AUTHORITY\LocalService'); $probeOwned = $true
    Sc -Arguments @('sidtype','AcornOpsAgentVProbe','unrestricted'); Start-Service AcornOpsAgentVProbe
    Wait-Until { Test-Path -LiteralPath $probeOutput }
    $access = Get-Content -LiteralPath $probeOutput -Raw | ConvertFrom-Json
    Assert ($access.user -eq 'S-1-5-19' -and -not $access.configRead -and -not $access.configWrite -and -not $access.runtimeWrite -and -not $access.stateWrite) 'Unrelated LocalService service cannot access protected credentials or mutate installation'
    # Unrelated ordinary local user exercises the same files using a real restricted token.
    $password = [Guid]::NewGuid().ToString('N') + 'aA!7'; $secure = ConvertTo-SecureString $password -AsPlainText -Force
    $account = New-LocalUser -Name $user -Password $secure -AccountNeverExpires; $userOwned = $true
    $probeAcl = Get-Acl $probeRoot; $probeAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($account.SID,'Modify','ContainerInherit, ObjectInherit','None','Allow')); Set-Acl $probeRoot $probeAcl
    $userOutput = Join-Path $probeRoot 'user.json'
    $credential = [Management.Automation.PSCredential]::new("$env:COMPUTERNAME\$user",$secure)
    $process = Start-Process -FilePath $probe -ArgumentList @('--user',('"'+$root+'"'),('"'+$release+'"'),('"'+$userOutput+'"')) -Credential $credential -PassThru -Wait -WorkingDirectory $probeRoot
    Assert ($process.ExitCode -eq 0) 'Restricted user probe executed'
    $access = Get-Content -LiteralPath $userOutput -Raw | ConvertFrom-Json
    Assert (-not $access.configRead -and -not $access.configWrite -and -not $access.runtimeWrite) 'Unrelated low privilege user cannot read credentials or write runtime/config'
    foreach ($victim in @('host','node')) {
        if ($victim -eq 'host') { $victimId = (Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'").ProcessId } else { $victimId = $tree.pid }
        Stop-Process -Id $victimId -Force; Gone $tree
        $oldPid = $tree.pid
        Wait-Until { $fresh = Get-Content (Join-Path $root 'state\fixture.json') -Raw | ConvertFrom-Json; $fresh.pid -ne $oldPid } 80
        $tree = Get-Content (Join-Path $root 'state\fixture.json') -Raw | ConvertFrom-Json
        Assert ((@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node })).Count -eq 2) "$victim crash removes descendants and recovers exactly one tree"
    }
    Stop-Service AcornOpsAgentV; Gone $tree
    for ($attempt = 0; $attempt -lt 4; $attempt++) { $tree = Fixture; Stop-Service AcornOpsAgentV; Gone $tree }
    Assert ((Get-Service AcornOpsAgentV).Status -eq 'Stopped') 'Repeated orderly stops observe whole-tree exit'
    $tree = Fixture 'ignore-stop'; $clock = [Diagnostics.Stopwatch]::StartNew(); Stop-Service AcornOpsAgentV; Gone $tree
    Assert ($clock.Elapsed.TotalSeconds -lt 25) 'Stop deadline kills contained descendants boundedly'
    $tree = Fixture 'flood'; Wait-Until { Test-Path (Join-Path $root 'logs\stderr.log.3') }; Stop-Service AcornOpsAgentV; Gone $tree
    $logs = @(Get-ChildItem (Join-Path $root 'logs') -File)
    Assert ((@($logs | Where-Object Length -gt 5242880)).Count -eq 0 -and $logs.Count -le 9) 'Oversized stdout/stderr remain bounded with three retained rotations'
    # A regular file replacing the log directory makes the sink inaccessible, without blocking pipe drain/stop.
    Remove-Item (Join-Path $root 'logs') -Recurse -Force; Set-Content (Join-Path $root 'logs') 'blocked' -Encoding ASCII
    $tree = Fixture 'flood'; Stop-Service AcornOpsAgentV; Gone $tree
    Assert ((Get-Service AcornOpsAgentV).Status -eq 'Stopped') 'Unavailable log sink cannot block shutdown'
    Remove-Item (Join-Path $root 'logs'); $null = New-Item -ItemType Directory (Join-Path $root 'logs'); Acl (Join-Path $root 'logs') $serviceSid 'Modify'
    foreach ($bad in @($node, (Join-Path $release 'dist\windows-service-entry.js'), (Join-Path $root 'config.json'))) {
        $acl = Get-Acl $bad; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-5-32-545','Write','Allow')); Set-Acl $bad $acl
        try { Start-Service AcornOpsAgentV -ErrorAction Stop; throw 'Untrusted path unexpectedly started.' } catch { if ($_.Exception.Message -eq 'Untrusted path unexpectedly started.') { throw } }
        Assert ((Get-Service AcornOpsAgentV).Status -eq 'Stopped') 'Writable existing child path rejected'
        Acl $bad $serviceSid
    }
    $unsupportedNode = Join-Path $release 'unsupported-node.exe'; Copy-Item $probe $unsupportedNode; Acl $unsupportedNode $serviceSid
    foreach ($invalidNode in @((Join-Path $release 'missing-node.exe'), $unsupportedNode)) {
        $invalidImage = '"' + (Join-Path $release 'AgentV.ServiceHost.exe') + '" --node "' + $invalidNode + '"'
        Sc -Arguments @('config','AcornOpsAgentV','binPath=', $invalidImage)
        try { Start-Service AcornOpsAgentV -ErrorAction Stop; throw 'Invalid Node unexpectedly started.' } catch { if ($_.Exception.Message -eq 'Invalid Node unexpectedly started.') { throw } }
        Assert ((Get-Service AcornOpsAgentV).Status -eq 'Stopped') 'Missing or unsupported trusted Node fails closed'
    }
    Sc -Arguments @('config','AcornOpsAgentV','binPath=', $image)
    $link = Join-Path $release 'junction'; $null = New-Item -ItemType Junction -Path $link -Target $probeRoot
    try { Start-Service AcornOpsAgentV -ErrorAction Stop; throw 'Reparse runtime unexpectedly started.' } catch { if ($_.Exception.Message -eq 'Reparse runtime unexpectedly started.') { throw } }
    Assert ((Get-Service AcornOpsAgentV).Status -eq 'Stopped') 'Runtime reparse dependency rejected'
    Remove-Item -LiteralPath $link -Force
} finally {
    if ($probeOwned) { Stop-Service AcornOpsAgentVProbe -ErrorAction SilentlyContinue; & $sc delete AcornOpsAgentVProbe | Out-Null }
    if ($owned) { if (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) { & $sc config AcornOpsAgentV start= disabled | Out-Null; Stop-Service AcornOpsAgentV -ErrorAction SilentlyContinue; & $sc delete AcornOpsAgentV | Out-Null }; Remove-Item -LiteralPath $dataParent,$programParent,$probeRoot -Recurse -Force -ErrorAction Continue }
    if ($userOwned) { Remove-LocalUser -Name $user }
    $artifact = Join-Path $repo 'artifacts\windows-service-host'; $null = New-Item -ItemType Directory -Path $artifact -Force
    $evidence | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $artifact 'native-evidence.json') -Encoding UTF8
}
