# Dot-sourced only by the authorized disposable installation fixture.
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Disposable hosted CI required.'}
$evidence.stage='synchronous-scm-repair-failure'
$previousKey=$config.settings.ACORNOPS_AGENT_KEY
$failedVersion=$version+'-scm-failed'
$script:bootstrap=Variant-Ci -Version $failedVersion -FailScmStart
$evidence.syntheticStartupHost=@{version=$failedVersion;sourceSha256=(Get-FileHash (Join-Path $PSScriptRoot 'FailStartHost.cs') -Algorithm SHA256).Hash.ToLowerInvariant();behavior='throws-before-child-start';releaseQualified=$false}
$before=(State-Ci).exchanges
$installer=Start-CiInstallerProcess -Name 'synchronous-start-repair' -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$bootstrap,'-ReleaseBaseUrl',($url+'/releases'),'-PlatformUrl',$url,'-TargetId','windows-installer-ci','-NodePath',$node,'-AdditionalCaBundleFile',$ca)
Wait-Ci {
    if($installer.HasExited){return $true}
    $selectedService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    return $selectedService.PathName.Contains('\'+$failedVersion+'\')
} 180
$selectedService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
Assert-Ci ($selectedService.PathName.Contains('\'+$failedVersion+'\')) 'Synthetic synchronous-start-rejection candidate is actually selected through SCM'
$finished=$installer.WaitForExit(240000)
$exit=if($finished){$installer.ExitCode}else{$null}
$failedService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
$evidence.synchronousStartOutcome=@{finished=$finished;processExit=$exit;serviceState=$failedService.State;serviceExitCode=$failedService.ExitCode;journalPhase=(JournalPhase-Ci)}
$after=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
$selection=Read-AgentVJson -Path $paths.Selection -Secret
Assert-Ci ($finished -and $null -ne $exit -and $exit -eq 0 -and $selection.version -ceq $version -and $after.settings.ACORNOPS_AGENT_KEY -ceq $previousKey -and (Get-Service AcornOpsAgentV).Status -eq 'Running' -and (State-Ci).activeConnected -and (State-Ci).exchanges -eq $before -and -not(Test-Path $paths.Journal)) 'Synchronous SCM startup failure restores the previous runtime and fresh authenticated credential without enrollment'
$evidence.stage='synchronous-scm-unknown-status'
Json-Ci $controls @{statusUnavailable=$true}
$exit=Bootstrap-Ci -Token (Token-Ci) -Replace
$pending=Read-CiJson $paths.Journal
Assert-Ci ($exit -ne 0 -and $pending.intent -ceq 'rollback' -and $pending.candidate.version -ceq $failedVersion -and $pending.selected -ceq 'candidate' -and (Test-Path $paths.Marker) -and (State-Ci).rollbacks -eq 0 -and (State-Ci).activeKey -ceq $previousKey) 'SCM startup failure with unavailable backend status stays pending and cannot restore a historical credential'
$evidence.stage='synchronous-scm-authorized-rollback'
Json-Ci $controls @{}
$launcher=Join-Path $paths.Maintenance 'recover.ps1'
& $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher
$after=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
$selection=Read-AgentVJson -Path $paths.Selection -Secret
Assert-Ci ($LASTEXITCODE -eq 0 -and $selection.version -ceq $version -and $after.settings.ACORNOPS_AGENT_KEY -ceq $previousKey -and (State-Ci).rollbacks -eq 1 -and (State-Ci).activeConnected -and -not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker)) 'After SCM startup rejection authenticated cancellation and fresh previous readiness permit restoration'
