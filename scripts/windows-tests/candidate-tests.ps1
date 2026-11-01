# Exercise the actual verifier and package validator against disposable artifacts.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$directory=Join-Path $repo 'release\windows'
$verify=Join-Path $repo 'scripts\windows-qualification\verify-candidate.ps1'
& $verify -Directory $directory
$version=(Get-Content (Join-Path $repo 'package.json') -Raw|ConvertFrom-Json).version
$archive=Join-Path $directory ('agentv-'+$version+'-windows-x64.zip')
$installer=Join-Path $directory 'install-agentv.ps1'
$scratch=Join-Path $env:TEMP ('agentv-candidate-test-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $scratch
try {
    foreach ($asset in @($archive,$installer)) {
        $original=[IO.File]::ReadAllBytes($asset)
        try {
            [IO.File]::AppendAllText($asset,'corruption')
            $rejected=$false;try { & $verify -Directory $directory } catch { $rejected=$true }
            if (-not $rejected -or (Test-Path (Join-Path $directory 'candidate-evidence.json'))) { throw 'Corrupted candidate was accepted.' }
        } finally { [IO.File]::WriteAllBytes($asset,$original) }
    }
    # Updating the outer checksum must not hide a changed runtime file.
    $original=[IO.File]::ReadAllBytes($archive);$sidecar=[IO.File]::ReadAllBytes($archive+'.sha256')
    try {
        Expand-Archive -LiteralPath $archive -DestinationPath $scratch
        [IO.File]::AppendAllText((Join-Path $scratch 'dist\index.js'),'corruption')
        Remove-Item -LiteralPath $archive
        Compress-Archive -Path (Join-Path $scratch '*') -DestinationPath $archive
        [IO.File]::WriteAllText($archive+'.sha256',((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($archive)))
        $rejected=$false;try { & $verify -Directory $directory } catch { $rejected=$true }
        if (-not $rejected) { throw 'Changed runtime with recomputed ZIP checksum was accepted.' }
    } finally { [IO.File]::WriteAllBytes($archive,$original);[IO.File]::WriteAllBytes($archive+'.sha256',$sidecar) }
    & $verify -Directory $directory
    Write-Output 'Candidate checksum and runtime corruption rejection passed.'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force }
