$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# These exact commands were emitted by the recorded control-plane source.
# Parse the whole download/temp-file wrapper, then execute only its literal
# bootstrap invocation against a parameter-binding capture block. No network,
# downloaded script, service or machine configuration is used by this check.
$fixture=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'generated-command-fixtures.json') -Raw|ConvertFrom-Json
foreach($case in $fixture.cases){
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($case.command,[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'Generated control-plane wrapper does not parse under native PowerShell.'}
    $invocations=@($ast.FindAll({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
        $node.CommandElements[0] -is [Management.Automation.Language.VariableExpressionAst] -and
        $node.CommandElements[0].VariablePath.UserPath -ceq 'agentvInstaller'
    },$true))
    if($invocations.Count -ne 1){throw 'Generated command must contain one bootstrap invocation.'}
    foreach($element in @($invocations[0].CommandElements|Select-Object -Skip 1)){
        if($element -isnot [Management.Automation.Language.CommandParameterAst] -and $element -isnot [Management.Automation.Language.StringConstantExpressionAst]){throw 'Bootstrap arguments must be literal data.'}
    }
    $agentvInstaller={
        [CmdletBinding()]
        param([string]$ReleaseBaseUrl,[string]$PlatformUrl,[string]$TargetId,[string]$EnrollmentToken,[switch]$ReplaceCredential)
        [pscustomobject]@{releaseBaseUrl=$ReleaseBaseUrl;platformUrl=$PlatformUrl;targetId=$TargetId;enrollmentToken=$EnrollmentToken;replaceCredential=[bool]$ReplaceCredential}
    }
    $bound=& ([ScriptBlock]::Create($invocations[0].Extent.Text))
    foreach($field in @('releaseBaseUrl','platformUrl','targetId','enrollmentToken','replaceCredential')){
        if($bound.$field -cne $case.expected.$field){throw ('Generated bootstrap argument binding differs for '+$case.name+'/'+$field)}
    }
}
Write-Output ('Actual control-plane wrappers parse and bind correctly ('+$fixture.cases.Count+' cases; CP '+$fixture.controlPlaneRevision+'). Wrapper download itself is not executed by this test.')
