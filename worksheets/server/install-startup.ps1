# Adds (or with -Remove, deletes) a "Class Manager" shortcut in this user's
# Startup folder, so the local server is running whenever you're signed in.
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Class Manager.lnk'

if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk -Confirm:$false; 'Removed the startup shortcut.' } else { 'No startup shortcut to remove.' }
  return
}

$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = $PSScriptRoot
$s.Description = 'Class Manager local server (http://localhost:4777)'
$s.Save()
"Startup shortcut created: $lnk"
