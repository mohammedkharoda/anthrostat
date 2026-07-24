# Removes Claude Battery for the current user.
$ErrorActionPreference = "SilentlyContinue"
$dest = Join-Path $env:LOCALAPPDATA "Claude Battery"

Get-Process "Claude Battery" | Stop-Process -Force
Start-Sleep -Milliseconds 800

Remove-Item (Join-Path ([Environment]::GetFolderPath("Desktop"))  "Claude Battery.lnk") -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Claude Battery.lnk") -Force
# Remove the "Start at login" entry if the app created one.
Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Claude Battery" -ErrorAction SilentlyContinue
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }

Write-Host "Claude Battery has been removed."
