$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$module=Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Installation.psm1') -PassThru -Force
$minimum=[DateTime]::SpecifyKind([DateTime]::Parse('2026-10-31T18:40:54'),[DateTimeKind]::Utc)
$prior=$minimum.AddSeconds(-20)
$cases=@(
    @{name='new successful whole-second COM run';prior=$prior;observed=$minimum;state=3;result=0;instances=0;expected='ready'},
    @{name='previous success is not this request';prior=$prior;observed=$prior;state=3;result=0;instances=0;expected='pending'},
    @{name='previous success in same second stays pending';prior=$minimum;observed=$minimum;state=3;result=0;instances=0;expected='pending'},
    @{name='new historical run predates current request';prior=$prior;observed=$minimum.AddSeconds(-1);state=3;result=0;instances=0;expected='pending'},
    @{name='running instance cannot prove completion';prior=$prior;observed=$minimum;state=4;result=267009;instances=1;expected='pending'},
    @{name='queued task cannot prove completion';prior=$prior;observed=$minimum;state=2;result=0;instances=0;expected='pending'},
    @{name='another active instance cannot prove completion';prior=$prior;observed=$minimum;state=3;result=0;instances=1;expected='pending'},
    @{name='completed failure is reported as failure';prior=$prior;observed=$minimum;state=3;result=1;instances=0;expected='failed'},
    @{name='unknown time kind cannot prove freshness';prior=$prior;observed=[DateTime]::SpecifyKind($minimum,[DateTimeKind]::Unspecified);state=3;result=0;instances=0;expected='pending'}
)
foreach($case in $cases){
    $actual=& $module {param($Case,$Minimum) Get-AgentVTaskCompletionDecision -PriorRunUtc $Case.prior -MinimumRunUtc $Minimum -ObservedRunUtc $Case.observed -State $Case.state -Result $Case.result -Instances $Case.instances} -Case $case -Minimum $minimum
    if($actual -cne $case.expected){throw ('Task observation case failed: '+$case.name)}
}
Write-Output ('Task completion observation cases passed ('+$cases.Count+'). Native fresh/repair fixture proves the actual COM source.')
