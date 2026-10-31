# Called only by the explicitly authorized disposable installation fixture.
# All services, credentials and HTTPS responses belong to that fresh CI run.
function Invoke-CiAcceptance {
    $script:evidence.stage='rollback-denied'
    Json-Ci $controls @{rejectActive=$true;denyRollback=$true}
    $before=(State-Ci).exchanges
    $exit=Bootstrap-Ci -Token (Token-Ci) -Replace
    $journal=Read-CiJson $paths.Journal
    Assert-Ci ($exit -ne 0 -and $journal.intent -ceq 'rollback-denied' -and (State-Ci).commits -eq 2 -and (State-Ci).rollbacks -eq 0) 'Actual failed post-commit authentication and denied rollback retain the committed candidate'
    $candidateKey=$journal.candidate.config.settings.ACORNOPS_AGENT_KEY
    $transactionId=$journal.transaction.id
    ScheduledTasks\Disable-ScheduledTask -TaskName AcornOpsAgentVRecovery|Out-Null
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    $recoveryArguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$launcher)
    $script:evidence.stage='acceptance-identity-rejection'
    $owner=Read-AgentVJson -Path $paths.Owner -Secret
    $wrongTarget=$journal|ConvertTo-Json -Depth 16|ConvertFrom-Json
    $wrongTarget.targetId='different-ci-target'
    $rejected=$false
    try{& $script:CiInstallationModule {param($Journal,$Owner) Assert-AgentVJournal -Journal $Journal -Owner $Owner} -Journal $wrongTarget -Owner $owner}catch{$rejected=$true}
    Assert-Ci $rejected 'The production recovery validator refuses a journal target that differs from its candidate config'
    $wrongTransaction=$journal|ConvertTo-Json -Depth 16|ConvertFrom-Json
    $wrongTransaction.transaction.id=[Guid]::NewGuid().ToString()
    $status=& $script:CiInstallationModule {param($Journal) Get-AgentVRemoteStatus -Journal $Journal} -Journal $wrongTransaction
    Assert-Ci ($null -eq $status) 'The production status reader cannot authorize acceptance for a different transaction'
    $priorJournalHash=(Get-FileHash $paths.Journal -Algorithm SHA256).Hash
    & $ps @recoveryArguments -Automatic -AcceptCommittedCandidate
    Assert-Ci ($LASTEXITCODE -ne 0 -and (Get-FileHash $paths.Journal -Algorithm SHA256).Hash -ceq $priorJournalHash) 'Automatic invocation cannot supply explicit operator acceptance intent'
    $script:evidence.stage='default-denial-pending'
    Json-Ci $controls @{}
    & $ps @recoveryArguments
    Assert-Ci ($LASTEXITCODE -ne 0 -and (Read-CiJson $paths.Journal).intent -ceq 'rollback-denied' -and (Test-Path $paths.Marker)) 'Default recovery keeps rollback-denied state pending even when the candidate can authenticate'
    $currentHash=(Get-FileHash $paths.Config -Algorithm SHA256).Hash.ToLowerInvariant()
    Wait-Ci {& $script:CiInstallationModule {param($Hash) Test-AgentVReady -ConfigHash $Hash -Phase active} -Hash $currentHash}
    $wrongHash=& $script:CiInstallationModule {Test-AgentVReady -ConfigHash ('0'*64) -Phase active}
    Assert-Ci (-not $wrongHash) 'Fresh active readiness cannot authorize a different selected config hash'
    $script:evidence.stage='nonactive-acceptance-denied'
    Json-Ci $controls @{forceCredentialState='grace'}
    & $ps @recoveryArguments -AcceptCommittedCandidate
    Assert-Ci ($LASTEXITCODE -ne 0 -and (Read-CiJson $paths.Journal).intent -ceq 'rollback-denied' -and (State-Ci).rollbacks -eq 0) 'Explicit acceptance refuses a candidate whose authoritative generation is no longer active'
    $script:evidence.stage='unknown-status-pending'
    Json-Ci $controls @{statusUnavailable=$true}
    & $ps @recoveryArguments -AcceptCommittedCandidate
    $unknown=Read-CiJson $paths.Journal
    Assert-Ci ($LASTEXITCODE -ne 0 -and $unknown.intent -ceq 'rollback-denied' -and $unknown.transaction.id -ceq $transactionId -and (Test-Path $paths.Marker) -and (State-Ci).rollbacks -eq 0) 'Unavailable authoritative status keeps the exact candidate transaction pending without historical rollback'
    $script:evidence.stage='stale-acceptance-denied'
    Json-Ci $controls @{rejectActive=$true}
    $recovery=Start-CiInstallerProcess -Name 'stale-acceptance' -Arguments ($recoveryArguments+@('-AcceptCommittedCandidate'))
    Wait-Ci {(JournalPhase-Ci) -eq 'started-candidate' -or $recovery.HasExited} 100
    Assert-Ci (-not $recovery.HasExited) 'Manual acceptance starts a fresh candidate launch before considering local proof'
    $launch=Read-CiJson (Join-Path $paths.State 'launch.json')
    Stop-Service AcornOpsAgentV
    (Get-Service AcornOpsAgentV).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(25))
    $marker=Join-Path $paths.State 'authenticated.json'
    # This is intentionally stale, service-writable evidence, never journal authority.
    Json-Ci $marker @{version=1;authenticated=$true;phase='active';launchId=$launch.launchId;configSha256=$launch.configSha256;authenticatedAt=[DateTimeOffset]::UtcNow.AddMinutes(-10).ToString('o')}
    $ready=& $script:CiInstallationModule {param($Hash) Test-AgentVReady -ConfigHash $Hash -Phase active} -Hash $launch.configSha256
    Assert-Ci (-not $ready) 'The production readiness verifier rejects stale proof even with the current launch and config binding'
    Assert-Ci ($recovery.WaitForExit(120000) -and $recovery.ExitCode -ne 0 -and (Read-CiJson $paths.Journal).intent -ceq 'rollback-denied') 'Missing fresh active authentication cannot persist explicit acceptance intent'
    $script:evidence.stage='acceptance-intent-interruption'
    Json-Ci $controls @{holdAcceptanceRecheck=$true}
    $recovery=Start-CiInstallerProcess -Name 'interrupted-acceptance' -Arguments ($recoveryArguments+@('-AcceptCommittedCandidate'))
    Wait-Ci {(JournalPhase-Ci) -eq 'accept-committed-intent' -or $recovery.HasExited} 150
    Assert-Ci (-not $recovery.HasExited -and (Read-CiJson $paths.Journal).intent -ceq 'accept-committed') 'Explicit acceptance persists operator intent only after active local and remote proof'
    $recovery.Kill();$recovery.WaitForExit(5000)|Out-Null
    Assert-Ci ((Test-Path $paths.Marker) -and (Read-CiJson $paths.Journal).transaction.id -ceq $transactionId) 'Interrupted acceptance retains the exact protected transaction'
    $acceptedIntent=Read-CiJson $paths.Journal
    Json-Ci $controls @{}
    & $ps @recoveryArguments
    Assert-Ci ($LASTEXITCODE -eq 0 -and -not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker)) 'Recovery resumes persisted explicit intent with new proof and completes cleanup'
    $accepted=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($accepted.settings.ACORNOPS_AGENT_KEY -ceq $candidateKey -and (State-Ci).activeKey -ceq $candidateKey -and (State-Ci).activeConnected -and (State-Ci).exchanges -eq ($before+1) -and (State-Ci).rollbacks -eq 0) 'Explicit acceptance finalizes only the journal candidate without reenrollment or historical restoration'
    $script:evidence.stage='finalized-cleanup-boundary'
    # Reconstruct the exact durable state after finalization persisted and marker
    # removal, before journal deletion. This is a state characterization, not a
    # claimed process kill inside that narrow filesystem window.
    $acceptedIntent.terminal='candidate';$acceptedIntent.phase='finalized'
    Write-AgentVDurableJson -Path $paths.Journal -Value $acceptedIntent
    $beforePid=(CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'").ProcessId
    $beforeConfig=(Get-FileHash $paths.Config -Algorithm SHA256).Hash
    & $ps @recoveryArguments
    $afterPid=(CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'").ProcessId
    Assert-Ci ($LASTEXITCODE -eq 0 -and -not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker) -and $beforePid -eq $afterPid -and (Get-FileHash $paths.Config -Algorithm SHA256).Hash -ceq $beforeConfig) 'Finalized journal cleanup after marker removal does not stop or restart the authenticated service'

}
