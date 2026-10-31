[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Pure transition tests: no services, files, credentials, or network are mutated.
Import-Module (Join-Path $PSScriptRoot '..\..\packaging\windows\Recovery.psm1') -Force
$cases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'recovery-cases.json') -Raw | ConvertFrom-Json
foreach ($case in $cases) {
    $actual = Get-AgentVRecoveryDecision -Intent $case.intent -Status $case.status -CandidateReady $case.candidateReady -PreviousReady $case.previousReady -PreviousExists $case.previousExists
    if ($actual -ne $case.expected) { throw "Recovery decision failed: $($case.name); wanted $($case.expected), got $actual" }
}
Write-Output "Recovery state decisions passed ($($cases.Count) cases)."
