$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$files=@(Get-ChildItem (Join-Path $root 'packaging\windows') -File | Where-Object {$_.Extension -in @('.ps1','.psm1')})
$files+=Get-ChildItem $PSScriptRoot -Filter '*.ps1' -File
$files+=Get-Item (Join-Path $root 'scripts\install-agentv.ps1'),(Join-Path $root 'scripts\build-windows-archive.ps1')
foreach($file in $files){$tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors);if($errors.Count){$errors | ForEach-Object {Write-Output ($file.Name+':'+$_.Extent.StartLineNumber+':'+$_.Message)};throw 'Windows package PowerShell parsing failed.'}}
Write-Output 'All Windows package PowerShell files parse under the native runtime.'
