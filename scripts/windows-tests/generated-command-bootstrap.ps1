# Explicitly synthetic downloaded parameter capture. No installation/enrollment.
[CmdletBinding()]
param([string]$ReleaseBaseUrl,[string]$PlatformUrl,[string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential)
$ErrorActionPreference='Stop'
if($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:AGENTV_WRAPPER_CAPTURE){throw 'Synthetic capture requires owned hosted CI.'}
$capture=[ordered]@{releaseBaseUrl=$ReleaseBaseUrl;platformUrl=$PlatformUrl;targetId=$TargetId;enrollmentToken=[string]$EnrollmentToken;replaceCredential=[bool]$ReplaceCredential}
[IO.File]::WriteAllText($env:AGENTV_WRAPPER_CAPTURE,($capture|ConvertTo-Json -Compress))
if($env:AGENTV_WRAPPER_FAILURE -eq 'bootstrap-error'){throw 'Synthetic bootstrap failure'}
