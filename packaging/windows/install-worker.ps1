[CmdletBinding()]
param([ValidateSet('Install','Recover','Uninstall')][string]$Action='Install',[string]$Version,[string]$PlatformUrl,[string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential,[string]$NodePath,[string]$AdditionalCaBundleFile,[switch]$Automatic,[switch]$AcceptCommittedCandidate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    if ($AcceptCommittedCandidate -and $Action -ne 'Recover') { throw 'Candidate acceptance is a recovery-only operation.' }
    Import-Module (Join-Path $PSScriptRoot 'Installation.psm1') -Force
    if ($Action -eq 'Recover') { $result=Invoke-AgentVRecovery -Automatic:$Automatic -AcceptCommittedCandidate:$AcceptCommittedCandidate }
    elseif ($Action -eq 'Uninstall') { $result=Invoke-AgentVUninstall }
    else { $result=Invoke-AgentVInstallation -PackageDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) -Version $Version -PlatformUrl $PlatformUrl -TargetId $TargetId -EnrollmentToken $EnrollmentToken -ReplaceCredential:$ReplaceCredential -NodePath $NodePath -AdditionalCaBundleFile $AdditionalCaBundleFile }
    if ($result -notin @('idle','prepared','completed','rolled-back','uninstalled-config-retained')) { Write-Output 'AgentV recovery is pending. Protected state was retained; run the installed recovery command after restoring connectivity.'; exit 3 }
    Write-Output ('AgentV operation: '+$result)
} catch {
    # Never print response bodies, credentials, configuration, or arbitrary exception text.
    $failure=$_.Exception.GetBaseException();$type=$failure.GetType().Name
    if($type -notin @('RuntimeException','MethodInvocationException','IOException','FileNotFoundException','DirectoryNotFoundException','UnauthorizedAccessException','ArgumentException','InvalidOperationException','InvalidDataException','NotSupportedException','JsonReaderException','PSInvalidCastException','ParameterBindingException','ItemNotFoundException','CommandNotFoundException','PropertyNotFoundException')){$type='Other'}
    $file=[IO.Path]::GetFileName($_.InvocationInfo.ScriptName)
    if($file -notin @('Package.psm1','Paths.psm1','install-worker.ps1','Installation.psm1','Recovery.psm1')){$file='other'}
    Write-Output ('AgentV worker failure stage='+$Action.ToLowerInvariant()+' type='+$type+' hresult='+$failure.HResult+' file='+$file+' line='+[int]$_.InvocationInfo.ScriptLineNumber)
    Write-Error 'AgentV operation could not complete. Protected recovery state and existing credentials have been retained. Inspect the documented recovery procedure.'
    exit 1
}
