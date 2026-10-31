[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The service host must be compiled on Windows.' }
$windows = [Environment]::GetFolderPath('Windows')
$compiler = Join-Path $windows 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw '.NET Framework 4.8 compiler is required; no prerequisites are installed automatically.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$source = Join-Path $PSScriptRoot '..\packaging\windows\AgentV.ServiceHost.cs'
$output = Join-Path $OutputDirectory 'AgentV.ServiceHost.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Windows service host compilation failed.' }
$revision = git -C (Join-Path $PSScriptRoot '..') rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot bind the service host to its source revision.' }
@{ schema = 'acornops.agentv-windows-host.v1'; sourceRevision = $revision; sourceSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant(); binarySha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant(); targetFramework = 'net48'; architecture = 'x64' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'host-manifest.json') -Encoding UTF8
