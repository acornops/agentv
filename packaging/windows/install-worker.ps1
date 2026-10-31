[CmdletBinding()]
param([ValidateSet('Install','Recover','Uninstall')][string]$Action='Install',[string]$Version,[string]$PlatformUrl,[string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential,[string]$NodePath,[string]$AdditionalCaBundleFile,[switch]$Automatic)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    Import-Module (Join-Path $PSScriptRoot 'Installation.psm1') -Force
    if ($Action -eq 'Recover') { $result=Invoke-AgentVRecovery -Automatic:$Automatic }
    elseif ($Action -eq 'Uninstall') { $result=Invoke-AgentVUninstall }
    else { $result=Invoke-AgentVInstallation -PackageDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) -Version $Version -PlatformUrl $PlatformUrl -TargetId $TargetId -EnrollmentToken $EnrollmentToken -ReplaceCredential:$ReplaceCredential -NodePath $NodePath -AdditionalCaBundleFile $AdditionalCaBundleFile }
    if ($result -notin @('idle','prepared','completed','rolled-back','uninstalled-config-retained')) { Write-Output 'AgentV recovery is pending. Protected state was retained; run the installed recovery command after restoring connectivity.'; exit 3 }
    Write-Output ('AgentV operation: '+$result)
} catch {
    # Never print response bodies, credentials, configuration, or arbitrary exception text.
    Write-Output ('AgentV failure type='+$_.Exception.GetType().Name+' hresult='+$_.Exception.HResult+' file='+[IO.Path]::GetFileName($_.InvocationInfo.ScriptName)+' line='+$_.InvocationInfo.ScriptLineNumber)
    Write-Error 'AgentV operation could not complete. Protected recovery state and existing credentials have been retained. Inspect the documented recovery procedure.'
    exit 1
}
