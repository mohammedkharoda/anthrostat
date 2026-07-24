# Installs Anthrostat for the current user (no admin required).
# - Copies the app to %LOCALAPPDATA%\Anthrostat
# - Creates Desktop and Start-Menu shortcuts
# - Launches the app (it lives in the system tray)
$ErrorActionPreference = "Stop"
$src  = Join-Path $PSScriptRoot "Anthrostat"
$dest = Join-Path $env:LOCALAPPDATA "Anthrostat"
$exe  = Join-Path $dest "Anthrostat.exe"
$ico  = Join-Path $dest "icon.ico"

if (-not (Test-Path $src)) { throw "Cannot find app files at $src" }

Write-Host "Installing Anthrostat to:`n  $dest`n"

# Stop any running copy so files aren't locked.
Get-Process "Anthrostat" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

# Copy the app.
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force

# Create shortcuts.
$ws = New-Object -ComObject WScript.Shell
function New-Shortcut($path) {
  $sc = $ws.CreateShortcut($path)
  $sc.TargetPath = $exe
  $sc.WorkingDirectory = $dest
  $sc.IconLocation = $ico
  $sc.Description = "Claude usage gauge"
  $sc.Save()
}
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")
New-Shortcut (Join-Path $desktop  "Anthrostat.lnk")
New-Shortcut (Join-Path $programs "Anthrostat.lnk")
Write-Host "Created Desktop and Start-Menu shortcuts."

# Launch it.
Start-Process -FilePath $exe
Write-Host "`nDone! Anthrostat is now running in your system tray"
Write-Host "(bottom-right, near the clock - click the ^ arrow if hidden)."
Write-Host "Tip: right-click the tray icon to enable 'Start at login'."
