# Native observations on the disposable installer fixture; this never reboots CI.
$probe=Join-Path $repo 'scripts\windows-qualification\reboot.ps1'
$qualification=Join-Path $work 'reboot-qualification'
$checkpoint=Join-Path $qualification 'checkpoint.json'
$beforeConfig=(Get-FileHash $paths.Config -Algorithm SHA256).Hash
$beforeSelection=(Get-FileHash $paths.Selection -Algorithm SHA256).Hash
& $probe -Mode prepare -EvidenceDirectory $qualification -NodePath $node
$prepared=Read-AgentVJson -Path (Join-Path $qualification 'report.json') -Secret
Assert-Ci ($prepared.status -ceq 'prepared') 'Native reboot probe prepares evidence without claiming a reboot'
$checkpointHash=(Get-FileHash $checkpoint -Algorithm SHA256).Hash
$rejected=$false;try { & $probe -Mode prepare -EvidenceDirectory $qualification -NodePath $node } catch { $rejected=$true }
Assert-Ci ($rejected -and (Get-FileHash $checkpoint -Algorithm SHA256).Hash -ceq $checkpointHash) 'Repeated preparation cannot overwrite the protected checkpoint'
$rejected=$false;try { & $probe -Mode verify -EvidenceDirectory $qualification -NodePath $node } catch { $rejected=$true }
$sameBoot=Read-AgentVJson -Path (Join-Path $qualification 'report.json') -Secret
Assert-Ci ($rejected -and $sameBoot.status -ceq 'failed' -and @($sameBoot.checks|Where-Object {$_.id -ceq 'later-boot' -and -not $_.passed}).Count -eq 1) 'Actual native observation rejects same-boot verification'
$script:evidence.rebootProbe=@{qualification='not-executed';fixture='native-same-boot';report=$sameBoot}
Stop-Service AcornOpsAgentV
(Get-Service AcornOpsAgentV).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(25))
try {
    $rejected=$false;try { & $probe -Mode verify -EvidenceDirectory $qualification -NodePath $node } catch { $rejected=$true }
    Assert-Ci $rejected 'Native reboot verification refuses a stopped service'
} finally { Start-Service AcornOpsAgentV }
Wait-Ci {(State-Ci).activeConnected}
Assert-Ci ((Get-FileHash $paths.Config -Algorithm SHA256).Hash -ceq $beforeConfig -and (Get-FileHash $paths.Selection -Algorithm SHA256).Hash -ceq $beforeSelection -and (Get-FileHash $checkpoint -Algorithm SHA256).Hash -ceq $checkpointHash) 'Qualification probes leave installation and checkpoint identity unchanged'
