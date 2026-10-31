[CmdletBinding()]
param([switch]$AllowDisposableCi,[ValidateSet('lifecycle','acceptance')][string]$Scenario='lifecycle')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Explicit disposable hosted-CI authorization is required.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'packaging\windows\Paths.psm1')
$paths=Get-AgentVPaths
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AgentV-Installer-CI'
$nodeRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('AgentV-Installer-CI-Node '+[char]0xfc)
$staging=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOpsAgentV-Staging'
$programParent=Split-Path $paths.Program -Parent; $dataParent=Split-Path $paths.Root -Parent
$ps=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$sc=Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$certificate=$null; $server=$null; $owned=$false
$script:CiProcesses=[Collections.Generic.List[Diagnostics.Process]]::new()
$evidence=[ordered]@{sourceRevision=(& git -C $repo rev-parse HEAD);node=(& node --version);os=[Environment]::OSVersion.VersionString;tests=@();stage='preflight';scenario=$Scenario}
function Assert-Ci([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:evidence.tests+=$Message}
function Wait-Ci([scriptblock]$Condition,[int]$Seconds=30){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not (& $Condition)){if($clock.Elapsed.TotalSeconds -gt $Seconds){throw 'Installer CI condition deadline exceeded.'};Start-Sleep -Milliseconds 200}}
function Json-Ci([string]$Path,$Value){
    $temporary=$Path+'.pending-'+[Guid]::NewGuid().ToString('N')
    try{[IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Depth 12 -Compress),[Text.UTF8Encoding]::new($false));if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temporary,$Path,[Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temporary,$Path)}}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
}
function Read-CiJson([string]$Path){
    $reader=$null
    $file=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try{if($file.Length -gt 262144){throw 'Oversized CI state'};$reader=[IO.StreamReader]::new($file);return $reader.ReadToEnd()|ConvertFrom-Json}finally{if($null -ne $reader){$reader.Dispose()};$file.Dispose()}
}
function State-Ci {return Read-CiJson (Join-Path $work 'server-state.json')}
$script:CiInstallationModule=Import-Module (Join-Path $repo 'packaging\windows\Installation.psm1') -PassThru -Force
function Invoke-CiSc([string[]]$Arguments){& $script:CiInstallationModule {param($Values) Invoke-AgentVSc -Arguments $Values} -Values $Arguments}
function Token-Ci {return 'aev_'+[Guid]::NewGuid().ToString()+'_'+('s'*43)}
function Bootstrap-Ci([string]$Token,[switch]$Replace,[switch]$OmitCa){
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$script:bootstrap,'-ReleaseBaseUrl',($script:url+'/releases'),'-PlatformUrl',$script:url,'-TargetId','windows-installer-ci','-NodePath',$script:node)
    if($Token){$arguments+=@('-EnrollmentToken',$Token)};if($Replace){$arguments+='-ReplaceCredential'}
    if(-not $OmitCa){$arguments+=@('-AdditionalCaBundleFile',$script:ca)}
    & $ps @arguments | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}
function Variant-Ci([string]$Version,[switch]$CorruptManifest,[switch]$FailAfterStart){
    # Synthetic same-code upgrade changes only version metadata; package contents
    # and selection/checksum behavior still flow through the production bootstrap.
    $source=Join-Path $assets ('agentv-'+$script:version+'-windows-x64.zip')
    $directory=Join-Path $work ('variant-'+[Guid]::NewGuid().ToString('N'))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($source,$directory)
    try {
        $metadataPath=Join-Path $directory 'package.json';$metadata=Get-Content $metadataPath -Raw|ConvertFrom-Json;$metadata.version=$Version;Json-Ci $metadataPath $metadata
        $manifestPath=Join-Path $directory 'package-manifest.json';$manifest=Get-Content $manifestPath -Raw|ConvertFrom-Json;$manifest.version=$Version
        $entry=@($manifest.files|Where-Object {$_.path -ceq 'package.json'})[0];$entry.sha256=(Get-FileHash $metadataPath -Algorithm SHA256).Hash.ToLowerInvariant();$entry.size=(Get-Item $metadataPath).Length
        if($FailAfterStart){
            $entryPath=Join-Path $directory 'dist\windows-service-entry.js'
            [IO.File]::WriteAllText($entryPath,"process.stdin.once('data',()=>setTimeout(()=>process.exit(43),1500));process.stdin.resume();",[Text.Encoding]::ASCII)
            $runtimeEntry=@($manifest.files|Where-Object {$_.path -ceq 'dist/windows-service-entry.js'})[0]
            $runtimeEntry.sha256=(Get-FileHash $entryPath -Algorithm SHA256).Hash.ToLowerInvariant();$runtimeEntry.size=(Get-Item $entryPath).Length
        }
        if($CorruptManifest){$entry.sha256='0'*64};Json-Ci $manifestPath $manifest
        $destination=Join-Path $releases ('v'+$Version);$null=New-Item -ItemType Directory -Path $destination
        $archive=Join-Path $destination ('agentv-'+$Version+'-windows-x64.zip')
        [IO.Compression.ZipFile]::CreateFromDirectory($directory,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
        [IO.File]::WriteAllText(($archive+'.sha256'),((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($archive)),[Text.Encoding]::ASCII)
        $scriptPath=Join-Path $destination 'install-agentv.ps1'
        [IO.File]::WriteAllText($scriptPath,([IO.File]::ReadAllText((Join-Path $assets 'install-agentv.ps1')).Replace("'"+$script:version+"'","'"+$Version+"'")),[Text.UTF8Encoding]::new($false))
        return $scriptPath
    } finally {Remove-Item $directory -Recurse -Force}
}
. (Join-Path $PSScriptRoot 'process-fixture.ps1')
function JournalPhase-Ci {
    try {return (Read-CiJson $paths.Journal).phase}catch{return ''}
}
. (Join-Path $PSScriptRoot 'acceptance-scenario.ps1')
try {
    foreach($path in @($work,$nodeRoot,$staging,$programParent,$dataParent)){if(Test-Path -LiteralPath $path){throw 'Refusing a preexisting CI resource.'}}
    if((Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -or (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)){throw 'Refusing preexisting service/task.'}
    New-AgentVProtectedDirectory $work; New-AgentVProtectedDirectory $nodeRoot; $owned=$true
    $node=Join-Path $nodeRoot 'node.exe'; Copy-Item -LiteralPath (Get-Command node).Source -Destination $node
    Set-AgentVAcl $nodeRoot 'S-1-5-32-545';Set-AgentVAcl $node 'S-1-5-32-545'
    $certificate=New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\LocalMachine\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter ((Get-Date).AddDays(2))
    $password=[Guid]::NewGuid().ToString('N');$pfx=Join-Path $work 'fixture.pfx'
    $null=Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password (ConvertTo-SecureString $password -AsPlainText -Force)
    $ca=Join-Path $nodeRoot ('fixture-ca '+[char]0xfc+'.pem')
    [IO.File]::WriteAllText($ca,"-----BEGIN CERTIFICATE-----`n"+[Convert]::ToBase64String($certificate.RawData,[Base64FormattingOptions]::InsertLineBreaks)+"`n-----END CERTIFICATE-----`n",[Text.Encoding]::ASCII)
    Set-AgentVAcl $ca 'S-1-5-32-545'
    $version=(Get-Content (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json).version
    $releases=Join-Path $work 'releases';$assets=Join-Path $releases ('v'+$version)
    $null=New-Item -ItemType Directory -Path $assets -Force
    $evidence.stage='archive-build'
    & (Join-Path $repo 'scripts\build-windows-archive.ps1') -OutputDirectory $assets
    $bootstrap=Join-Path $assets 'install-agentv.ps1'
    $evidence.archive=@{version=$version;sha256=(Get-FileHash (Join-Path $assets ('agentv-'+$version+'-windows-x64.zip')) -Algorithm SHA256).Hash.ToLowerInvariant()}
    $controls=Join-Path $work 'controls.json';Json-Ci $controls @{}
    $listening=Join-Path $work 'listening.json';$options=Join-Path $work 'server-options.json'
    Json-Ci $options @{allowDisposableCi=$true;pfx=$pfx;passphrase=$password;controls=$controls;state=(Join-Path $work 'server-state.json');listening=$listening;releases=$releases;journal=$paths.Journal;targetId='windows-installer-ci'}
    $server=Start-Process -FilePath $node -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'installation-server.mjs')+'"'),('"'+$options+'"')) -PassThru -RedirectStandardOutput (Join-Path $work 'server.stdout') -RedirectStandardError (Join-Path $work 'server.stderr')
    Wait-Ci {Test-Path -LiteralPath $listening}
    $url='https://localhost:'+((Get-Content $listening -Raw|ConvertFrom-Json).port)
    $evidence.stage='checksum-rejection'
    $sidecar=Join-Path $assets ('agentv-'+$version+'-windows-x64.zip.sha256')
    $savedChecksum=[IO.File]::ReadAllBytes($sidecar)
    try {
        [IO.File]::WriteAllText($sidecar,('0'*64+'  agentv-'+$version+'-windows-x64.zip'),[Text.Encoding]::ASCII)
        $exit=Bootstrap-Ci -Token (Token-Ci)
        Assert-Ci ($exit -ne 0 -and (State-Ci).exchanges -eq 0 -and -not(Test-Path $paths.Owner)) 'Archive checksum rejection consumes no token or installation ownership'
    } finally {[IO.File]::WriteAllBytes($sidecar,$savedChecksum)}
    $evidence.stage='node-write-rejection'
    try {
        $acl=Get-Acl $node; $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]'S-1-5-32-545','Write','Allow'));Set-Acl $node $acl
        $exit=Bootstrap-Ci -Token (Token-Ci)
        Assert-Ci ($exit -ne 0 -and (State-Ci).exchanges -eq 0 -and -not(Test-Path $paths.Owner)) 'Writable Node leaf rejection consumes no token despite a trusted parent'
    } finally {Set-AgentVAcl $node 'S-1-5-32-545'}
    $evidence.stage='node-read-rejection'
    try {
        Set-AgentVAcl $node
        $exit=Bootstrap-Ci -Token (Token-Ci)
        Assert-Ci ($exit -ne 0 -and (State-Ci).exchanges -eq 0 -and -not(Test-Path $paths.Owner)) 'Unreadable Node prerequisite rejects before token exchange'
    } finally {Set-AgentVAcl $node 'S-1-5-32-545'}
    $evidence.stage='fresh-install'
    $exit=Bootstrap-Ci -Token (Token-Ci)
    Assert-Ci ($exit -eq 0) 'Pinned bootstrap installs through the real SCM host'
    $state=State-Ci
    $evidence.hostManifest=Read-AgentVJson -Path (Join-Path $paths.Releases ($version+'\host-manifest.json')) -Limit 65536
    Assert-Ci ($state.exchanges -eq 1 -and $state.commits -eq 1 -and $state.activeConnected) 'Fresh enrollment commits only after provisional and active authentication'
    Assert-Ci ((Get-Service AcornOpsAgentV).Status -eq 'Running') 'Installed service runs after finalization'
    Assert-Ci (-not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker)) 'Finalization removes protected transaction state'
    $config=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid);$key=$config.settings.ACORNOPS_AGENT_KEY
    Assert-Ci ($config.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca) 'Initial trusted CA selection is persisted'
    if($Scenario -eq 'acceptance'){Invoke-CiAcceptance;$evidence.stage='complete';return}
    $evidence.stage='repair'
    # Bootstrap TLS still needs CA to download; the worker repair deliberately omits it.
    $worker=Join-Path $paths.Releases ($version+'\windows\install-worker.ps1')
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $worker -Version $version -PlatformUrl $url -TargetId windows-installer-ci -NodePath $node
    Assert-Ci ($LASTEXITCODE -eq 0) 'Repair reconnects through the owned service'
    $repaired=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($repaired.settings.ACORNOPS_AGENT_KEY -ceq $key -and $repaired.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca -and (State-Ci).exchanges -eq 1) 'Repair preserves credential and CA without another exchange'
    $evidence.stage='invalid-upgrade-manifest'
    $firstBootstrap=$bootstrap
    $bootstrap=Variant-Ci -Version ($version+'-invalid') -CorruptManifest
    $exit=Bootstrap-Ci
    Assert-Ci ($exit -ne 0 -and (State-Ci).exchanges -eq 1 -and (Get-Service AcornOpsAgentV).Status -eq 'Running' -and (Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)).settings.ACORNOPS_AGENT_KEY -ceq $key) 'Invalid candidate package leaves prior service and credential intact'
    $bootstrap=$firstBootstrap
    $evidence.stage='lost-exchange-response'
    Json-Ci $controls @{loseExchangeResponse=$true}
    $exit=Bootstrap-Ci -Token (Token-Ci) -Replace
    $retained=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($exit -ne 0 -and $retained.settings.ACORNOPS_AGENT_KEY -ceq $key -and -not(Test-Path $paths.Marker) -and (Get-Service AcornOpsAgentV).Status -eq 'Running') 'Lost exchange response retains original running configuration without cutover'
    $evidence.stage='lost-commit-replacement'
    Json-Ci $controls @{loseCommitResponse=$true}
    $exit=Bootstrap-Ci -Token (Token-Ci) -Replace
    Assert-Ci ($exit -eq 0) 'Lost replacement commit response resolves using authenticated status'
    $replaced=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($replaced.settings.ACORNOPS_AGENT_KEY -cne $key -and $replaced.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 2) 'Replacement retains the committed candidate generation'
    $evidence.stage='immutable-upgrade'
    $upgradeVersion=$version+'-upgrade'
    $bootstrap=Variant-Ci -Version $upgradeVersion
    $exit=Bootstrap-Ci
    $upgraded=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    $selected=Read-AgentVJson -Path $paths.Selection -Secret
    Assert-Ci ($exit -eq 0 -and $selected.version -ceq $upgradeVersion -and $upgraded.settings.ACORNOPS_AGENT_KEY -ceq $replaced.settings.ACORNOPS_AGENT_KEY -and (State-Ci).exchanges -eq 3) 'Runtime upgrade selects a new immutable version without reenrollment'
    Assert-Ci ((Test-Path (Join-Path $paths.Releases $version)) -and (Test-Path (Join-Path $paths.Releases $upgradeVersion))) 'Successful upgrade retains the previous immutable runtime'
    $evidence.stage='upgrade-failure-after-selection'
    $workingBootstrap=$bootstrap;$failedVersion=$version+'-failed'
    $bootstrap=Variant-Ci -Version $failedVersion -FailAfterStart
    $before=(State-Ci).exchanges
    Json-Ci $controls @{}
    $installer=Start-CiInstallerProcess -Name 'failed-upgrade' -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$bootstrap,'-ReleaseBaseUrl',($url+'/releases'),'-PlatformUrl',$url,'-TargetId','windows-installer-ci','-NodePath',$node,'-AdditionalCaBundleFile',$ca)
    Wait-Ci {(JournalPhase-Ci) -eq 'started-candidate' -or $installer.HasExited} 180
    $failedJournal=Read-CiJson $paths.Journal
    $failedService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    Assert-Ci (-not $installer.HasExited -and $failedJournal.candidate.version -ceq $failedVersion -and $failedJournal.selected -ceq 'candidate' -and $failedService.PathName.Contains('\'+$failedVersion+'\')) 'The intentionally failing runtime is actually selected and started after the doctor gate'
    $finished=$installer.WaitForExit(240000)
    $evidence.failedUpgradeOutcome=@{finished=$finished;hasExited=$installer.HasExited;exitCode=$(if($finished){$installer.ExitCode}else{$null})}
    Assert-Ci ($finished -and $installer.ExitCode -eq 0) 'Upgrade failure after selection completes authenticated repair rollback'
    $restored=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    $restoredSelection=Read-AgentVJson -Path $paths.Selection -Secret
    Assert-Ci ($restoredSelection.version -ceq $upgradeVersion -and $restored.settings.ACORNOPS_AGENT_KEY -ceq $upgraded.settings.ACORNOPS_AGENT_KEY -and (State-Ci).exchanges -eq $before -and (State-Ci).activeConnected -and -not(Test-Path $paths.Journal)) 'Failed upgrade restores the prior runtime and credential with fresh authentication and no exchange'
    $bootstrap=$workingBootstrap
    $evidence.stage='lost-rollback-response'
    Json-Ci $controls @{rejectPending=$true;loseRollbackResponse=$true}
    $before=(State-Ci).exchanges
    $exit=Bootstrap-Ci -Token (Token-Ci) -Replace
    $rolledBack=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($exit -eq 0 -and $rolledBack.settings.ACORNOPS_AGENT_KEY -ceq $upgraded.settings.ACORNOPS_AGENT_KEY -and (State-Ci).activeConnected -and (State-Ci).exchanges -eq ($before+1) -and (State-Ci).rollbacks -eq 1 -and -not(Test-Path $paths.Journal)) 'Lost rollback response restores the previous credential only after authenticated cancellation and fresh local connection'
    $evidence.stage='interrupted-verification'
    Json-Ci $controls @{rejectPending=$true}
    $installer=Start-CiInstallerProcess -Name 'interrupted-verification' -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$bootstrap,'-ReleaseBaseUrl',($url+'/releases'),'-PlatformUrl',$url,'-TargetId','windows-installer-ci','-NodePath',$node,'-AdditionalCaBundleFile',$ca,'-EnrollmentToken',(Token-Ci),'-ReplaceCredential')
    Wait-Ci {(JournalPhase-Ci) -eq 'started-candidate' -or $installer.HasExited} 180
    Assert-Ci (-not $installer.HasExited -and (JournalPhase-Ci) -eq 'started-candidate') 'Installer reaches candidate startup while verification remains unavailable'
    $installer.Kill();$installer.WaitForExit(5000)|Out-Null
    ScheduledTasks\Disable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
    Json-Ci $controls @{}
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher
    $verified=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($LASTEXITCODE -eq 0 -and $verified.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 3 -and -not(Test-Path $paths.Journal)) 'Recovery after interrupted verification authenticates and finalizes the candidate without repeating enrollment'
    ScheduledTasks\Enable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
    $evidence.stage='interrupted-commit'
    Json-Ci $controls @{holdCommit=$true}
    $installer=Start-CiInstallerProcess -Name 'interrupted-installer' -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$bootstrap,'-ReleaseBaseUrl',($url+'/releases'),'-PlatformUrl',$url,'-TargetId','windows-installer-ci','-NodePath',$node,'-AdditionalCaBundleFile',$ca,'-EnrollmentToken',(Token-Ci),'-ReplaceCredential')
    Wait-Ci {(JournalPhase-Ci) -eq 'commit-intent' -or $installer.HasExited} 180
    Assert-Ci (-not $installer.HasExited -and (JournalPhase-Ci) -eq 'commit-intent') 'Installer reaches durable commit intent before response'
    $ownedExchanges=(State-Ci).exchanges
    $ownedJournal=(Get-FileHash $paths.Journal -Algorithm SHA256).Hash
    $duplicateExit=Bootstrap-Ci -Token (Token-Ci) -Replace
    Assert-Ci ($duplicateExit -ne 0 -and (State-Ci).exchanges -eq $ownedExchanges -and (Get-FileHash $paths.Journal -Algorithm SHA256).Hash -ceq $ownedJournal) 'A duplicate installer cannot mutate the active owner journal or exchange another token'
    $installer.Kill();$installer.WaitForExit(5000)|Out-Null
    Assert-Ci ((Test-Path $paths.Marker) -and (Test-Path $paths.Journal)) 'Terminating the installer retains recoverable protected authority'
    # Control this CI scenario's task trigger while testing two process interruptions.
    ScheduledTasks\Disable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
    $hostService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    Assert-Ci ($hostService.ProcessId -gt 0 -and $hostService.PathName.StartsWith('"'+$paths.Releases+'\')) 'Crash probe selects only the installed owned service process'
    $descendants=@(CimCmdlets\Get-CimInstance Win32_Process -Filter ("ParentProcessId="+$hostService.ProcessId)|Select-Object -ExpandProperty ProcessId)
    Stop-Process -Id $hostService.ProcessId -Force
    Wait-Ci {(Get-Service AcornOpsAgentV).Status -eq 'Stopped'}
    # Transactional ownership has already suppressed actions; restore only the exact
    # qualified policy here to create a real queued crash before recovery entry.
    Invoke-CiSc -Arguments @('failure','AcornOpsAgentV','reset=','86400','actions=','restart/10000/restart/30000/restart/60000')
    Invoke-CiSc -Arguments @('failureflag','AcornOpsAgentV','0')
    Start-Service AcornOpsAgentV
    Wait-Ci {(CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'").ProcessId -gt 0}
    $hostService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    Stop-Process -Id $hostService.ProcessId -Force
    Wait-Ci {(Get-Service AcornOpsAgentV).Status -eq 'Stopped'}
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    $recoveryArgs=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$launcher)
    $recovery=Start-CiInstallerProcess -Name 'interrupted-drain' -Arguments $recoveryArgs
    Wait-Ci {(JournalPhase-Ci) -eq 'restart-drain' -or $recovery.HasExited}
    Assert-Ci (-not $recovery.HasExited) 'Recovery enters disabled queued-restart drain after a historical host crash'
    Start-Sleep -Seconds 12
    $during=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    Assert-Ci ($during.State -eq 'Stopped' -and $during.StartMode -eq 'Disabled' -and $during.ProcessId -eq 0) 'Queued ten-second SCM restart cannot run during disabled drain'
    $recovery.Kill();$recovery.WaitForExit(5000)|Out-Null
    Json-Ci $controls @{loseCommitResponse=$true}
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $reentry=Start-CiInstallerProcess -Name 'reentry' -Arguments $recoveryArgs
    Assert-Ci ($reentry.WaitForExit(180000)) 'Fixed launcher recovery completes after process interruption'
    $evidence.reentryOutcome=@{hasExited=$reentry.HasExited;exitCode=$reentry.ExitCode;elapsedMs=$clock.ElapsedMilliseconds}
    Assert-Ci ($reentry.ExitCode -eq 0 -and $clock.Elapsed.TotalSeconds -ge 65) 'Recovery reentry repeats the full monotonic drain before starting selection'
    $recovered=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($recovered.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 4 -and -not(Test-Path $paths.Journal)) 'Interrupted commit recovery finalizes exactly the authenticated candidate generation'
    Assert-Ci (@($descendants|Where-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue}).Count -eq 0) 'Owned host crash leaves no previously contained Node process'
    ScheduledTasks\Enable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
    $evidence.stage='uninstall'
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Uninstall
    Assert-Ci ($LASTEXITCODE -eq 0) 'Installed protected launcher supports owned uninstall'
    Assert-Ci ($null -eq (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -and $null -eq (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)) 'Uninstall removes owned SCM and recovery registrations'
    Assert-Ci ((Test-Path $paths.Config) -and (State-Ci).rollbacks -eq 1) 'Uninstall retains durable config without revoking credentials'
    $evidence.stage='conflicting-service-refusal'
    $foreignImage='"'+(Join-Path $paths.Releases ($upgradeVersion+'\AgentV.ServiceHost.exe'))+'" --node "'+$node+'"'
    Invoke-CiSc -Arguments @('create','AcornOpsAgentV','binPath=',$foreignImage,'start=','disabled','obj=','NT AUTHORITY\LocalService')
    Assert-Ci $true 'Disposable conflicting service fixture created'
    try {
        Invoke-CiSc -Arguments @('description','AcornOpsAgentV','Unrelated disposable CI service')
        $before=(State-Ci).exchanges
        $exit=Bootstrap-Ci
        $conflicting=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
        Assert-Ci ($exit -ne 0 -and $conflicting.Description -ceq 'Unrelated disposable CI service' -and $conflicting.StartMode -eq 'Disabled' -and (State-Ci).exchanges -eq $before) 'Retained-config repair refuses a conflicting service without modification or exchange'
    } finally {Invoke-CiSc -Arguments @('delete','AcornOpsAgentV')}
    $evidence.stage='retained-config-reinstall'
    $before=(State-Ci).exchanges
    $exit=Bootstrap-Ci
    Assert-Ci ($exit -eq 0) 'No-token reinstall recreates absent SCM and task from trusted retained configuration'
    $retained=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($retained.settings.ACORNOPS_AGENT_KEY -ceq $recovered.settings.ACORNOPS_AGENT_KEY -and $retained.settings.ACORNOPS_TARGET_ID -ceq 'windows-installer-ci' -and $retained.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca -and (State-Ci).exchanges -eq $before -and (State-Ci).activeConnected) 'Retained-config reinstall preserves key target and CA and freshly authenticates without reenrollment'
    $acl=Get-Acl $paths.Config
    $readers=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'}|ForEach-Object {$_.IdentityReference.Value})
    Assert-Ci ($readers -contains (Get-AgentVServiceSid) -and $readers -notcontains 'S-1-5-19' -and $readers -notcontains 'S-1-5-32-545') 'Recreated service retains unique SID credential permissions'
    $evidence.stage='complete'
} catch {
    $evidence.failure=[ordered]@{type=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult;file=[IO.Path]::GetFileName($_.InvocationInfo.ScriptName);line=$_.InvocationInfo.ScriptLineNumber}
    throw
} finally {
    $artifact=Join-Path $repo 'artifacts\windows-installer';$null=New-Item -ItemType Directory -Path $artifact -Force
    if($owned -and (Test-Path $paths.Journal)){try{$j=Get-Content $paths.Journal -Raw|ConvertFrom-Json;$evidence.recovery=@{phase=$j.phase;intent=$j.intent;selected=$j.selected;attempts=$j.attempts}}catch{}}
    if($owned){$svc=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'";if($null -ne $svc){$evidence.service=@{state=$svc.State;exitCode=$svc.ExitCode;serviceExitCode=$svc.ServiceSpecificExitCode}}}
    $hostLog=Join-Path $paths.Logs 'host.log'
    if($owned -and (Test-Path -LiteralPath $hostLog)){ $evidence.hostDiagnostics=@(Get-Content -LiteralPath $hostLog -Tail 32 | Where-Object { $_ -match '^Service startup failed stage=[a-z-]{1,32} hresult=-?[0-9]{1,12} native=-?[0-9]{1,12} trust=[0-9]{1,2} depth=-?[0-9]{1,3} rights=-?[0-9]{1,12} propagation=[0-9]{1,2} principal=[0-9]{1,2}$' }) }
    if($owned -and $evidence.Contains('failure')) {
        $task=ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue
        if($null -ne $task) {
            $info=ScheduledTasks\Get-ScheduledTaskInfo -TaskName AcornOpsAgentVRecovery
            $evidence.taskAtFailure=@{state=[string]$task.State;lastResult=[long]$info.LastTaskResult}
        }
    }
    Json-Ci (Join-Path $artifact 'native-evidence.json') $evidence
    if($owned){
        foreach($process in $script:CiProcesses){if(-not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null};$process.Dispose()}
        ScheduledTasks\Stop-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue
        ScheduledTasks\Unregister-ScheduledTask -TaskName AcornOpsAgentVRecovery -Confirm:$false -ErrorAction SilentlyContinue
        if(Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue){& $sc config AcornOpsAgentV start= disabled|Out-Null;& $sc failure AcornOpsAgentV reset= 0 actions= '""'|Out-Null;Stop-Service AcornOpsAgentV -ErrorAction SilentlyContinue;& $sc delete AcornOpsAgentV|Out-Null}
        if($null -ne $server -and -not $server.HasExited){$server.Kill();$server.WaitForExit(5000)|Out-Null}
        foreach($path in @($programParent,$dataParent,$staging,$work,$nodeRoot)){if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}
    }
    if($null -ne $certificate){Remove-Item -LiteralPath ('Cert:\LocalMachine\My\'+$certificate.Thumbprint) -Force}
}
