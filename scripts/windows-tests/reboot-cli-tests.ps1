# Exercise the actual PowerShell5.1 -> Node stdin boundary with synthetic evidence.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$evaluator=Join-Path $PSScriptRoot '..\windows-qualification\reboot-evidence.mjs'
$id='11111111-1111-4111-8111-111111111111';$digest='a'*64
$current=@{
    schema='acornops.agentv-reboot-observation.v1';machineId=$digest;ownerId=$id
    bootAt='2026-11-01T00:00:00.000Z';observedAt='2026-11-01T00:05:00.000Z'
    version='0.0.1-experimental.14';sourceRevision=('b'*40);packageSha256=$digest;configSha256=$digest;nodeSha256=$digest;settled=$true
    service=@{state='Running';startMode='Auto';startName='NT AUTHORITY\LocalService';imageSha256=$digest}
    launch=@{launchId=$id;configSha256=$digest}
    authentication=@{version=1;launchId=$id;configSha256=$digest;authenticated=$true;phase='active';authenticatedAt='2026-11-01T00:01:00.000Z'}
}
foreach ($mode in @('prepare','verify')) {
    $inputJson=@{mode=$mode;current=$current;before=$current}|ConvertTo-Json -Depth 6 -Compress
    # Only synthetic input: retain the first three actual stdin bytes to establish
    # the native encoding boundary, without echoing observations or credentials.
    $prefix=$inputJson | & node.exe -e 'process.stdout.write(require(''node:fs'').readFileSync(0).subarray(0,3).toString(''hex''))'
    Write-Output ('Synthetic PowerShell stdin prefix='+$prefix)
    $output=$inputJson | & node.exe $evaluator
    $code=$LASTEXITCODE
    if (-not $output) { throw 'Native reboot evaluator CLI emitted no result.' }
    $report=$output|ConvertFrom-Json
    if ($mode -eq 'prepare' -and ($code -ne 0 -or $report.status -cne 'prepared')) { throw 'Native reboot evaluator CLI rejected synthetic preparation.' }
    if ($mode -eq 'verify' -and ($code -ne 1 -or $report.status -cne 'failed')) { throw 'Native reboot evaluator CLI accepted a synthetic same-boot run.' }
}
# Prevent the expected native rejection's exit code from marking this successful fixture failed.
$global:LASTEXITCODE=0
Write-Output 'Synthetic native reboot CLI preparation and same-boot rejection passed; no actual reboot qualified.'
