[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Import-Module (Join-Path $repo 'packaging\windows\Paths.psm1')
$module=Import-Module (Join-Path $repo 'packaging\windows\Installation.psm1') -PassThru -Force
$paths=Get-AgentVPaths
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AgentV Teardown CI'
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$owned=$false;$serviceOwned=$false;$stopper=$null;$members=@()
$evidence=[ordered]@{sourceRevision=(& git -C $repo rev-parse HEAD);synthetic=$true;tests=@();observations=@()}
function Wait-TeardownCi([scriptblock]$Condition,[int]$Seconds=10){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not (& $Condition)){if($clock.Elapsed.TotalSeconds -gt $Seconds){throw 'Teardown fixture deadline.'};Start-Sleep -Milliseconds 50}}
function Assert-TeardownCi([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:evidence.tests+=$Message}
function Sc-TeardownCi([string[]]$Values){& $module {param($Arguments) Invoke-AgentVSc -Arguments $Arguments} -Arguments $Values}
if((Test-Path $work) -or (Test-Path $paths.Root) -or (Test-Path $paths.Program) -or (Get-Service AcornOpsAgentV -ErrorAction SilentlyContinue) -or (ScheduledTasks\Get-ScheduledTask -TaskName $paths.Task -ErrorAction SilentlyContinue)){throw 'Refusing preexisting teardown fixture resources.'}
try{
    & $module {Assert-AgentVAdministrator}
    New-AgentVProtectedDirectory -Path $work;$owned=$true
    $executable=Join-Path $work 'TeardownRaceFixture.exe'
    & $compiler /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll /main:TeardownRaceFixture "/out:$executable" (Join-Path $repo 'packaging\windows\AgentV.ServiceHost.cs') (Join-Path $PSScriptRoot 'TeardownRaceFixture.cs')
    if($LASTEXITCODE -ne 0){throw 'Synthetic teardown fixture compilation failed.'}
    $evidence.sourceSha256=(Get-FileHash (Join-Path $repo 'packaging\windows\AgentV.ServiceHost.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach($mode in @('confirmed','unconfirmed')){
        $directory=Join-Path $work $mode;New-AgentVProtectedDirectory -Path $directory
        $image='"'+$executable+'" "'+$directory+'" '+$mode
        Sc-TeardownCi @('create','AcornOpsAgentV','binPath=',$image,'start=','demand','obj=','NT AUTHORITY\LocalService');$serviceOwned=$true
        Sc-TeardownCi @('sidtype','AcornOpsAgentV','unrestricted')
        $sid=Get-AgentVServiceSid
        Set-AgentVAcl -Path $work -ServiceSid $sid
        Set-AgentVAcl -Path $executable -ServiceSid $sid
        Set-AgentVAcl -Path $directory -ServiceSid $sid -Rights Modify
        Start-Service AcornOpsAgentV
        Wait-TeardownCi {Test-Path (Join-Path $directory 'watcher-claimed')}
        $members=@(([IO.File]::ReadAllText((Join-Path $directory 'pids'))).Split(',')|ForEach-Object {[int]$_})
        Assert-TeardownCi ($null -ne (Get-Process -Id $members[1] -ErrorAction SilentlyContinue)) ($mode+': real job member remains alive after watcher owns teardown')
        $sc=Join-Path ([Environment]::SystemDirectory) 'sc.exe'
        $stopper=Start-Process -FilePath $sc -ArgumentList @('stop','AcornOpsAgentV') -PassThru -RedirectStandardOutput (Join-Path $directory 'sc.stdout') -RedirectStandardError (Join-Path $directory 'sc.stderr');$null=$stopper.Handle
        Wait-TeardownCi {Test-Path (Join-Path $directory 'stop-entered')}
        Start-Sleep -Milliseconds 200
        $during=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
        $early=Test-Path (Join-Path $directory 'stop-result')
        $evidence.observations+=@{mode=$mode;duringState=$during.State;duringExitCode=$during.ExitCode;stopReturnedBeforeTeardown=$early}
        Assert-TeardownCi (-not $early -and $during.State -ne 'Stopped') ($mode+': SCM stop waits for watcher-owned teardown instead of returning clean early')
        [IO.File]::WriteAllText((Join-Path $directory 'release-teardown'),'1')
        Wait-TeardownCi {(Get-Service AcornOpsAgentV).Status -eq 'Stopped'}
        $stopped=CimCmdlets\Get-CimInstance Win32_Service -Filter "Name='AcornOpsAgentV'"
        $result=[IO.File]::ReadAllText((Join-Path $directory 'stop-result'))
        Assert-TeardownCi (($mode -eq 'confirmed' -and $stopped.ExitCode -eq 0 -and $result -eq '1') -or ($mode -eq 'unconfirmed' -and $stopped.ExitCode -ne 0 -and $result -eq '0')) ($mode+': SCM stop status reflects the shared observed teardown result')
        Assert-TeardownCi ([IO.File]::ReadAllText((Join-Path $directory 'native-empty')) -eq '1' -and [IO.File]::ReadAllText((Join-Path $directory 'disposals')) -eq '1') ($mode+': actual Job emptiness is observed and disposal has one owner')
        Wait-TeardownCi {-not(Get-Process -Id $members -ErrorAction SilentlyContinue)}
        Assert-TeardownCi (-not(Test-Path (Join-Path $directory 'unexpected-exit'))) ($mode+': deliberate stop owns completion after watcher teardown')
        if(-not $stopper.WaitForExit(10000)){throw 'SCM stop client exceeded fixture bound.'};$stopper.Dispose();$stopper=$null
        Sc-TeardownCi @('delete','AcornOpsAgentV');$serviceOwned=$false
    }
}finally{
    if($null -ne $stopper){if(-not $stopper.HasExited){$stopper.Kill();$stopper.WaitForExit(5000)|Out-Null};$stopper.Dispose()}
    if($serviceOwned){Stop-Service AcornOpsAgentV -ErrorAction SilentlyContinue;Sc-TeardownCi @('delete','AcornOpsAgentV')}
    foreach($member in $members){$process=Get-Process -Id $member -ErrorAction SilentlyContinue;if($null -ne $process){try{if($process.Path -ieq $executable){$process.Kill();$process.WaitForExit(5000)|Out-Null}}finally{$process.Dispose()}}}
    if($owned){Remove-Item -LiteralPath $work -Recurse -Force}
    $artifact=Join-Path $repo 'artifacts\windows-service-host';$null=New-Item -ItemType Directory -Path $artifact -Force
    $evidence|ConvertTo-Json -Depth 6|Set-Content (Join-Path $artifact 'teardown-race-evidence.json') -Encoding UTF8
}
