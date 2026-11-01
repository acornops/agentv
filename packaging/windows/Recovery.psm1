Set-StrictMode -Version Latest
function Get-AgentVRecoveryDecision {
    [CmdletBinding()]
    param([string]$Intent, $Status, [bool]$CandidateReady, [bool]$PreviousReady, [bool]$PreviousExists)
    if ($null -eq $Status) { return 'pending' }
    if ($Status.status -notin @('issued','exchanged','verified','completed','cancelled','expired') -or $Status.credentialState -notin @('pending','active','grace','revoked') -or $Status.activeConnected -isnot [bool]) { return 'pending' }
    if ($Status.status -eq 'completed') {
        if ($Status.credentialState -in @('grace','revoked')) { return 'replacement-required' }
        if ($Status.credentialState -ne 'active') { return 'pending' }
        if ($Intent -eq 'rollback-denied') { return 'retain-candidate-recovery-required' }
        if ($Intent -eq 'rollback') { return 'rollback' }
        if ($CandidateReady -and $Status.activeConnected) { return 'finalize-candidate' }
        return 'pending'
    }
    # Explicit acceptance is restricted to the exact completed active candidate.
    # It can never fall through to historical restoration or a new commit.
    if ($Intent -eq 'accept-committed') { return 'pending' }
    if ($Status.status -in @('cancelled','expired') -and $Status.credentialState -eq 'revoked') {
        if (-not $PreviousExists) { return 'remove-initial' }
        if ($PreviousReady -and $Status.activeConnected) { return 'finalize-previous' }
        return 'restore-previous'
    }
    if ($Status.status -in @('exchanged','verified') -and $Status.credentialState -eq 'pending') {
        if ($Intent -eq 'rollback') { return 'rollback' }
        if ($Status.status -eq 'verified' -and $CandidateReady -and $Intent -eq 'commit') { return 'commit' }
    }
    return 'pending'
}
Export-ModuleMember -Function Get-AgentVRecoveryDecision
