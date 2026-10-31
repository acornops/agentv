Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Paths.psm1')
Import-Module (Join-Path $PSScriptRoot 'Package.psm1')
Import-Module (Join-Path $PSScriptRoot 'Recovery.psm1')
$script:Paths = Get-AgentVPaths
$script:Sc = Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$script:PowerShell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'

function Invoke-AgentVSc {
    param([string[]]$Arguments)
    & $script:Sc @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $code=$LASTEXITCODE;$verb=$Arguments[0]
        if ($verb -notin @('create','config','description','sidtype','failure','failureflag','delete')) { $verb='other' }
        [Console]::Error.WriteLine('AgentV SCM failure operation='+$verb+' native='+[int]$code)
        throw 'AgentV SCM operation failed.'
    }
}
function Assert-AgentVAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or -not [Environment]::Is64BitProcess) { throw 'AgentV installation requires elevated x64 PowerShell.' }
    $os = CimCmdlets\Get-CimInstance Win32_OperatingSystem
    if ($os.ProductType -notin @(2,3) -or [string]$os.BuildNumber -notin @('20348','26100')) { throw 'Windows Server2022/2025 x64 is required.' }
    if ([int][Microsoft.Win32.Registry]::GetValue('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full','Release',0) -lt 528040) { throw '.NET Framework4.8 must already be enabled.' }
}
function Assert-AgentVConfig {
    param($Config,[string]$TargetId,[string]$PlatformUrl)
    $known = @('ACORNOPS_AGENT_PLATFORM_URL','ACORNOPS_TARGET_ID','ACORNOPS_AGENT_KEY','ACORNOPS_AGENT_TARGET_TYPE','ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS','ACORNOPS_AGENT_MIN_SNAPSHOT_INTERVAL_MS','ACORNOPS_AGENT_MAX_SNAPSHOT_INTERVAL_MS','ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES','ACORNOPS_AGENT_MIN_SNAPSHOT_BYTES','ACORNOPS_AGENT_MAX_REMOTE_SNAPSHOT_BYTES','ACORNOPS_AGENT_LOG_LEVEL','ACORNOPS_VM_ALLOWED_LOG_CHANNELS','ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE','ACORNOPS_VM_OS_FAMILY','ACORNOPS_VM_SERVICE_MANAGER','ACORNOPS_VM_COLLECTOR_MODE','ACORNOPS_AGENT_WRITE_ENABLED','ACORNOPS_AGENT_MOCK_ACTIONS_ENABLED')
    if ($Config.version -ne 1 -or @($Config.PSObject.Properties.Name).Count -ne 2 -or $Config.settings.ACORNOPS_TARGET_ID -cne $TargetId -or $Config.settings.ACORNOPS_AGENT_PLATFORM_URL -cne $PlatformUrl -or $Config.settings.ACORNOPS_AGENT_KEY -notmatch ('^ak_'+[Regex]::Escape($TargetId)+'_[A-Za-z0-9_-]{32}$')) { throw 'Protected AgentV configuration does not match this target.' }
    foreach ($property in $Config.settings.PSObject.Properties) { if ($property.Name -cnotin $known -or $property.Value -isnot [string] -or $property.Value.Length -gt 8192) { throw 'Invalid protected AgentV setting.' } }
    foreach ($fixed in @{ACORNOPS_VM_OS_FAMILY='windows';ACORNOPS_VM_SERVICE_MANAGER='scm';ACORNOPS_VM_COLLECTOR_MODE='live';ACORNOPS_AGENT_WRITE_ENABLED='false';ACORNOPS_AGENT_MOCK_ACTIONS_ENABLED='false';ACORNOPS_AGENT_TARGET_TYPE='virtual_machine'}.GetEnumerator()) { if ($Config.settings.PSObject.Properties[$fixed.Key] -and $Config.settings.($fixed.Key) -cne $fixed.Value) { throw 'Windows AgentV configuration must be live and read-only.' } }
    if ($Config.settings.PSObject.Properties['ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE']) { Assert-AgentVTrustedPath -Path $Config.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE; Assert-AgentVServiceReadable -Path $Config.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE }
}
function Get-AgentVImage {
    param($Selection)
    Assert-AgentVVersion -Version $Selection.version
    if ($Selection.node.IndexOf('"') -ge 0) { throw 'Invalid Node path.' }
    return '"' + (Join-Path $script:Paths.Releases ($Selection.version+'\AgentV.ServiceHost.exe')) + '" --node "' + $Selection.node + '"'
}
function Assert-AgentVOwnedService {
    param([string]$OwnerId)
    $service = CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    if ($null -eq $service) { return $null }
    if ($service.Description -cne ('AcornOps AgentV installation '+$OwnerId) -or $service.StartName -ine 'NT AUTHORITY\LocalService') { throw 'Refusing an unrelated preexisting service.' }
    if ($service.PathName -notmatch '^"([^"\r\n]+\\AgentV\.ServiceHost\.exe)" --node "([^"\r\n]+)"$') { throw 'Owned service has an unknown image configuration.' }
    $hostPath = $Matches[1]; $nodePath = $Matches[2]
    $release = Split-Path $hostPath -Parent; $version = Split-Path $release -Leaf
    Assert-AgentVVersion -Version $version
    if ($release -cne (Join-Path $script:Paths.Releases $version)) { throw 'Owned service references an unexpected release root.' }
    $null = Assert-AgentVPackage -Directory $release -Version $version
    Assert-AgentVNode -NodePath $nodePath
    return $service
}
function Save-AgentVJournal {
    param($Journal,[string]$Phase)
    if ($Phase) { $Journal.phase = $Phase }
    Write-AgentVDurableJson -Path $script:Paths.Journal -Value $Journal
}
function Assert-AgentVJournal {
    param($Journal,$Owner)
    if ($Journal.schema -cne 'acornops.agentv-windows-installation.v1' -or $Journal.ownerId -cne $Owner.id -or $Journal.operation -notin @('install','repair') -or $Journal.intent -notin @('commit','rollback','rollback-denied') -or $Journal.attempts -lt 0 -or $Journal.attempts -gt 12 -or $Journal.everStarted -isnot [bool]) { throw 'Invalid protected recovery journal.' }
    if ($Journal.hadService -isnot [bool] -or $Journal.hadTask -isnot [bool] -or $Journal.previousRunning -isnot [bool] -or $Journal.previousStartType -notin @(2,3,4) -or $Journal.selected -notin @('candidate','previous') -or ($null -ne $Journal.terminal -and $Journal.terminal -notin @('candidate','previous','removed')) -or ($Journal.terminal -eq 'removed' -and $null -ne $Journal.previous) -or ($Journal.hadTask -and $null -eq $Journal.previousMaintenance)) { throw 'Invalid recovery ownership state.' }
    if ($Journal.previousTaskXml -and $Journal.previousTaskXml.Length -gt 65536) { throw 'Oversized recovery task backup.' }
    if ($null -ne $Journal.previousMaintenance) { Assert-AgentVVersion $Journal.previousMaintenance.version; if ($Journal.previousMaintenance.ownerId -cne $Owner.id -or $Journal.previousMaintenance.manifestSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid recovery launcher backup.' } }
    Assert-AgentVHttpsUrl -Value $Journal.platformUrl
    if ($Journal.targetId -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw 'Invalid recovery target.' }
    foreach ($selection in @($Journal.candidate,$Journal.previous)) {
        if ($null -eq $selection) { continue }
        Assert-AgentVVersion -Version $selection.version
        $null = Assert-AgentVPackage -Directory (Join-Path $script:Paths.Releases $selection.version) -Version $selection.version
        if ($selection.manifestSha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileHash (Join-Path $script:Paths.Releases ($selection.version+'\package-manifest.json')) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $selection.manifestSha256) { throw 'Journal package checksum binding changed.' }
        Assert-AgentVNode -NodePath $selection.node
        Assert-AgentVConfig -Config $selection.config -TargetId $Journal.targetId -PlatformUrl $Journal.platformUrl
    }
    if ($null -ne $Journal.transaction -and ($Journal.transaction.id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or $Journal.transaction.secret -notmatch '^avt_[0-9a-f-]{36}_[0-9a-f]{32}$')) { throw 'Invalid protected transaction identity.' }
    $service = Assert-AgentVOwnedService -OwnerId $Owner.id
    $images=@(Get-AgentVImage $Journal.candidate); if ($null -ne $Journal.previous) { $images+=Get-AgentVImage $Journal.previous }
    if ($null -ne $service -and $service.PathName -cnotin $images) { throw 'Service selection does not belong to this transaction.' }
}
function Invoke-AgentVApi {
    param([string]$PlatformUrl,[string]$Suffix,[string]$Method='GET',$Body,[string]$Secret,[string]$CaBundle)
    Assert-AgentVHttpsUrl -Value $PlatformUrl
    if ($Suffix -notmatch '^/api/v1/agentv/(enrollments/exchange|installations/[0-9a-f-]{36}/(status|commit|rollback))$' -or $Method -notin @('GET','POST')) { throw 'Invalid fixed enrollment endpoint.' }
    if ($Secret -and $Secret -notmatch '^avt_[0-9a-f-]{36}_[0-9a-f]{32}$') { throw 'Invalid transaction secret encoding.' }
    $work = Join-Path $script:Paths.Root 'http'; New-AgentVProtectedDirectory -Path $work
    $response = Join-Path $work 'response.json'; $request = Join-Path $work 'request.json'; $header = Join-Path $work 'curl.conf'
    $curl = Join-Path ([Environment]::SystemDirectory) 'curl.exe'; Assert-AgentVTrustedPath -Path $curl
    foreach ($file in @($response,$request,$header)) { if (Test-Path -LiteralPath $file) { Assert-AgentVTrustedPath -Path $file -Secret; Remove-Item -LiteralPath $file -Force } }
    try {
        [IO.File]::WriteAllBytes($header,[byte[]]@()); Set-AgentVAcl -Path $header
        if ($Secret) { [IO.File]::WriteAllText($header,('header = "x-agentv-transaction-secret: '+$Secret+'"'),[Text.UTF8Encoding]::new($false)) }
        $arguments = @('-q','--silent','--show-error','--proto','=https','--proto-redir','=https','--max-redirs','0','--connect-timeout','10','--max-time','20','--max-filesize','65536','--request',$Method,'--config',$header,'--output',$response,'--write-out','%{http_code}')
        if ($CaBundle) { Assert-AgentVTrustedPath -Path $CaBundle; $arguments += @('--cacert',$CaBundle) }
        if ($null -ne $Body) { Write-AgentVDurableJson -Path $request -Value $Body; $arguments += @('--header','Content-Type: application/json','--data-binary',('@'+$request)) }
        $arguments += ($PlatformUrl.TrimEnd('/')+$Suffix)
        $ambient=@{}
        foreach($name in @('CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY')) { $ambient[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
        try { $code = & $curl @arguments 2>$null; $exit = $LASTEXITCODE }
        finally { foreach($name in $ambient.Keys){[Environment]::SetEnvironmentVariable($name,$ambient[$name],'Process')} }
        if ($exit -ne 0 -or $code -notmatch '^\d{3}$' -or -not (Test-Path -LiteralPath $response)) { return [pscustomobject]@{ available=$false; code=0; data=$null } }
        Set-AgentVAcl -Path $response
        $data = Read-AgentVJson -Path $response -Limit 65536 -Secret
        return [pscustomobject]@{ available=([int]$code -eq 200); code=[int]$code; data=$data }
    } catch { return [pscustomobject]@{ available=$false; code=0; data=$null } }
    finally { foreach ($file in @($response,$request,$header)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } } }
}
function Get-AgentVCaBundle {
    param($Config)
    if ($Config.settings.PSObject.Properties['ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE']) { return $Config.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE }
    return ''
}
function Get-AgentVRemoteStatus {
    param($Journal)
    $result = Invoke-AgentVApi -PlatformUrl $Journal.platformUrl -Suffix ('/api/v1/agentv/installations/'+$Journal.transaction.id+'/status') -Secret $Journal.transaction.secret -CaBundle (Get-AgentVCaBundle $Journal.candidate.config)
    if (-not $result.available) { return $null }
    $data = $result.data
    if (@($data.PSObject.Properties.Name).Count -ne 4 -or $data.transactionId -cne $Journal.transaction.id -or $data.status -notin @('issued','exchanged','verified','completed','cancelled','expired') -or $data.credentialState -notin @('pending','active','grace','revoked') -or $data.activeConnected -isnot [bool]) { return $null }
    return $data
}
function Test-AgentVReady {
    param([string]$ConfigHash,[string]$Phase)
    try {
        $sid = Get-AgentVServiceSid
        Assert-AgentVTrustedPath -Path $script:Paths.State -ServiceWriteSid $sid
        # These service-writable files are evidence only. Never use their strings as paths or commands.
        $launchPath = Join-Path $script:Paths.State 'launch.json'; $markerPath = Join-Path $script:Paths.State 'authenticated.json'
        foreach ($path in @($launchPath,$markerPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -gt 4096 -or ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false } }
        $launch = Read-AgentVBoundedEvidence -Path $launchPath; $marker = Read-AgentVBoundedEvidence -Path $markerPath
        $time = [DateTimeOffset]::Parse($marker.authenticatedAt)
        return $marker.version -eq 1 -and $marker.authenticated -eq $true -and $marker.phase -ceq $Phase -and $launch.launchId -match '^[0-9a-f-]{36}$' -and $marker.launchId -ceq $launch.launchId -and $marker.configSha256 -ceq $ConfigHash -and $launch.configSha256 -ceq $ConfigHash -and ([DateTimeOffset]::UtcNow-$time).TotalSeconds -ge -5 -and ([DateTimeOffset]::UtcNow-$time).TotalSeconds -le 30
    } catch { return $false }
}
function Stop-AgentVAndDrain {
    param($Journal)
    Save-AgentVJournal -Journal $Journal -Phase 'disable-intent'
    [AcornOps.AgentV.InstallerPolicy]::DisableOwned()
    Save-AgentVJournal -Journal $Journal -Phase 'disabled'
    [AcornOps.AgentV.InstallerPolicy]::SuppressOwned()
    Save-AgentVJournal -Journal $Journal -Phase 'suppressed'
    $service = Get-Service -Name AcornOpsAgentV; $requestedStop = $service.Status -ne 'Stopped'
    if ($requestedStop) { Stop-Service -Name AcornOpsAgentV }
    $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(25))
    $native = CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    if ($native.ProcessId -ne 0 -or ($requestedStop -and ($native.ExitCode -ne 0 -or $native.ServiceSpecificExitCode -ne 0))) { throw 'AgentV host did not confirm clean tree shutdown.' }
    Save-AgentVJournal -Journal $Journal -Phase 'restart-drain'
    if ($Journal.everStarted) { $clock=[Diagnostics.Stopwatch]::StartNew(); while ($clock.Elapsed.TotalSeconds -lt 65) { Start-Sleep -Milliseconds 250 } }
    [AcornOps.AgentV.InstallerPolicy]::MakeManual()
    Save-AgentVJournal -Journal $Journal -Phase 'manual'
}
function Select-AgentV {
    param($Journal,[ValidateSet('candidate','previous')][string]$Which)
    $selection = $Journal.$Which
    if ($null -eq $selection) { throw 'Missing protected runtime selection.' }
    Save-AgentVJournal -Journal $Journal -Phase ('select-'+$Which+'-intent')
    $Journal.selected = $Which; Save-AgentVJournal -Journal $Journal -Phase ('selected-'+$Which)
    Write-AgentVDurableJson -Path $script:Paths.Config -Value $selection.config -ServiceReadSid (Get-AgentVServiceSid)
    Invoke-AgentVSc -Arguments @('config','AcornOpsAgentV','binPath=',(Get-AgentVImage $selection))
    $Journal.everStarted = $true; Save-AgentVJournal -Journal $Journal -Phase ('start-'+$Which+'-intent')
    Start-Service -Name AcornOpsAgentV
    Save-AgentVJournal -Journal $Journal -Phase ('started-'+$Which)
    return (Get-FileHash -LiteralPath $script:Paths.Config -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-AgentVBoundedEvidence {
    param([string]$Path)
    $file = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try {
        $buffer=New-Object byte[] 4097; $length=0
        while ($length -lt $buffer.Length) { $count=$file.Read($buffer,$length,$buffer.Length-$length); if (-not $count) { break }; $length += $count }
        if ($length -gt 4096) { throw 'Oversized service evidence.' }
        return [Text.Encoding]::UTF8.GetString($buffer,0,$length) | ConvertFrom-Json
    } finally { $file.Dispose() }
}
function Get-AgentVTaskArguments {
    return '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $script:Paths.Maintenance 'recover.ps1')+'" -Automatic'
}
function Assert-AgentVOwnedTask {
    param([string]$OwnerId)
    $task = ScheduledTasks\Get-ScheduledTask -TaskName $script:Paths.Task -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $null }
    if ($task.Description -cne ('AcornOps AgentV recovery '+$OwnerId) -or @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ine $script:PowerShell -or $task.Actions[0].Arguments -cne (Get-AgentVTaskArguments) -or $task.Principal.UserId -notin @('SYSTEM','S-1-5-18') -or $task.Principal.RunLevel -ne 'Highest') { throw 'Refusing an unrelated recovery task.' }
    $scheduler = New-Object -ComObject Schedule.Service; $scheduler.Connect()
    $registered = $scheduler.GetFolder('\').GetTask($script:Paths.Task)
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($registered.GetSecurityDescriptor(4))
    foreach ($ace in $descriptor.DiscretionaryAcl) { if ($ace.AceType -eq 'AccessAllowed' -and $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Recovery task permits an unrelated principal.' } }
    return $task
}
function Set-AgentVMaintenance {
    param([string]$Version,[string]$OwnerId)
    $release = Join-Path $script:Paths.Releases $Version
    $null = Assert-AgentVPackage -Directory $release -Version $Version
    New-AgentVProtectedDirectory -Path $script:Paths.Maintenance
    foreach ($name in @('recover.ps1','Paths.psm1','Package.psm1')) {
        $source = Join-Path $release ('windows\'+$name)
        Write-AgentVDurableBytes -Path (Join-Path $script:Paths.Maintenance $name) -Bytes ([IO.File]::ReadAllBytes($source))
    }
    Write-AgentVDurableJson -Path (Join-Path $script:Paths.Maintenance 'worker.json') -Value @{ version=$Version; ownerId=$OwnerId; manifestSha256=(Get-FileHash (Join-Path $release 'package-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant() }
}
function Ensure-AgentVRecoveryTask {
    param($Journal)
    $null = Assert-AgentVOwnedTask -OwnerId $Journal.ownerId
    Save-AgentVJournal -Journal $Journal -Phase 'recovery-owner-intent'
    Set-AgentVMaintenance -Version $Journal.candidate.version -OwnerId $Journal.ownerId
    $action = ScheduledTasks\New-ScheduledTaskAction -Execute $script:PowerShell -Argument (Get-AgentVTaskArguments)
    $startup = ScheduledTasks\New-ScheduledTaskTrigger -AtStartup
    $retry = ScheduledTasks\New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) -RepetitionInterval ([TimeSpan]::FromMinutes(5))
    $principal = ScheduledTasks\New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = ScheduledTasks\New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10))
    $null = ScheduledTasks\Register-ScheduledTask -TaskName $script:Paths.Task -Action $action -Trigger @($startup,$retry) -Principal $principal -Settings $settings -Description ('AcornOps AgentV recovery '+$Journal.ownerId) -Force
    $scheduler = New-Object -ComObject Schedule.Service; $scheduler.Connect()
    $scheduler.GetFolder('\').GetTask($script:Paths.Task).SetSecurityDescriptor('D:P(A;;FA;;;SY)(A;;FA;;;BA)',0)
    $null = Assert-AgentVOwnedTask -OwnerId $Journal.ownerId
    # No active marker exists yet: a real SYSTEM run must load the fixed launcher and no-op safely.
    $before = (Get-Date).AddSeconds(-1); ScheduledTasks\Start-ScheduledTask -TaskName $script:Paths.Task
    $clock = [Diagnostics.Stopwatch]::StartNew()
    do {
        Start-Sleep -Milliseconds 250
        $task = ScheduledTasks\Get-ScheduledTask -TaskName $script:Paths.Task
        $info = ScheduledTasks\Get-ScheduledTaskInfo -TaskName $script:Paths.Task
        if ($info.LastRunTime -ge $before -and $task.State -ne 'Running') { if ($info.LastTaskResult -ne 0) { throw 'SYSTEM recovery launcher failed its usability check.' }; break }
        if ($clock.Elapsed.TotalSeconds -gt 30) { throw 'SYSTEM recovery task did not complete its usability check.' }
    } while ($true)
    Save-AgentVJournal -Journal $Journal -Phase 'recovery-owner-ready'
}
function Finish-AgentVTransaction {
    param($Journal,[ValidateSet('candidate','previous','removed')][string]$Selection)
    $Journal.terminal = $Selection; Save-AgentVJournal -Journal $Journal -Phase 'finalize-intent'
    if ($Selection -eq 'removed') {
        $service = Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue
        if ($null -ne $service) {
            Stop-AgentVAndDrain -Journal $Journal
            if (-not $Journal.hadService) { Invoke-AgentVSc -Arguments @('delete','AcornOpsAgentV') }
        }
        if (Test-Path -LiteralPath $script:Paths.Config) { Remove-Item -LiteralPath $script:Paths.Config -Force }
        Restore-AgentVPreviousMaintenance -Journal $Journal
    } else {
        $selected = $Journal.$Selection
        Write-AgentVDurableJson -Path $script:Paths.Selection -Value @{ version=$selected.version; node=$selected.node; manifestSha256=$selected.manifestSha256; ownerId=$Journal.ownerId }
        $startType = if ($null -ne $Journal.previous) { [uint32]$Journal.previousStartType } else { [uint32]2 }
        if ($null -ne $Journal.previous -and -not $Journal.previousRunning) { Stop-Service AcornOpsAgentV; (Get-Service AcornOpsAgentV).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(25)) }
        [AcornOps.AgentV.InstallerPolicy]::RestoreOwned($startType)
        if ($Selection -eq 'previous') { Restore-AgentVPreviousMaintenance -Journal $Journal }
    }
    Save-AgentVJournal -Journal $Journal -Phase 'finalized'
    if (Test-Path -LiteralPath $script:Paths.Marker) { Remove-Item -LiteralPath $script:Paths.Marker -Force }
    Remove-Item -LiteralPath $script:Paths.Journal -Force
}
function Invoke-AgentVRecovery {
    param([switch]$Automatic)
    Assert-AgentVAdministrator
    if (-not (Test-Path -LiteralPath $script:Paths.Journal)) { return 'idle' }
    $owner = Read-AgentVJson -Path $script:Paths.Owner -Secret
    $journal = Read-AgentVJson -Path $script:Paths.Journal -Secret
    if ($journal.ownerId -cne $owner.id) { throw 'Recovery ownership mismatch.' }
    # Prepared ownership is probed by SYSTEM before any cutover marker is published.
    if (-not (Test-Path -LiteralPath $script:Paths.Marker) -and $null -eq $journal.terminal -and $null -eq $journal.transaction) { return 'prepared' }
    $lock = Enter-AgentVLock -Path $script:Paths.Lock
    try {
        $journal = Read-AgentVJson -Path $script:Paths.Journal -Secret
        Assert-AgentVJournal -Journal $journal -Owner $owner
        if ($null -ne $journal.transaction -and -not (Test-Path -LiteralPath $script:Paths.Marker)) { Write-AgentVDurableJson -Path $script:Paths.Marker -Value @{schema='acornops.agentv-windows-active.v1';ownerId=$owner.id} }
        Import-AgentVInstallerNative -Directory (Join-Path $script:Paths.Releases $journal.candidate.version) -Version $journal.candidate.version
        if ($journal.terminal -eq 'removed') { Finish-AgentVTransaction -Journal $journal -Selection removed; return 'rolled-back' }
        if ($journal.phase -eq 'finalized' -and -not (Test-Path -LiteralPath $script:Paths.Marker)) { Remove-Item -LiteralPath $script:Paths.Journal -Force; return 'completed' }
        if ($null -ne $journal.terminal) { $journal.terminal=$null; Save-AgentVJournal -Journal $journal -Phase 'finalization-reverify' }
        if ($Automatic -and $journal.attempts -ge 12) { return 'manual-recovery-required' }
        if (-not $Automatic) { $journal.attempts=0 }
        $journal.attempts++; Save-AgentVJournal -Journal $journal -Phase 'recovery-entered'
        return Resume-AgentVTransaction -Journal $journal
    } finally { $lock.Dispose() }
}
function Resume-AgentVTransaction {
    param($Journal)
    # Every re-entry disables, suppresses and repeats the monotonic drain; no wall-clock shortcut.
    Stop-AgentVAndDrain -Journal $Journal
    $status = if ($null -ne $Journal.transaction) { Get-AgentVRemoteStatus -Journal $Journal } else { $null }
    $which = 'candidate'
    if ($null -ne $status -and $status.status -in @('cancelled','expired') -and $status.credentialState -eq 'revoked') { if ($null -eq $Journal.previous) { Finish-AgentVTransaction -Journal $Journal -Selection 'removed'; return 'rolled-back' }; $which='previous' }
    elseif ($null -eq $Journal.transaction -and $Journal.intent -eq 'rollback') { $which='previous' }
    elseif ($null -ne $status -and $status.status -eq 'completed' -and $status.credentialState -in @('grace','revoked')) { Save-AgentVJournal -Journal $Journal -Phase 'replacement-required'; return 'replacement-required' }
    $hash = Select-AgentV -Journal $Journal -Which $which
    $clock = [Diagnostics.Stopwatch]::StartNew(); $mutationSent=$false
    do {
        if ($null -eq $Journal.transaction) {
            if (Test-AgentVReady -ConfigHash $hash -Phase 'active') { Finish-AgentVTransaction -Journal $Journal -Selection $which; return 'completed' }
        } else {
            $status = Get-AgentVRemoteStatus -Journal $Journal
            $phase = if ($null -ne $status -and $status.status -eq 'verified') { 'provisional' } else { 'active' }
            $ready = Test-AgentVReady -ConfigHash $hash -Phase $phase
            $decision = Get-AgentVRecoveryDecision -Intent $Journal.intent -Status $status -CandidateReady ($which -eq 'candidate' -and $ready) -PreviousReady ($which -eq 'previous' -and $ready) -PreviousExists ($null -ne $Journal.previous)
            if ($decision -eq 'finalize-candidate') { Finish-AgentVTransaction -Journal $Journal -Selection 'candidate'; return 'completed' }
            if ($decision -eq 'finalize-previous') { Finish-AgentVTransaction -Journal $Journal -Selection 'previous'; return 'rolled-back' }
            if ($decision -eq 'remove-initial') { Finish-AgentVTransaction -Journal $Journal -Selection 'removed'; return 'rolled-back' }
            if ($decision -eq 'replacement-required' -or $decision -eq 'retain-candidate-recovery-required') { Save-AgentVJournal -Journal $Journal -Phase $decision; return $decision }
            if ($decision -eq 'restore-previous' -and $which -ne 'previous') { Stop-AgentVAndDrain -Journal $Journal; $which='previous'; $hash=Select-AgentV -Journal $Journal -Which previous; $clock.Restart() }
            elseif ($decision -in @('commit','rollback') -and -not $mutationSent) {
                Save-AgentVJournal -Journal $Journal -Phase ($decision+'-intent')
                $result = Invoke-AgentVApi -PlatformUrl $Journal.platformUrl -Suffix ('/api/v1/agentv/installations/'+$Journal.transaction.id+'/'+$decision) -Method POST -Secret $Journal.transaction.secret -CaBundle (Get-AgentVCaBundle $Journal.candidate.config)
                $mutationSent=$true
                # Always resolve via authenticated status, including a lost response or a late rejection.
                $resolved = Get-AgentVRemoteStatus -Journal $Journal
                if ($decision -eq 'rollback' -and $result.code -eq 409 -and $null -ne $resolved -and $resolved.status -eq 'completed' -and $resolved.credentialState -eq 'active') { $Journal.intent='rollback-denied'; Save-AgentVJournal -Journal $Journal -Phase 'rollback-denied' }
            }
        }
        Start-Sleep -Milliseconds 500
    } while ($clock.Elapsed.TotalSeconds -lt 90)
    if ($null -eq $Journal.transaction -and $which -eq 'candidate' -and $null -ne $Journal.previous) { $Journal.intent='rollback'; Save-AgentVJournal -Journal $Journal -Phase 'repair-rollback-intent'; return Resume-AgentVTransaction -Journal $Journal }
    # A failed candidate can only be restored after an authenticated rollback outcome.
    if ($null -ne $Journal.transaction -and $null -ne $status -and $status.status -in @('exchanged','verified','completed') -and $status.credentialState -in @('pending','active') -and $Journal.intent -eq 'commit') { $Journal.intent='rollback'; Save-AgentVJournal -Journal $Journal -Phase 'rollback-intent'; return Resume-AgentVTransaction -Journal $Journal }
    Save-AgentVJournal -Journal $Journal -Phase 'recovery-pending'
    return 'pending'
}
function Test-AgentVCandidateDoctor {
    param([string]$Release,[string]$NodePath,$Config)
    $start = [Diagnostics.ProcessStartInfo]::new($NodePath,('"'+(Join-Path $Release 'windows\doctor.mjs')+'" "'+[Environment]::SystemDirectory+'"'))
    $start.WorkingDirectory=$Release; $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $start.EnvironmentVariables.Clear(); $system=[Environment]::SystemDirectory
    $start.EnvironmentVariables['SystemRoot']=Split-Path $system -Parent; $start.EnvironmentVariables['WINDIR']=Split-Path $system -Parent; $start.EnvironmentVariables['PATH']=$system
    foreach ($property in $Config.settings.PSObject.Properties) { $start.EnvironmentVariables[$property.Name]=$property.Value }
    $start.EnvironmentVariables['ACORNOPS_AGENT_KEY']='ak_'+$Config.settings.ACORNOPS_TARGET_ID+'_'+'a'*32
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(20000)) { $process.Kill(); $process.WaitForExit(5000) | Out-Null; throw 'Candidate doctor exceeded its deadline.' }
        $text=$stdout.GetAwaiter().GetResult(); $errors=$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or $text.Length -gt 65536 -or $errors.Length -gt 65536 -or ($text | ConvertFrom-Json).ok -ne $true) { throw 'Candidate Windows runtime failed outbound-free readiness checks.' }
    } finally { $process.Dispose() }
}
function Restore-AgentVPreviousMaintenance {
    param($Journal)
    if ($null -ne $Journal.previousMaintenance) { Set-AgentVMaintenance -Version $Journal.previousMaintenance.version -OwnerId $Journal.ownerId }
    if ($Journal.hadTask -and $Journal.previousTaskXml) {
        $xml=[Xml.XmlDocument]::new(); $xml.XmlResolver=$null; $xml.LoadXml($Journal.previousTaskXml)
        $commands=@($xml.SelectNodes('//*[local-name()="Actions"]/*[local-name()="Exec"]/*[local-name()="Command"]'))
        $arguments=@($xml.SelectNodes('//*[local-name()="Actions"]/*[local-name()="Exec"]/*[local-name()="Arguments"]'))
        if ($commands.Count -ne 1 -or $arguments.Count -ne 1 -or $commands[0].InnerText -ine $script:PowerShell -or $arguments[0].InnerText -cne (Get-AgentVTaskArguments)) { throw 'Invalid trusted prior recovery task.' }
        $null=ScheduledTasks\Register-ScheduledTask -TaskName $script:Paths.Task -Xml $Journal.previousTaskXml -Force
        $scheduler=New-Object -ComObject Schedule.Service; $scheduler.Connect(); $scheduler.GetFolder('\').GetTask($script:Paths.Task).SetSecurityDescriptor('D:P(A;;FA;;;SY)(A;;FA;;;BA)',0)
        $null=Assert-AgentVOwnedTask -OwnerId $Journal.ownerId
    } elseif (-not $Journal.hadTask) { ScheduledTasks\Unregister-ScheduledTask -TaskName $script:Paths.Task -Confirm:$false -ErrorAction SilentlyContinue }
}
function Invoke-AgentVInstallation {
    param([string]$PackageDirectory,[string]$Version,[string]$PlatformUrl,[string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential,[string]$NodePath,[string]$AdditionalCaBundleFile)
    Assert-AgentVAdministrator; Assert-AgentVVersion $Version; Assert-AgentVHttpsUrl $PlatformUrl
    $PlatformUrl=$PlatformUrl.TrimEnd('/')
    if ($TargetId -notmatch '^[A-Za-z0-9_.-]{1,128}$' -or ($ReplaceCredential -and -not $EnrollmentToken)) { throw 'Invalid Windows installation request.' }
    $enrollmentId=$null
    if ($EnrollmentToken) { if ($EnrollmentToken -notmatch '^aev_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_[A-Za-z0-9_-]{43}$') { throw 'Invalid enrollment token encoding.' }; $enrollmentId=$Matches[1] }
    $null=Assert-AgentVPackage -Directory $PackageDirectory -Version $Version
    if (-not $NodePath) { $NodePath=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'nodejs\node.exe' }
    $NodePath=[IO.Path]::GetFullPath($NodePath); Assert-AgentVNode $NodePath
    if ($AdditionalCaBundleFile) { $AdditionalCaBundleFile=[IO.Path]::GetFullPath($AdditionalCaBundleFile); Assert-AgentVTrustedPath $AdditionalCaBundleFile; Assert-AgentVServiceReadable -Path $AdditionalCaBundleFile }
    if (Test-Path -LiteralPath $script:Paths.Root) { Assert-AgentVTrustedPath $script:Paths.Root; if (-not (Test-Path -LiteralPath $script:Paths.Owner)) { throw 'Refusing an unrelated preexisting AgentV data directory.' } }
    else {
        if (Test-Path -LiteralPath $script:Paths.Program) { throw 'Refusing an unrelated preexisting AgentV program directory.' }
        if (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) { throw 'Refusing an unrelated preexisting service.' }
        if (ScheduledTasks\Get-ScheduledTask -TaskName $script:Paths.Task -ErrorAction SilentlyContinue) { throw 'Refusing an unrelated preexisting recovery task.' }
        New-AgentVProtectedDirectory $script:Paths.Root
        Write-AgentVDurableJson -Path $script:Paths.Owner -Value @{schema='acornops.agentv-windows-owner.v1';id=[Guid]::NewGuid().ToString()}
    }
    $owner=Read-AgentVJson -Path $script:Paths.Owner -Secret
    if ($owner.schema -cne 'acornops.agentv-windows-owner.v1' -or $owner.id -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid installation ownership marker.' }
    $lock=Enter-AgentVLock -Path $script:Paths.Lock
    try {
        $service=Assert-AgentVOwnedService -OwnerId $owner.id; $task=Assert-AgentVOwnedTask -OwnerId $owner.id
        if (Test-Path -LiteralPath $script:Paths.Marker) { throw 'An unresolved AgentV transaction requires recovery before another installation.' }
        if (Test-Path -LiteralPath $script:Paths.Journal) {
            $abandoned=Read-AgentVJson -Path $script:Paths.Journal -Secret
            if ($null -ne $abandoned.transaction -or $null -ne $abandoned.terminal -or $abandoned.ownerId -cne $owner.id) { throw 'Protected pending state requires recovery.' }
            Restore-AgentVPreviousMaintenance -Journal $abandoned
            Remove-Item -LiteralPath $script:Paths.Journal -Force
        }
        New-AgentVProtectedDirectory $script:Paths.Releases
        $release=Join-Path $script:Paths.Releases $Version
        if (Test-Path -LiteralPath $release) {
            $null=Assert-AgentVPackage -Directory $release -Version $Version
            if ((Get-FileHash (Join-Path $release 'package-manifest.json')).Hash -cne (Get-FileHash (Join-Path $PackageDirectory 'package-manifest.json')).Hash) { throw 'An immutable release cannot be overwritten.' }
        } else {
            $staging=Join-Path $script:Paths.Releases ('.stage-'+[Guid]::NewGuid().ToString('N'))
            try {
                New-AgentVProtectedDirectory $staging
                Get-ChildItem -LiteralPath $PackageDirectory -Force | Copy-Item -Destination $staging -Recurse
                foreach ($file in Get-ChildItem -LiteralPath $staging -Recurse -Force) { Set-AgentVAcl $file.FullName }
                $null=Assert-AgentVPackage -Directory $staging -Version $Version
                [IO.Directory]::Move($staging,$release)
            } finally { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force } }
        }
        # Framework assemblies stay loaded until process exit. Load only the
        # validated immutable copy; bootstrap staging must remain removable.
        Import-AgentVInstallerNative -Directory $release -Version $Version
        $previous=$null; $previousStartType=2; $previousRunning=$true
        if (Test-Path -LiteralPath $script:Paths.Config) {
            if ($null -eq $service -or -not (Test-Path -LiteralPath $script:Paths.Selection)) { throw 'Owned configuration requires explicit service recovery.' }
            $previousConfig=Read-AgentVJson -Path $script:Paths.Config -Limit 65536 -Secret -ServiceReadSid (Get-AgentVServiceSid)
            Assert-AgentVConfig $previousConfig $TargetId $PlatformUrl
            $selection=Read-AgentVJson -Path $script:Paths.Selection -Secret
            $previous=[pscustomobject]@{version=$selection.version;node=$selection.node;manifestSha256=$selection.manifestSha256;config=$previousConfig}
            if ((Get-AgentVImage $previous) -cne $service.PathName) { throw 'Service and protected selected runtime disagree.' }
            $policy=[AcornOps.AgentV.InstallerPolicy]::Read(); if (-not $policy.Standard) { throw 'Refusing custom or suppressed recovery policy outside a transaction.' }
            $previousStartType=$policy.StartType; $previousRunning=$service.State -eq 'Running'
            if ($EnrollmentToken -and -not $ReplaceCredential) { throw 'Replacing an existing credential requires ReplaceCredential.' }
        } elseif (-not $EnrollmentToken -or $ReplaceCredential) { throw 'Initial installation requires a one-use initial enrollment token.' }
        $settings = if ($null -ne $previous) { $previous.config.settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json } else { [pscustomobject]@{ACORNOPS_AGENT_PLATFORM_URL=$PlatformUrl;ACORNOPS_TARGET_ID=$TargetId;ACORNOPS_AGENT_KEY=('ak_'+$TargetId+'_'+'a'*32);ACORNOPS_AGENT_TARGET_TYPE='virtual_machine';ACORNOPS_VM_OS_FAMILY='windows';ACORNOPS_VM_SERVICE_MANAGER='scm';ACORNOPS_VM_COLLECTOR_MODE='live';ACORNOPS_AGENT_WRITE_ENABLED='false';ACORNOPS_AGENT_MOCK_ACTIONS_ENABLED='false';ACORNOPS_AGENT_LOG_LEVEL='info'} }
        if ($AdditionalCaBundleFile) { $settings | Add-Member -NotePropertyName ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -NotePropertyValue $AdditionalCaBundleFile -Force }
        $candidate=[pscustomobject]@{version=$Version;node=$NodePath;manifestSha256=(Get-FileHash (Join-Path $PackageDirectory 'package-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant();config=[pscustomobject]@{version=1;settings=$settings}}
        Assert-AgentVConfig $candidate.config $TargetId $PlatformUrl
        Test-AgentVCandidateDoctor -Release $release -NodePath $NodePath -Config $candidate.config
        $previousMaintenance=$null
        if (Test-Path -LiteralPath (Join-Path $script:Paths.Maintenance 'worker.json')) { $previousMaintenance=Read-AgentVJson -Path (Join-Path $script:Paths.Maintenance 'worker.json') -Secret }
        $previousTaskXml=if ($null -ne $task) { ScheduledTasks\Export-ScheduledTask -TaskName $script:Paths.Task } else { $null }
        $journal=[pscustomobject]@{schema='acornops.agentv-windows-installation.v1';ownerId=$owner.id;operation=$(if($EnrollmentToken){'install'}else{'repair'});intent='commit';platformUrl=$PlatformUrl;targetId=$TargetId;candidate=$candidate;previous=$previous;previousStartType=$previousStartType;previousRunning=$previousRunning;hadService=($null -ne $service);hadTask=($null -ne $task);previousTaskXml=$previousTaskXml;previousMaintenance=$previousMaintenance;transaction=$null;everStarted=($null -ne $service);attempts=0;terminal=$null;selected='previous';phase='prepared'}
        Save-AgentVJournal -Journal $journal -Phase 'prepared'
        if ($null -eq $service) {
            Invoke-AgentVSc -Arguments @('create','AcornOpsAgentV','binPath=',(Get-AgentVImage $candidate),'start=','disabled','obj=','NT AUTHORITY\LocalService')
            Invoke-AgentVSc -Arguments @('description','AcornOpsAgentV',('AcornOps AgentV installation '+$owner.id))
            Invoke-AgentVSc -Arguments @('sidtype','AcornOpsAgentV','unrestricted')
            Invoke-AgentVSc -Arguments @('failure','AcornOpsAgentV','reset=','86400','actions=','restart/10000/restart/30000/restart/60000')
            Invoke-AgentVSc -Arguments @('failureflag','AcornOpsAgentV','0')
        }
        $sid=Get-AgentVServiceSid
        foreach ($parent in @((Split-Path $script:Paths.Program -Parent),(Split-Path $script:Paths.Root -Parent))) {
            Assert-AgentVTrustedPath $parent
            $acl=Get-Acl $parent; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]$sid,'ReadAndExecute','Allow')); Set-Acl $parent $acl
        }
        foreach ($path in @($script:Paths.Program,$script:Paths.Releases,$release,$script:Paths.Root)) { Assert-AgentVTrustedPath $path; Set-AgentVAcl -Path $path -ServiceSid $sid }
        foreach ($file in Get-ChildItem -LiteralPath $release -Recurse -Force) { Assert-AgentVTrustedPath $file.FullName; Set-AgentVAcl -Path $file.FullName -ServiceSid $sid }
        New-AgentVProtectedDirectory -Path $script:Paths.State -ServiceSid $sid -Rights Modify
        New-AgentVProtectedDirectory -Path $script:Paths.Logs -ServiceSid $sid -Rights Modify
        Import-AgentVInstallerNative -Directory $release -Version $Version
        Ensure-AgentVRecoveryTask -Journal $journal
        if ($EnrollmentToken) {
            $purpose=if($ReplaceCredential){'replace'}else{'initial'}
            Save-AgentVJournal -Journal $journal -Phase 'exchange-intent'
            $exchange=Invoke-AgentVApi -PlatformUrl $PlatformUrl -Suffix '/api/v1/agentv/enrollments/exchange' -Method POST -Body @{targetId=$TargetId;enrollmentToken=$EnrollmentToken;purpose=$purpose} -CaBundle (Get-AgentVCaBundle $candidate.config)
            $EnrollmentToken=''
            if (-not $exchange.available) { Save-AgentVJournal -Journal $journal -Phase 'exchange-response-unavailable'; throw 'Enrollment response unavailable; original configuration retained. A consumed token may require replacement.' }
            $data=$exchange.data
            if ($data.transactionId -cne $enrollmentId -or $data.purpose -cne $purpose -or $data.agentKey -notmatch ('^ak_'+[Regex]::Escape($TargetId)+'_[A-Za-z0-9_-]{32}$') -or $data.transactionSecret -notmatch '^avt_[0-9a-f-]{36}_[0-9a-f]{32}$' -or $data.accessPolicy.accessMode -cne 'read_only' -or @($data.accessPolicy.restartServices).Count -ne 0) { Save-AgentVJournal -Journal $journal -Phase 'exchange-response-invalid'; throw 'Enrollment response did not match the read-only target.' }
            $journal.transaction=[pscustomobject]@{id=$data.transactionId;secret=$data.transactionSecret}
            $journal.candidate.config.settings.ACORNOPS_AGENT_KEY=$data.agentKey
            Save-AgentVJournal -Journal $journal -Phase 'exchanged'
        }
        Write-AgentVDurableJson -Path $script:Paths.Marker -Value @{schema='acornops.agentv-windows-active.v1';ownerId=$owner.id}
        return Resume-AgentVTransaction -Journal $journal
    } finally { $lock.Dispose() }
}
function Invoke-AgentVUninstall {
    Assert-AgentVAdministrator
    if (-not (Test-Path -LiteralPath $script:Paths.Owner)) { throw 'No owned AgentV installation exists.' }
    $owner=Read-AgentVJson -Path $script:Paths.Owner -Secret
    $lock=Enter-AgentVLock -Path $script:Paths.Lock
    try {
        if ((Test-Path -LiteralPath $script:Paths.Journal) -or (Test-Path -LiteralPath $script:Paths.Marker)) { throw 'Resolve the protected installation transaction before uninstalling.' }
        $service=Assert-AgentVOwnedService -OwnerId $owner.id; $task=Assert-AgentVOwnedTask -OwnerId $owner.id
        if ($null -ne $service) {
            $selected=Read-AgentVJson -Path $script:Paths.Selection -Secret
            Import-AgentVInstallerNative -Directory (Join-Path $script:Paths.Releases $selected.version) -Version $selected.version
            [AcornOps.AgentV.InstallerPolicy]::DisableOwned(); [AcornOps.AgentV.InstallerPolicy]::SuppressOwned()
            $requested=$service.State -ne 'Stopped'; if ($requested) { Stop-Service AcornOpsAgentV }
            (Get-Service AcornOpsAgentV).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(25))
            $stopped=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
            if ($stopped.ProcessId -ne 0 -or ($requested -and ($stopped.ExitCode -ne 0 -or $stopped.ServiceSpecificExitCode -ne 0))) { throw 'Owned service tree stop was not confirmed.' }
            $clock=[Diagnostics.Stopwatch]::StartNew(); while($clock.Elapsed.TotalSeconds -lt 65){Start-Sleep -Milliseconds 250}
            Invoke-AgentVSc -Arguments @('delete','AcornOpsAgentV')
        }
        if ($null -ne $task) { ScheduledTasks\Unregister-ScheduledTask -TaskName $script:Paths.Task -Confirm:$false }
        return 'uninstalled-config-retained'
    } finally { $lock.Dispose() }
}
Export-ModuleMember -Function Invoke-AgentVInstallation,Invoke-AgentVRecovery,Invoke-AgentVUninstall
