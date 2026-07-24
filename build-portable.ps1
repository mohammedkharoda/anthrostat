# Assembles a self-contained Anthrostat app folder from the Electron
# runtime + app source, and stamps it with the custom icon. No admin needed.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$stage = Join-Path $root "dist\Anthrostat"
$eDist = Join-Path $root "node_modules\electron\dist"

Write-Host "Staging to $stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# 1. Copy the Electron runtime.
Copy-Item "$eDist\*" $stage -Recurse -Force

# 2. Drop our app into resources\app (Electron prefers this over default_app).
$appDir = Join-Path $stage "resources\app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $root "main.js")    $appDir -Force
Copy-Item (Join-Path $root "preload.js") $appDir -Force
Copy-Item (Join-Path $root "package.json") $appDir -Force
Copy-Item (Join-Path $root "src")   (Join-Path $appDir "src")   -Recurse -Force
Copy-Item (Join-Path $root "build") (Join-Path $appDir "build") -Recurse -Force

# 3. Rename the launcher exe.
$exe = Join-Path $stage "Anthrostat.exe"
Rename-Item (Join-Path $stage "electron.exe") "Anthrostat.exe"

# 4. Stamp icon + metadata with rcedit (from electron-builder's cache).
$rcedit = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Filter "rcedit-x64.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$ico = Join-Path $root "build\icon.ico"
if ($rcedit) {
  & $rcedit.FullName "$exe" --set-icon "$ico" `
    --set-version-string "ProductName" "Anthrostat" `
    --set-version-string "FileDescription" "Anthrostat" `
    --set-version-string "CompanyName" "Anthrostat" `
    --set-version-string "OriginalFilename" "Anthrostat.exe"
  Write-Host "Icon + metadata stamped."
} else {
  Write-Host "rcedit not found - exe will use default Electron icon."
}

# Keep a copy of the icon next to the exe for shortcuts.
Copy-Item $ico (Join-Path $stage "icon.ico") -Force

# 5. Drop the installer scripts next to the app folder (dist\install.ps1 etc.)
Copy-Item (Join-Path $root "installer\*") (Join-Path $root "dist") -Force

Write-Host "DONE. App folder: $stage"
Write-Host ("Launcher: " + $exe)
