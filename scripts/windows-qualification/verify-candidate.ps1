[CmdletBinding()]
param([string]$Directory=(Join-Path $PSScriptRoot '..\..\release\windows'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Candidate verification requires Windows.' }
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'packaging\windows\Package.psm1')
Import-Module (Join-Path $repo 'packaging\windows\Paths.psm1')
$version=(Get-Content (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json).version
Assert-AgentVVersion $version
$revision=(& git -C $repo rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'Missing candidate source revision.' }
$report=Join-Path $Directory 'candidate-evidence.json'
if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
$hashes=[ordered]@{}
foreach ($name in @(('agentv-'+$version+'-windows-x64.zip'),'install-agentv.ps1')) {
    $path=Join-Path $Directory $name
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecar=[IO.File]::ReadAllText($path+'.sha256').Trim()
    if ($sidecar -cne ($hash+'  '+$name)) { throw 'Candidate asset checksum mismatch.' }
    $hashes[$name]=$hash
}
$expected=[IO.File]::ReadAllText((Join-Path $repo 'scripts\install-agentv.ps1')).Replace('@@VERSION@@',$version)
if ([IO.File]::ReadAllText((Join-Path $Directory 'install-agentv.ps1')) -cne $expected) { throw 'Candidate installer is not the pinned source template.' }
$stage=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('AgentV-Candidate-'+[Guid]::NewGuid().ToString('N'))
try {
    New-AgentVProtectedDirectory $stage
    Expand-Archive -LiteralPath (Join-Path $Directory ('agentv-'+$version+'-windows-x64.zip')) -DestinationPath $stage
    $manifest=Assert-AgentVPackage -Directory $stage -Version $version
    if ($manifest.sourceRevision -cne $revision -or (@($manifest.nodeMajors) -join ',') -cne '22,24') { throw 'Candidate manifest does not match source/runtime identity.' }
    if ((Get-Content (Join-Path $stage 'package.json') -Raw|ConvertFrom-Json).version -cne $version) { throw 'Candidate package version mismatch.' }
    $result=[ordered]@{schema='acornops.agentv-windows-candidate.v1';qualification='unqualified';version=$version;sourceRevision=$revision;architecture='x64';nodeMajors=@(22,24);assets=$hashes;packageManifestSha256=(Get-FileHash (Join-Path $stage 'package-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant();files=@($manifest.files).Count}
    [IO.File]::WriteAllText($report,($result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Write-Output 'Candidate assets verified; no release published or rollout qualified.'
} finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
