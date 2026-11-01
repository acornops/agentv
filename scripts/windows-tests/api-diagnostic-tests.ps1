[CmdletBinding()]
param([switch]$AllowDisposableCi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $AllowDisposableCi -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true'){throw 'Explicit disposable hosted-CI authorization is required.'}
$module=Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Installation.psm1') -PassThru -Force
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Paths.psm1')
$root=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'AgentV Api Diagnostics CI'
if(Test-Path -LiteralPath $root){throw 'Refusing preexisting synthetic API fixture.'}
$evidenceDirectory=Join-Path $PSScriptRoot '..\..\artifacts\windows-api-diagnostics'
$null=New-Item -ItemType Directory -Path $evidenceDirectory -Force
$records=[Collections.Generic.List[object]]::new()
$owned=$false;$bound=$false;$originalError=[Console]::Error
$ambient=@{};$names=@('CURL_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY')
# These cases catch lost categories, changed uncertainty/rollback results, unbounded
# or secret-bearing diagnostics, skipped cleanup, and stderr changing recovery.
$cases=@(
    @{name='transport';code=0;data=$false;diagnostic='transport native=7'},
    @{name='native-stderr';code=0;data=$false;diagnostic='transport( native=7)?'},
    @{name='native-excessive';code=0;data=$false;diagnostic='transport'},
    @{name='invalid-status';code=0;data=$false;diagnostic='invalid-status'},
    @{name='excessive-status';code=0;data=$false;diagnostic='invalid-status'},
    @{name='multiple-status';code=0;data=$false;diagnostic='invalid-status'},
    @{name='unicode-status';code=0;data=$false;diagnostic='invalid-status'},
    @{name='empty-status';code=0;data=$false;diagnostic='invalid-status'},
    @{name='missing-response';code=0;data=$false;diagnostic='missing-response'},
    @{name='malformed-response';code=0;data=$false;diagnostic='invalid-response'},
    @{name='oversized-response';code=0;data=$false;diagnostic='invalid-response'},
    @{name='rollback-denied';code=409;data=$true;diagnostic='http http=409'},
    @{name='server-error';code=503;data=$true;diagnostic='http http=503'},
    @{name='unusual-status';code=999;data=$true;diagnostic='http'},
    @{name='zero-status';code=0;data=$true;diagnostic='http'},
    @{name='boundary-response';code=200;data=$true;diagnostic=''},
    @{name='success';code=200;data=$true;diagnostic=''}
)
try{
    New-AgentVProtectedDirectory -Path $root;$owned=$true
    $exe=Join-Path $root 'synthetic-curl.exe'
    Add-Type -Path (Join-Path $PSScriptRoot 'ApiIoFixture.cs') -OutputAssembly $exe -OutputType ConsoleApplication
    Set-AgentVAcl -Path $exe
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
public sealed class ApiThrowingWriter : TextWriter {
    public int Attempts;
    public override Encoding Encoding { get { return Encoding.UTF8; } }
    public override void WriteLine(string value) { Attempts++; throw new IOException("synthetic-sink-secret"); }
}
'@
    # Exact executable-resolution boundary substitution; no production body is
    # copied, rewritten, or replaced. Protected storage and JSON parsing stay real.
    & $module {
        param($Root,$Exe)
        $script:ApiOriginalPaths=$script:Paths
        $script:Paths=[pscustomobject]@{Root=$Root}
        $script:ApiSyntheticExe=$Exe;$script:ApiSyntheticResolutions=0
        function script:Join-Path {
            param([string]$Path,[string]$ChildPath)
            if($Path -ceq [Environment]::SystemDirectory -and $ChildPath -ceq 'curl.exe'){
                $script:ApiSyntheticResolutions++;return $script:ApiSyntheticExe
            }
            Microsoft.PowerShell.Management\Join-Path -Path $Path -ChildPath $ChildPath
        }
    } -Root $root -Exe $exe
    $bound=$true
    foreach($name in $names){$ambient[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,'synthetic-environment-secret','Process')}
    foreach($case in $cases){
        $sinks=@('capture')
        if($case.name -in @('transport','malformed-response','rollback-denied','success')){$sinks+=@('throw','unavailable')}
        foreach($sink in $sinks){
            [IO.File]::WriteAllText((Join-Path $root 'case.txt'),$case.name)
            $called=Join-Path $root 'called.txt'
            if(Test-Path $called){Remove-Item -LiteralPath $called -Force}
            $before=& $module {$script:ApiSyntheticResolutions}
            $capture=[IO.StringWriter]::new();$throwing=[ApiThrowingWriter]::new()
            $writer=if($sink -eq 'capture'){$capture}elseif($sink -eq 'throw'){$throwing}else{[IO.TextWriter]::Null}
            $result=$null;$threw=$false
            try{
                [Console]::SetError($writer)
                $result=& $module {
                    Invoke-AgentVApi -PlatformUrl 'https://synthetic-secret.invalid' -Suffix '/api/v1/agentv/installations/00000000-0000-4000-8000-000000000000/rollback' -Method POST -Body @{token='synthetic-request-secret'} -Secret 'avt_00000000-0000-4000-8000-000000000000_0123456789abcdef0123456789abcdef'
                }
            }catch{$threw=$true}finally{[Console]::SetError($originalError)}
            $shape=-not $threw -and @($result).Count -eq 1 -and $null -ne $result -and (@($result.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'available,code,data'
            $outcome=$false
            if($shape){
                $outcome=$result.available -is [bool] -and $result.available -eq ($case.code -eq 200) -and $result.code -eq $case.code
                if($case.data){$outcome=$outcome -and $null -ne $result.data -and $result.data.marker -ceq 'synthetic-response-secret'}else{$outcome=$outcome -and $null -eq $result.data}
                if($case.name -eq 'rollback-denied'){$outcome=$outcome -and $result.data.allowed -eq $false}
            }
            $text=$capture.ToString()
            $diagnostic=if($sink -eq 'capture'){
                if($case.diagnostic){$text.Length -le 160 -and $text -cmatch ('\AAgentV API failure category='+$case.diagnostic+'\r?\n\z')}else{$text.Length -eq 0}
            }elseif($sink -eq 'throw'){$throwing.Attempts -eq $(if($case.diagnostic){1}else{0})}else{$true}
            $clean=@(Get-ChildItem (Join-Path $root 'http') -Force).Count -eq 0
            $external=($before+1) -eq (& $module {$script:ApiSyntheticResolutions}) -and (Test-Path $called) -and (Get-Item $called).Length -eq 1
            $restored=$true;foreach($name in $names){if([Environment]::GetEnvironmentVariable($name,'Process') -cne 'synthetic-environment-secret'){$restored=$false}}
            $records.Add([pscustomobject]@{case=$case.name;sink=$sink;outcomePreserved=[bool]$outcome;diagnosticSafe=[bool]$diagnostic;cleaned=[bool]$clean;syntheticNativeInvoked=[bool]$external;environmentRestored=[bool]$restored})
            $capture.Dispose();$throwing.Dispose()
        }
    }
}finally{
    [Console]::SetError($originalError)
    foreach($name in $ambient.Keys){[Environment]::SetEnvironmentVariable($name,$ambient[$name],'Process')}
    if($bound){& $module {$script:Paths=$script:ApiOriginalPaths;Remove-Item Function:\Join-Path;Remove-Variable ApiOriginalPaths,ApiSyntheticExe,ApiSyntheticResolutions -Scope Script}}
    if($owned){Remove-Item -LiteralPath $root -Recurse -Force}
    # Only fixed case/sink names and booleans leave this fixture; never raw I/O.
    [pscustomobject]@{schema=1;mode='synthetic-native-api-io';cases=@($records.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'evidence.json') -Encoding UTF8
}
$failed=@($records | Where-Object {-not($_.outcomePreserved -and $_.diagnosticSafe -and $_.cleaned -and $_.syntheticNativeInvoked -and $_.environmentRestored)})
foreach($record in $failed){Write-Output ('Synthetic API case='+$record.case+' sink='+$record.sink+' outcome='+$record.outcomePreserved+' diagnostic='+$record.diagnosticSafe+' cleanup='+$record.cleaned+' native='+$record.syntheticNativeInvoked+' environment='+$record.environmentRestored)}
if($failed.Count -or $records.Count -ne 25){throw 'Synthetic native API decision/diagnostic checks failed; inspect allowlisted evidence.'}
Write-Output ('Production API decisions and sanitized diagnostics passed with synthetic native I/O ('+$records.Count+' cases).')
