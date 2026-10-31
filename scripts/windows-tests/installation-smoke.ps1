[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Explicit disposable hosted-CI authorization is required.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'packaging\windows\Paths.psm1')
$paths=Get-AgentVPaths
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AgentV-Installer-CI'
$nodeRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AgentV-Installer-CI-Node'
$staging=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AcornOpsAgentV-Staging'
$programParent=Split-Path $paths.Program -Parent; $dataParent=Split-Path $paths.Root -Parent
$ps=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$sc=Join-Path ([Environment]::SystemDirectory) 'sc.exe'
$certificate=$null; $server=$null; $owned=$false
$evidence=[ordered]@{sourceRevision=(& git -C $repo rev-parse HEAD);node=(& node --version);os=[Environment]::OSVersion.VersionString;tests=@();stage='preflight'}
function Assert-Ci([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:evidence.tests+=$Message}
function Wait-Ci([scriptblock]$Condition,[int]$Seconds=30){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not (& $Condition)){if($clock.Elapsed.TotalSeconds -gt $Seconds){throw 'Installer CI condition deadline exceeded.'};Start-Sleep -Milliseconds 200}}
function Json-Ci([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 12 -Compress),[Text.UTF8Encoding]::new($false))}
function State-Ci {return Get-Content (Join-Path $work 'server-state.json') -Raw|ConvertFrom-Json}
function Token-Ci {return 'aev_'+[Guid]::NewGuid().ToString()+'_'+('s'*43)}
function Bootstrap-Ci([string]$Token,[switch]$Replace,[switch]$OmitCa){
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$script:bootstrap,'-ReleaseBaseUrl',($script:url+'/releases'),'-PlatformUrl',$script:url,'-TargetId','windows-installer-ci','-NodePath',$script:node)
    if($Token){$arguments+=@('-EnrollmentToken',$Token)};if($Replace){$arguments+='-ReplaceCredential'}
    if(-not $OmitCa){$arguments+=@('-AdditionalCaBundleFile',$script:ca)}
    & $ps @arguments | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}
try {
    foreach($path in @($work,$nodeRoot,$staging,$programParent,$dataParent)){if(Test-Path -LiteralPath $path){throw 'Refusing a preexisting CI resource.'}}
    if((Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -or (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)){throw 'Refusing preexisting service/task.'}
    New-AgentVProtectedDirectory $work; New-AgentVProtectedDirectory $nodeRoot; $owned=$true
    $node=Join-Path $nodeRoot 'node.exe'; Copy-Item -LiteralPath (Get-Command node).Source -Destination $node
    Set-AgentVAcl $nodeRoot 'S-1-5-32-545';Set-AgentVAcl $node 'S-1-5-32-545'
    $certificate=New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\LocalMachine\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter ((Get-Date).AddDays(2))
    $password=[Guid]::NewGuid().ToString('N');$pfx=Join-Path $work 'fixture.pfx'
    $null=Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password (ConvertTo-SecureString $password -AsPlainText -Force)
    $ca=Join-Path $nodeRoot 'fixture-ca.pem'
    [IO.File]::WriteAllText($ca,"-----BEGIN CERTIFICATE-----`n"+[Convert]::ToBase64String($certificate.RawData,[Base64FormattingOptions]::InsertLineBreaks)+"`n-----END CERTIFICATE-----`n",[Text.Encoding]::ASCII)
    Set-AgentVAcl $ca 'S-1-5-32-545'
    $version=(Get-Content (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json).version
    $releases=Join-Path $work 'releases';$assets=Join-Path $releases ('v'+$version)
    $null=New-Item -ItemType Directory -Path $assets -Force
    $evidence.stage='archive-build'
    & (Join-Path $repo 'scripts\build-windows-archive.ps1') -OutputDirectory $assets
    $bootstrap=Join-Path $assets 'install-agentv.ps1'
    $controls=Join-Path $work 'controls.json';Json-Ci $controls @{}
    $listening=Join-Path $work 'listening.json';$options=Join-Path $work 'server-options.json'
    Json-Ci $options @{allowDisposableCi=$true;pfx=$pfx;passphrase=$password;controls=$controls;state=(Join-Path $work 'server-state.json');listening=$listening;releases=$releases;targetId='windows-installer-ci'}
    $server=Start-Process -FilePath $node -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'installation-server.mjs')+'"'),('"'+$options+'"')) -PassThru -RedirectStandardOutput (Join-Path $work 'server.stdout') -RedirectStandardError (Join-Path $work 'server.stderr')
    Wait-Ci {Test-Path -LiteralPath $listening}
    $url='https://localhost:'+((Get-Content $listening -Raw|ConvertFrom-Json).port)
    $evidence.stage='fresh-install'
    $exit=Bootstrap-Ci -Token (Token-Ci)
    Assert-Ci ($exit -eq 0) 'Pinned bootstrap installs through the real SCM host'
    $state=State-Ci
    Assert-Ci ($state.exchanges -eq 1 -and $state.commits -eq 1 -and $state.activeConnected) 'Fresh enrollment commits only after provisional and active authentication'
    Assert-Ci ((Get-Service AcornOpsAgentV).Status -eq 'Running') 'Installed service runs after finalization'
    Assert-Ci (-not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker)) 'Finalization removes protected transaction state'
    $config=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid);$key=$config.settings.ACORNOPS_AGENT_KEY
    Assert-Ci ($config.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca) 'Initial trusted CA selection is persisted'
    $evidence.stage='repair'
    # Bootstrap TLS still needs CA to download; the worker repair deliberately omits it.
    $worker=Join-Path $paths.Releases ($version+'\windows\install-worker.ps1')
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $worker -Version $version -PlatformUrl $url -TargetId windows-installer-ci -NodePath $node
    Assert-Ci ($LASTEXITCODE -eq 0) 'Repair reconnects through the owned service'
    $repaired=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($repaired.settings.ACORNOPS_AGENT_KEY -ceq $key -and $repaired.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca -and (State-Ci).exchanges -eq 1) 'Repair preserves credential and CA without another exchange'
    $evidence.stage='lost-commit-replacement'
    Json-Ci $controls @{loseCommitResponse=$true}
    $exit=Bootstrap-Ci -Token (Token-Ci) -Replace
    Assert-Ci ($exit -eq 0) 'Lost replacement commit response resolves using authenticated status'
    $replaced=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($replaced.settings.ACORNOPS_AGENT_KEY -cne $key -and $replaced.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 2) 'Replacement retains the committed candidate generation'
    $evidence.stage='uninstall'
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Uninstall
    Assert-Ci ($LASTEXITCODE -eq 0) 'Installed protected launcher supports owned uninstall'
    Assert-Ci ($null -eq (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -and $null -eq (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)) 'Uninstall removes owned SCM and recovery registrations'
    Assert-Ci ((Test-Path $paths.Config) -and (State-Ci).rollbacks -eq 0) 'Uninstall retains durable config without revoking credentials'
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
            # Diagnostic ceiling only. Preserve the original failed assertion and
            # let the actual SYSTEM task finish before owned-resource cleanup.
            $diagnosticClock=[Diagnostics.Stopwatch]::StartNew()
            while($task.State -eq 'Running' -and $diagnosticClock.Elapsed.TotalSeconds -lt 60){Start-Sleep -Milliseconds 250;$task=ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery}
            $info=ScheduledTasks\Get-ScheduledTaskInfo -TaskName AcornOpsAgentVRecovery
            $evidence.taskAfterDiagnostic=@{state=[string]$task.State;lastResult=[long]$info.LastTaskResult;waitMs=$diagnosticClock.ElapsedMilliseconds}
        }
        $timingPath=Join-Path $paths.Maintenance 'launcher-timing.json'
        if(Test-Path -LiteralPath $timingPath){
            try {
                $timing=Read-AgentVJson -Path $timingPath -Limit 2048 -Secret
                if($null -ne $task -and [DateTimeOffset]::Parse($timing.startedAt).UtcDateTime -ge $info.LastRunTime.ToUniversalTime().AddSeconds(-2) -and $timing.schema -ceq 'acornops.agentv-recovery-timing.v1' -and $timing.stage -in @('bootstrap','release-tree','package','worker','finished')){
                    $safe=@{stage=$timing.stage;workerSucceeded=($timing.workerSucceeded -eq $true)}
                    foreach($name in @('bootstrapMs','treeMs','packageMs','workerMs','totalMs')){if($timing.$name -isnot [ValueType] -or $timing.$name -lt 0 -or $timing.$name -gt 900000){throw 'Invalid diagnostic duration'};$safe[$name]=[long]$timing.$name}
                    $evidence.launcherTiming=$safe
                }
            }catch{}
        }
    }
    Json-Ci (Join-Path $artifact 'native-evidence.json') $evidence
    if($owned){
        ScheduledTasks\Unregister-ScheduledTask -TaskName AcornOpsAgentVRecovery -Confirm:$false -ErrorAction SilentlyContinue
        if(Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue){& $sc config AcornOpsAgentV start= disabled|Out-Null;& $sc failure AcornOpsAgentV reset= 0 actions= '""'|Out-Null;Stop-Service AcornOpsAgentV -ErrorAction SilentlyContinue;& $sc delete AcornOpsAgentV|Out-Null}
        if($null -ne $server -and -not $server.HasExited){$server.Kill();$server.WaitForExit(5000)|Out-Null}
        foreach($path in @($programParent,$dataParent,$staging,$work,$nodeRoot)){if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}
    }
    if($null -ne $certificate){Remove-Item -LiteralPath ('Cert:\LocalMachine\My\'+$certificate.Thumbprint) -Force}
}
