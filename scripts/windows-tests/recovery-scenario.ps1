# Dot-sourced only by the authorized disposable installation fixture.
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Disposable hosted CI required.'}
    $upgradeVersion=$version;$upgraded=$config
    $evidence.stage='upgrade-failure-after-selection'
    $workingBootstrap=$bootstrap;$failedVersion=$version+'-failed'
    $script:bootstrap=Variant-Ci -Version $failedVersion -FailAfterStart
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
    $script:bootstrap=$workingBootstrap
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
    Assert-Ci ($LASTEXITCODE -eq 0 -and $verified.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 2 -and -not(Test-Path $paths.Journal)) 'Recovery after interrupted verification authenticates and finalizes the candidate without repeating enrollment'
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
    Assert-Ci ($recovered.settings.ACORNOPS_AGENT_KEY -ceq (State-Ci).activeKey -and (State-Ci).commits -eq 3 -and -not(Test-Path $paths.Journal)) 'Interrupted commit recovery finalizes exactly the authenticated candidate generation'
    Assert-Ci (@($descendants|Where-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue}).Count -eq 0) 'Owned host crash leaves no previously contained Node process'
    ScheduledTasks\Enable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
