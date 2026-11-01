[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Native Windows PowerShell 5.1 is required.'}
# Existing job implementation is reused only for ownership, never its diagnostic
# watchdog. Gate child execution until assignment so curl cannot escape the job.
Add-Type -Path (Join-Path $PSScriptRoot 'FirstCallJob.cs')
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixture=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'generated-command-fixtures.json') -Raw|ConvertFrom-Json
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ("AgentV Wrapper's CI-"+[Guid]::NewGuid().ToString('N'))
$ps=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$node=(Get-Command node -CommandType Application|Select-Object -First 1).Source
$certificate=$null;$owned=$false;$rootOwned=$false;$server=$null;$job=$null
$processes=[Collections.Generic.List[Diagnostics.Process]]::new()
$startup=Join-Path $work 'server-startup.json'
$evidence=[ordered]@{schema=1;boundary='exact-generated-outer-https-wrapper-with-synthetic-bootstrap';controlPlaneRevision=$fixture.controlPlaneRevision;sourceSha256=$fixture.sourceSha256;configurationSourceSha256=$fixture.configurationSourceSha256;sourceRevision=(& git -C $repo rev-parse HEAD);powershell51=$true;serverStartup=@{available=$false;processExitCode=$null};stage='preflight';cases=@();passed=$false;cleanupConfirmed=$false}
function Assert-Wrapper([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Wait-Wrapper([scriptblock]$Condition,[int]$Seconds){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not(& $Condition)){if($clock.Elapsed.TotalSeconds -gt $Seconds){throw 'Owned wrapper fixture deadline exceeded.'};Start-Sleep -Milliseconds 100}}
function Start-Wrapper([string]$Executable,[string[]]$Arguments){
    $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Executable
    $info.Arguments=(@($Arguments|ForEach-Object {if($_.Contains('"')){throw 'Unsafe fixture argument.'};'"'+$_+'"'}) -join ' ')
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    $null=$process.Start();$null=$process.Handle;$processes.Add($process)
    # Drain privately; no command, bound values or raw child output is published.
    $null=$process.StandardOutput.ReadToEndAsync();$null=$process.StandardError.ReadToEndAsync()
    $job.Assign($process.Handle)
    return $process
}
function Run-Wrapper([string]$Name,[string]$Mode){
    $script:evidence.stage=$Name+'/'+$Mode
    $directory=Join-Path $work ($Name+'-'+$Mode)
    Assert-Wrapper (-not(Test-Path -LiteralPath $directory)) 'Refusing preexisting case directory.'
    New-AgentVProtectedDirectory $directory
    $sentinel=Join-Path $directory 'unrelated-sentinel.txt';[IO.File]::WriteAllText($sentinel,'preserve-unrelated')
    [IO.File]::WriteAllText((Join-Path $work 'mode'),$Mode)
    $child=Start-Wrapper $ps @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'generated-command-child.ps1'),'-AllowDisposableCi','-Control',$directory,'-Case',$Name,'-Mode',$Mode)
    [IO.File]::WriteAllText((Join-Path $directory 'go'),'go')
    Assert-Wrapper ($child.WaitForExit(90000)) 'Generated wrapper command exceeded its owned deadline.'
    Assert-Wrapper ($child.ExitCode -eq 0) 'Generated wrapper child did not return its bounded result.'
    $result=Get-Content -LiteralPath (Join-Path $directory 'result.json') -Raw|ConvertFrom-Json
    Assert-Wrapper ($result.allocatedBoth -and $result.pathsOwned -and $result.temporaryRemoved -and $result.installerRemoved) 'Generated wrapper leaked or escaped one of its two temporary paths.'
    Assert-Wrapper ((Get-Content -LiteralPath $sentinel -Raw) -ceq 'preserve-unrelated') 'Generated wrapper changed an unrelated sentinel.'
    $invoked=Test-Path -LiteralPath (Join-Path $directory 'capture.json')
    if($Mode -in @('success','bootstrap-error')){
        Assert-Wrapper $invoked 'Downloaded synthetic bootstrap was not invoked.'
        $bound=Get-Content -LiteralPath (Join-Path $directory 'capture.json') -Raw|ConvertFrom-Json
        $expected=@($fixture.cases|Where-Object {$_.name -ceq $Name})[0].expected
        foreach($field in @('releaseBaseUrl','platformUrl','targetId','enrollmentToken','replaceCredential')){Assert-Wrapper ($bound.$field -ceq $expected.$field) ('Downloaded bootstrap binding differs: '+$Name+'/'+$field)}
    }else{Assert-Wrapper (-not $invoked) 'Failed download invoked a bootstrap.'}
    Assert-Wrapper ($result.failed -eq ($Mode -ne 'success')) 'Generated wrapper reported the wrong success/failure result.'
    $expectedCurl=if($Mode -eq 'untrusted'){60}elseif($Mode -eq 'http-error'){22}else{0}
    Assert-Wrapper ($result.curlExitCode -eq $expectedCurl) 'OS curl did not report the expected TLS/HTTP result.'
    # No paths, arguments, commands, raw output or synthetic token in artifacts.
    $script:evidence.cases+=@{name=$Name;mode=$Mode;passed=$true;bootstrapInvoked=$invoked;bindingMatched=($Mode -in @('success','bootstrap-error'));bothTemporaryPathsRemoved=$true;sentinelIntact=$true}
}
try{
    Assert-Wrapper (-not(Test-Path -LiteralPath $work)) 'Refusing preexisting scratch directory.'
    Assert-Wrapper (-not(Get-NetTCPConnection -LocalPort 18443 -State Listen -ErrorAction SilentlyContinue)) 'Refusing a preexisting loopback listener.'
    $null=New-Item -ItemType Directory -Path $work -ErrorAction Stop;$owned=$true
    Set-AgentVAcl -Path $work
    $job=[FirstCallJob]::new()
    $certificate=New-SelfSignedCertificate -Type SSLServerAuthentication -DnsName localhost -CertStoreLocation 'Cert:\LocalMachine\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter ((Get-Date).AddHours(4))
    Assert-Wrapper (-not(Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$certificate.Thumbprint))) 'Refusing preexisting root certificate.'
    $password=[Guid]::NewGuid().ToString('N');$pfx=Join-Path $work 'fixture.pfx'
    $null=Export-PfxCertificate -Cert $certificate -FilePath $pfx -Password (ConvertTo-SecureString $password -AsPlainText -Force)
    $cer=Join-Path $work 'fixture.cer';$null=Export-Certificate -Cert $certificate -FilePath $cer
    $options=Join-Path $work 'server-options.json';$ready=Join-Path $work 'ready'
    [IO.File]::WriteAllText($options,(@{allowDisposableCi=$true;pfx=$pfx;passphrase=$password;control=(Join-Path $work 'mode');ready=$ready;startupStatus=$startup}|ConvertTo-Json -Compress))
    $server=Start-Wrapper $node @((Join-Path $PSScriptRoot 'generated-command-server.mjs'),$options)
    Wait-Wrapper {if($server.HasExited){throw 'Owned HTTPS server exited before readiness.'};Test-Path -LiteralPath $ready} 15
    Run-Wrapper 'initial' 'untrusted'
    $evidence.stage='trust-owned-root'
    $rootOwned=$true;$null=Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\Root'
    foreach($name in @('initial','repair','replacement')){Run-Wrapper $name 'success'}
    Run-Wrapper 'initial' 'http-error'
    Run-Wrapper 'initial' 'bootstrap-error'
    $evidence.stage='complete';$evidence.passed=$true
}catch{
    # Allowlisted failure identity only. Never rethrow a child command record.
    $evidence.failure=@{type=$_.Exception.GetType().FullName;line=$_.InvocationInfo.ScriptLineNumber}
}finally{
    $cleanup=$true
    try{
        if($null -ne $server -and -not $server.HasExited){$server.StandardInput.WriteLine('stop');$server.StandardInput.Flush();$null=$server.WaitForExit(5000)}
    }catch{$cleanup=$false}
    if($null -ne $job){
        if(-not $job.Empty()){$null=$job.Terminate()}
        try{Wait-Wrapper {$job.Empty()} 10}catch{$cleanup=$false}
        $job.Dispose()
    }
    if($null -ne $server -and $server.HasExited){$evidence.serverStartup.processExitCode=$server.ExitCode}
    # Reconstruct allowlisted fields only; a missing or invalid status remains
    # explicitly unavailable. No raw stderr/error message is ever published.
    if($owned -and (Test-Path -LiteralPath $startup)){
        try{
            Assert-Wrapper ((Get-Item -LiteralPath $startup).Length -le 1024) 'Oversized startup status.'
            $status=Get-Content -LiteralPath $startup -Raw|ConvertFrom-Json
            foreach($field in @('phase','category','code','node','openssl')){Assert-Wrapper ($status.$field -is [string]) 'Nonliteral startup value.'}
            Assert-Wrapper ($status.phase -cin @('unavailable','authorization','options-read','pfx-read','bootstrap-read','tls-create','listen','ready-write','ready')) 'Unknown startup phase.'
            Assert-Wrapper ($status.category -cin @('none','other','file-missing','address-in-use','unsupported-pfx','pfx-password-or-mac')) 'Unknown startup category.'
            Assert-Wrapper ($status.code -cin @('none','unclassified','ENOENT','EADDRINUSE','ERR_CRYPTO_UNSUPPORTED_OPERATION','ERR_OSSL_EVP_UNSUPPORTED')) 'Unknown startup code.'
            Assert-Wrapper ($status.node -cmatch '^(?:[0-9][A-Za-z0-9.+-]{0,31}|unavailable)$' -and $status.openssl -cmatch '^(?:[0-9][A-Za-z0-9.+-]{0,31}|unavailable)$') 'Invalid runtime version.'
            $evidence.serverStartup.available=$true
            foreach($field in @('phase','category','code','node','openssl')){$evidence.serverStartup[$field]=$status.$field}
        }catch{}
    }
    foreach($process in $processes){try{if(-not $process.WaitForExit(5000)){$process.Kill();if(-not $process.WaitForExit(5000)){$cleanup=$false}}}catch{$cleanup=$false}finally{$process.Dispose()}}
    if($rootOwned -and (Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$certificate.Thumbprint))){try{Remove-Item -LiteralPath ('Cert:\LocalMachine\Root\'+$certificate.Thumbprint) -Force;Assert-Wrapper (-not(Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$certificate.Thumbprint))) 'Owned root remains.'}catch{$cleanup=$false}}
    if($null -ne $certificate){try{Remove-Item -LiteralPath ('Cert:\LocalMachine\My\'+$certificate.Thumbprint) -DeleteKey -Force;Assert-Wrapper (-not(Test-Path -LiteralPath ('Cert:\LocalMachine\My\'+$certificate.Thumbprint))) 'Owned certificate remains.'}catch{$cleanup=$false}}
    if($owned){try{Remove-Item -LiteralPath $work -Recurse -Force;Assert-Wrapper (-not(Test-Path -LiteralPath $work)) 'Owned scratch remains.'}catch{$cleanup=$false}}
    $evidence.cleanupConfirmed=$cleanup
    $artifact=Join-Path $repo 'artifacts\windows-generated-wrapper';$null=New-Item -ItemType Directory -Path $artifact -Force
    [IO.File]::WriteAllText((Join-Path $artifact 'evidence.json'),($evidence|ConvertTo-Json -Depth 8))
}
if(-not $evidence.passed -or -not $evidence.cleanupConfirmed){throw 'Exact generated HTTPS wrapper qualification failed; see sanitized evidence.'}
Write-Output 'Exact generated HTTPS wrappers passed with a synthetic parameter-capture bootstrap; owned resources removed.'
