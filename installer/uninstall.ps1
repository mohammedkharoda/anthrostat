# Removes Anthrostat for the current user.
$ErrorActionPreference = "SilentlyContinue"
$dest = Join-Path $env:LOCALAPPDATA "Anthrostat"

Get-Process "Anthrostat" | Stop-Process -Force
Start-Sleep -Milliseconds 800

Remove-Item (Join-Path ([Environment]::GetFolderPath("Desktop"))  "Anthrostat.lnk") -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Anthrostat.lnk") -Force
# Remove the "Start at login" entry if the app created one.
Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Anthrostat" -ErrorAction SilentlyContinue
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }

Write-Host "Anthrostat has been removed."
