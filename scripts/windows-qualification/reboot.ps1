[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('prepare','verify')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [string]$NodePath
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'packaging\windows\Paths.psm1')
$installation=Import-Module (Join-Path $repo 'packaging\windows\Installation.psm1') -PassThru
$paths=Get-AgentVPaths
$lock=$null;$reportWritten=$false;$stage='preflight';$reportPath=$null
function Get-EvidenceHash([string]$Value) {
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
try {
    & $installation { Assert-AgentVAdministrator }
    $EvidenceDirectory=[IO.Path]::GetFullPath($EvidenceDirectory).TrimEnd('\')
    foreach ($root in @($paths.Root,$paths.Program)) {
        if ($EvidenceDirectory.Equals($root,[StringComparison]::OrdinalIgnoreCase) -or $EvidenceDirectory.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($EvidenceDirectory+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must be separate from installation state.' }
    }
    New-AgentVProtectedDirectory $EvidenceDirectory
    Assert-AgentVTrustedPath -Path $EvidenceDirectory -Secret
    $lock=Enter-AgentVLock (Join-Path $EvidenceDirectory 'qualification.lock')
    $reportPath=Join-Path $EvidenceDirectory 'report.json'
    $checkpoint=Join-Path $EvidenceDirectory 'checkpoint.json'
    if ($Mode -eq 'prepare' -and (Test-Path -LiteralPath $checkpoint)) { throw 'Use a new evidence directory for another qualification attempt.' }
    $before=$null
    if ($Mode -eq 'verify') { $before=Read-AgentVJson -Path $checkpoint -Limit 16384 -Secret }
    $stage='installation'
    $sid=Get-AgentVServiceSid
    $owner=Read-AgentVJson -Path $paths.Owner -Secret
    $selection=Read-AgentVJson -Path $paths.Selection -Secret
    if ($owner.schema -cne 'acornops.agentv-windows-owner.v1' -or $selection.ownerId -cne $owner.id) { throw 'Installation ownership is inconsistent.' }
    $service=& $installation { param($Id) Assert-AgentVOwnedService -OwnerId $Id } -Id $owner.id
    if ($null -eq $service) { throw 'Installed service is absent.' }
    $expectedImage=& $installation { param($Selection) Get-AgentVImage $Selection } -Selection $selection
    if ($service.PathName -cne $expectedImage) { throw 'SCM selection differs from the protected selection.' }
    if (-not $NodePath) { $NodePath=$selection.node }
    if ($NodePath -cne $selection.node) { throw 'The evaluator must use the trusted installed Node executable.' }
    $manifestPath=Join-Path $paths.Releases ($selection.version+'\package-manifest.json')
    $manifest=Read-AgentVJson -Path $manifestPath -Limit 4194304
    $manifestHash=(Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -cne $selection.manifestSha256) { throw 'Selected package manifest changed.' }
    $config=Read-AgentVJson -Path $paths.Config -Secret -ServiceReadSid $sid
    & $installation { param($Config) Assert-AgentVConfig -Config $Config -TargetId $Config.settings.ACORNOPS_TARGET_ID -PlatformUrl $Config.settings.ACORNOPS_AGENT_PLATFORM_URL } -Config $config
    $configHash=(Get-FileHash $paths.Config -Algorithm SHA256).Hash.ToLowerInvariant()
    $stage='observation'
    Assert-AgentVTrustedPath -Path $paths.State -ServiceWriteSid $sid
    $proof=@{}
    foreach ($name in @('launch','authenticated')) {
        $path=Join-Path $paths.State ($name+'.json')
        $item=Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid service evidence path.' }
        $proof[$name]=& $installation { param($Path) Read-AgentVBoundedEvidence -Path $Path } -Path $path
    }
    $os=CimCmdlets\Get-CimInstance Win32_OperatingSystem
    $machine=[Microsoft.Win32.Registry]::GetValue('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography','MachineGuid',$null)
    if ($machine -isnot [string] -or -not $machine) { throw 'Machine identity is unavailable.' }
    $launch=$proof.launch;$auth=$proof.authenticated
    $current=[ordered]@{
        schema='acornops.agentv-reboot-observation.v1';observedAt=[DateTimeOffset]::UtcNow.ToString('o')
        machineId=(Get-EvidenceHash $machine);bootAt=([DateTimeOffset]$os.LastBootUpTime).ToUniversalTime().ToString('o')
        ownerId=$owner.id;version=$selection.version;sourceRevision=$manifest.sourceRevision
        packageSha256=$manifestHash;configSha256=$configHash;nodeSha256=(Get-FileHash $NodePath -Algorithm SHA256).Hash.ToLowerInvariant()
        service=@{state=$service.State;startMode=$service.StartMode;startName=$service.StartName;imageSha256=(Get-EvidenceHash $service.PathName)}
        settled=(-not(Test-Path $paths.Journal) -and -not(Test-Path $paths.Marker))
        launch=@{launchId=$launch.launchId;configSha256=$launch.configSha256}
        authentication=@{version=$auth.version;authenticated=$auth.authenticated;phase=$auth.phase;launchId=$auth.launchId;configSha256=$auth.configSha256;authenticatedAt=$auth.authenticatedAt}
    }
    # Refuse a snapshot that crossed an installation or service change.
    $latest=Read-AgentVJson -Path $paths.Selection -Secret
    $latestService=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
    if (($latest|ConvertTo-Json -Compress) -cne ($selection|ConvertTo-Json -Compress) -or (Get-FileHash $paths.Config -Algorithm SHA256).Hash.ToLowerInvariant() -cne $configHash -or $null -eq $latestService -or $latestService.ProcessId -ne $service.ProcessId -or $latestService.State -cne $service.State) { throw 'Installation changed during observation.' }
    $stage='evaluation'
    $json=@{mode=$Mode;current=$current;before=$before}|ConvertTo-Json -Depth 6 -Compress
    $output=$json | & $NodePath (Join-Path $PSScriptRoot 'reboot-evidence.mjs')
    $code=$LASTEXITCODE
    $report=$output|ConvertFrom-Json
    Write-AgentVDurableJson -Path $reportPath -Value $report
    $reportWritten=$true
    if ($code -ne 0 -or $report.status -notin @('prepared','observed-reboot-pass')) { throw 'Reboot evidence checks failed.' }
    if ($Mode -eq 'prepare') { Write-AgentVDurableJson -Path $checkpoint -Value $current }
    Write-Output ($report|ConvertTo-Json -Depth 5 -Compress)
} catch {
    if ($reportPath -and $lock -and -not $reportWritten) {
        Write-AgentVDurableJson -Path $reportPath -Value @{schema='acornops.agentv-reboot-report.v1';status='failed';checks=@(@{id=$stage;passed=$false})}
    }
    throw ('Windows reboot qualification did not pass; stage='+$stage+'. No installation changes were requested.')
} finally { if ($null -ne $lock) { $lock.Dispose() } }
