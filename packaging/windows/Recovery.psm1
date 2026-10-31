Set-StrictMode -Version Latest
function Get-AgentVRecoveryDecision {
    [CmdletBinding()]
    param([string]$Intent, $Status, [bool]$CandidateReady, [bool]$PreviousReady, [bool]$PreviousExists)
    return 'pending'
}
Export-ModuleMember -Function Get-AgentVRecoveryDecision
