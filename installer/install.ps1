# Installs Claude Battery for the current user (no admin required).
# - Copies the app to %LOCALAPPDATA%\Claude Battery
# - Creates Desktop and Start-Menu shortcuts
# - Launches the app (it lives in the system tray)
$ErrorActionPreference = "Stop"
$src  = Join-Path $PSScriptRoot "ClaudeBattery"
$dest = Join-Path $env:LOCALAPPDATA "Claude Battery"
$exe  = Join-Path $dest "Claude Battery.exe"
$ico  = Join-Path $dest "icon.ico"

if (-not (Test-Path $src)) { throw "Cannot find app files at $src" }

Write-Host "Installing Claude Battery to:`n  $dest`n"

# Stop any running copy so files aren't locked.
Get-Process "Claude Battery" -ErrorAction SilentlyContinue | Stop-Process -Force
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
  $sc.Description = "Claude usage battery"
  $sc.Save()
}
$desktop = [Environment]::GetFolderPath("Desktop")
$programs = [Environment]::GetFolderPath("Programs")
New-Shortcut (Join-Path $desktop  "Claude Battery.lnk")
New-Shortcut (Join-Path $programs "Claude Battery.lnk")
Write-Host "Created Desktop and Start-Menu shortcuts."

# Launch it.
Start-Process -FilePath $exe
Write-Host "`nDone! Claude Battery is now running in your system tray"
Write-Host "(bottom-right, near the clock - click the ^ arrow if hidden)."
Write-Host "Tip: right-click the tray icon to enable 'Start at login'."
