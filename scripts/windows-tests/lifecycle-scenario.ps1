# Dot-sourced only by the authorized disposable installation fixture.
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Disposable hosted CI required.'}
    $evidence.stage='repair'
    # Bootstrap TLS still needs CA to download; the worker repair deliberately omits it.
    $worker=Join-Path $paths.Releases ($version+'\windows\install-worker.ps1')
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $worker -Version $version -PlatformUrl $url -TargetId windows-installer-ci -NodePath $node
    Assert-Ci ($LASTEXITCODE -eq 0) 'Repair reconnects through the owned service'
    $repaired=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    Assert-Ci ($repaired.settings.ACORNOPS_AGENT_KEY -ceq $key -and $repaired.settings.ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE -ceq $ca -and (State-Ci).exchanges -eq 1) 'Repair preserves credential and CA without another exchange'
    $evidence.stage='invalid-upgrade-manifest'
    $firstBootstrap=$bootstrap
    $script:bootstrap=Variant-Ci -Version ($version+'-invalid') -CorruptManifest
    $exit=Bootstrap-Ci
    Assert-Ci ($exit -ne 0 -and (State-Ci).exchanges -eq 1 -and (Get-Service AcornOpsAgentV).Status -eq 'Running' -and (Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)).settings.ACORNOPS_AGENT_KEY -ceq $key) 'Invalid candidate package leaves prior service and credential intact'
    $script:bootstrap=$firstBootstrap
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
    $script:bootstrap=Variant-Ci -Version $upgradeVersion
    $exit=Bootstrap-Ci
    $upgraded=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid (Get-AgentVServiceSid)
    $selected=Read-AgentVJson -Path $paths.Selection -Secret
    Assert-Ci ($exit -eq 0 -and $selected.version -ceq $upgradeVersion -and $upgraded.settings.ACORNOPS_AGENT_KEY -ceq $replaced.settings.ACORNOPS_AGENT_KEY -and (State-Ci).exchanges -eq 3) 'Runtime upgrade selects a new immutable version without reenrollment'
    Assert-Ci ((Test-Path (Join-Path $paths.Releases $version)) -and (Test-Path (Join-Path $paths.Releases $upgradeVersion))) 'Successful upgrade retains the previous immutable runtime'
    $recovered=$upgraded
    $evidence.stage='uninstall'
    $launcher=Join-Path $paths.Maintenance 'recover.ps1'
    & $ps -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Uninstall
    Assert-Ci ($LASTEXITCODE -eq 0) 'Installed protected launcher supports owned uninstall'
    Assert-Ci ($null -eq (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -and $null -eq (ScheduledTasks\Get-ScheduledTask -TaskName AcornOpsAgentVRecovery -ErrorAction SilentlyContinue)) 'Uninstall removes owned SCM and recovery registrations'
    Assert-Ci ((Test-Path $paths.Config) -and (State-Ci).rollbacks -eq 0) 'Uninstall retains durable config without revoking credentials'
    $evidence.stage='conflicting-service-refusal'
    $foreignImage='"'+(Join-Path $paths.Releases ($upgradeVersion+'\AgentV.ServiceHost.exe'))+'" --node "'+$node+'"'
    Invoke-CiSc -Arguments @('create','AcornOpsAgentV','binPath=',$foreignImage,'start=','disabled','obj=','NT AUTHORITY\LocalService')
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
