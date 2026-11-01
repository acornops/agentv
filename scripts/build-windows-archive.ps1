[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\release\windows'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows archives must be built on Windows.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'A pinned package version is required.' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$stage = Join-Path $OutputDirectory ('.stage-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $stage
try {
    Push-Location $repo
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Windows runtime build failed.' } } finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $repo 'dist') -Destination $stage -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'package.json'),(Join-Path $repo 'package-lock.json') -Destination $stage
    & npm.cmd ci --omit=dev --ignore-scripts --prefix $stage
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency staging failed.' }
    $windows = Join-Path $stage 'windows'; $null = New-Item -ItemType Directory -Path $windows
    foreach ($name in @('Paths.psm1','Package.psm1','Recovery.psm1','Installation.psm1','install-worker.ps1','recover.ps1','doctor.mjs')) { Copy-Item -LiteralPath (Join-Path $repo ('packaging\windows\'+$name)) -Destination $windows }
    & (Join-Path $PSScriptRoot 'build-windows-host.ps1') -OutputDirectory $stage
    $files = @(); $total = 0
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -Force | Sort-Object FullName) {
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse package entries are forbidden.' }
        if ($file.PSIsContainer) { continue }
        $relative = $file.FullName.Substring($stage.Length+1).Replace('\','/')
        $total += $file.Length
        $files += @{ path=$relative; size=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    if ($total -gt 104857600 -or $files.Count -gt 20000) { throw 'Windows package exceeds its bounds.' }
    $manifest = @{ schema='acornops.agentv-windows-package.v1'; version=$version; architecture='x64'; nodeMajors=@(22,24); sourceRevision=(& git -C $repo rev-parse HEAD); files=$files }
    [IO.File]::WriteAllText((Join-Path $stage 'package-manifest.json'),($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $archive = Join-Path $OutputDirectory "agentv-$version-windows-x64.zip"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
    ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archive)) | Set-Content -LiteralPath ($archive+'.sha256') -Encoding ASCII
    $bootstrap = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'install-agentv.ps1')).Replace("'@@VERSION@@'","'$version'")
    $bootstrapPath = Join-Path $OutputDirectory 'install-agentv.ps1'
    [IO.File]::WriteAllText($bootstrapPath,$bootstrap,[Text.UTF8Encoding]::new($false))
    ((Get-FileHash -LiteralPath $bootstrapPath -Algorithm SHA256).Hash.ToLowerInvariant() + '  install-agentv.ps1') | Set-Content ($bootstrapPath+'.sha256') -Encoding ASCII
    Write-Output "Built Windows asset agentv-$version-windows-x64.zip; no release was published."
} finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
