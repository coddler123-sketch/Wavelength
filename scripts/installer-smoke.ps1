param(
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $InstallerPath) {
  $version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
  $InstallerPath = Join-Path $root "dist\Wavelength-Setup-$version.exe"
}

$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$installDir = Join-Path $env:TEMP "wavelength-installer-smoke-$PID"
$userDataDir = Join-Path $env:TEMP "wavelength-profile-smoke-$PID"
$appProcess = $null

function Stop-InstalledProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase)
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

try {
  $installer = Start-Process -FilePath $InstallerPath -ArgumentList '/S', "/D=$installDir" -Wait -PassThru -WindowStyle Hidden
  if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)" }

  $exe = Join-Path $installDir 'Wavelength.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Installed executable not found: $exe" }

  $appProcess = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$userDataDir", '--hidden' -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 5
  if ($appProcess.HasExited) { throw "Installed app exited early with code $($appProcess.ExitCode)" }

  Stop-Process -Id $appProcess.Id -Force
  $appProcess.WaitForExit()
  $appProcess = $null

  Stop-InstalledProcesses

  $uninstaller = Join-Path $installDir 'Uninstall Wavelength.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller not found: $uninstaller" }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)" }

  $deadline = (Get-Date).AddSeconds(15)
  while ((Test-Path -LiteralPath $exe) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $exe) { throw 'Installed executable remains after uninstall' }
  Write-Output 'installer-smoke ok'
} finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-InstalledProcesses
  Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
}
