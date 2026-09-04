<#
.SYNOPSIS
  Local, isolated end-to-end test of the auto-update install UX (#498 / #543).

.DESCRIPTION
  Builds two throwaway "MonkySandbox" builds (v0.0.1 and v0.0.2) from the current
  source, installs v0.0.1, then launches it so it updates itself to v0.0.2 the
  exact way a real Windows auto-update does. You get to watch the full sequence
  with NO blank gap:

    1) the "Instalando ..." splash (app-side, before quitting),
    2) the NSIS installer's own progress window during the file replacement
       (this is the fix: it replaces the old blank/white-icon screen), and
    3) the "Abrindo o Monky ..." splash, then the app itself running v0.0.2.

  Everything runs under an isolated app id / product name, so it can never
  touch or upgrade a real Monky install. The update install is driven the same
  way electron-updater's quitAndInstall(false, true) drives it (non-silent
  oneClick installer + --force-run relaunch), via the MONKY_SIM_UPDATE=nsis
  test hook in main.ts.

.PARAMETER Rebuild
  Force a fresh client build and repackage of both installers, even if the
  installer files already exist.

.PARAMETER Clean
  Uninstall the isolated MonkySandbox build and delete test artifacts, then exit.

.PARAMETER NoPrompt
  Skip the "press Enter to start" pause (for unattended validation runs).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\test-update-local.ps1
#>
param(
  [switch]$Rebuild,
  [switch]$Clean,
  [switch]$NoPrompt,
  [switch]$PrepOnly,
  [switch]$LaunchOnly
)

$ErrorActionPreference = 'Stop'

$repo       = Split-Path -Parent $PSScriptRoot
$client     = Join-Path $repo 'apps\client'
$outDir     = Join-Path $repo 'release\sandbox'
$appId      = 'org.monky.sandbox'
$product    = 'MonkySandbox'
$v1         = '0.0.1'
$v2         = '0.0.2'
$installer1 = Join-Path $outDir "$product-Setup-$v1.exe"
$installer2 = Join-Path $outDir "$product-Setup-$v2.exe"
$exeName    = "$product.exe"

function Find-InstalledExe {
  # The install folder is derived from the package name, but the exe keeps the
  # productName — so locate the install by the unique exe name, which no real
  # Monky (Monky.exe) shares.
  Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Depth 2 -Filter $exeName -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Stop-Isolated {
  Get-Process -Name $product -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Uninstall-Isolated {
  Stop-Isolated
  $exe = Find-InstalledExe
  if ($exe) {
    $dir = Split-Path -Parent $exe
    $u = Join-Path $dir "Uninstall $product.exe"
    if (Test-Path $u) {
      Write-Host "Uninstalling $product ..." -ForegroundColor Yellow
      Start-Process -FilePath $u -ArgumentList '/S' -Wait
      Start-Sleep -Seconds 4
    }
    Stop-Isolated
    if (Test-Path $dir) {
      Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
    }
  }
}

if ($Clean) {
  Uninstall-Isolated
  if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
  Write-Host "Cleaned isolated MonkySandbox build and artifacts." -ForegroundColor Green
  return
}

# Local, unsigned builds: never try to auto-discover a signing identity.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

# 1. Build the two isolated installers (skip if already present).
if (-not $LaunchOnly -and ($Rebuild -or -not (Test-Path $installer1) -or -not (Test-Path $installer2))) {
  Write-Host "Building client ..." -ForegroundColor Cyan
  Push-Location $repo
  try { npm run build --workspace=apps/client } finally { Pop-Location }

  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Push-Location $client
  try {
    foreach ($v in @($v1, $v2)) {
      Write-Host "Packaging isolated $product v$v (real oneClick config) ..." -ForegroundColor Cyan
      npx electron-builder --win nsis `
        --config.appId=$appId `
        --config.productName=$product `
        --config.extraMetadata.name=monky-sandbox `
        --config.extraMetadata.version=$v `
        --config.nsis.artifactName="$product-Setup-$v.exe" `
        --config.directories.output="$outDir" `
        --publish never
      if ($LASTEXITCODE -ne 0) { throw "electron-builder failed for v$v (exit $LASTEXITCODE)" }
    }
  } finally { Pop-Location }
}

if (-not (Test-Path $installer2)) { throw "Missing update installer: $installer2" }

# 2. Install the base v1 silently (clean slate first). Skipped in -LaunchOnly.
if (-not $LaunchOnly) {
  if (-not (Test-Path $installer1)) { throw "Missing base installer: $installer1" }
  Uninstall-Isolated
  Write-Host "Installing base $product v$v1 (silent) ..." -ForegroundColor Cyan
  Start-Process -FilePath $installer1 -ArgumentList '/S' -Wait
  Start-Sleep -Seconds 8           # oneClick auto-launches the app after install
  Stop-Isolated                    # close that auto-launched copy
  Start-Sleep -Seconds 2
}

$exePath = Find-InstalledExe
if (-not $exePath) { throw "Base $product not installed: run without -LaunchOnly first" }
Write-Host "Base installed at: $(Split-Path -Parent $exePath)" -ForegroundColor DarkGray

if ($PrepOnly) {
  $pkgPrep = Join-Path (Split-Path -Parent $exePath) 'resources\app\package.json'
  $verPrep = if (Test-Path $pkgPrep) { (Get-Content $pkgPrep -Raw | ConvertFrom-Json).version } else { '?' }
  Write-Host "Prep done: base $product v$verPrep installed and ready. Re-run with -LaunchOnly to watch the update." -ForegroundColor Green
  return
}

# 3. Launch v1 in the nsis test mode so it updates itself to v2 on screen.
if ($LaunchOnly) {
  Stop-Isolated                  # ensure no stale copy holds the single-instance lock
  Start-Sleep -Seconds 1
  $curPkg = Join-Path (Split-Path -Parent $exePath) 'resources\app\package.json'
  $curVer = if (Test-Path $curPkg) { (Get-Content $curPkg -Raw | ConvertFrom-Json).version } else { '?' }
  if ($curVer -ne $v1) {
    Write-Host "WARNING: installed version is $curVer, not $v1. Run -PrepOnly for a clean v$v1 -> v$v2 test." -ForegroundColor Yellow
  }
}
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " READY. Launching $product v$v1; watch it auto-update to v$v2." -ForegroundColor Green
Write-Host " Expected on screen, with NO blank gap between them:" -ForegroundColor Green
Write-Host "   1) 'Instalando ...' splash" -ForegroundColor Green
Write-Host "   2) NSIS installer progress window  <-- the fix" -ForegroundColor Green
Write-Host "   3) 'Abrindo o Monky ...' splash, then the app (v$v2)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
if (-not $NoPrompt) { Read-Host "Press Enter to start" | Out-Null }
if ($LaunchOnly) { Write-Host " Starting in 5s - look at the screen now ..." -ForegroundColor Green; Start-Sleep -Seconds 5 }

$env:MONKY_SIM_UPDATE    = 'nsis'
$env:MONKY_SIM_INSTALLER = $installer2
$env:MONKY_SIM_TARGET    = $v2
try {
  Start-Process -FilePath $exePath
} finally {
  Remove-Item Env:MONKY_SIM_UPDATE, Env:MONKY_SIM_INSTALLER, Env:MONKY_SIM_TARGET -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Launched. Watch the sequence now (takes ~30-60s for the install)." -ForegroundColor Cyan
Start-Sleep -Seconds 90

# 4. Report the resulting installed version.
$exeAfter = Find-InstalledExe
$pkg = if ($exeAfter) { Join-Path (Split-Path -Parent $exeAfter) 'resources\app\package.json' } else { $null }
if ($pkg -and (Test-Path $pkg)) {
  $ver = (Get-Content $pkg -Raw | ConvertFrom-Json).version
  $ok  = $ver -eq $v2
  Write-Host ("Installed version is now: {0} (expected {1}) -> {2}" -f $ver, $v2, ($(if ($ok) {'OK'} else {'MISMATCH'}))) `
    -ForegroundColor $(if ($ok) {'Green'} else {'Red'})
} else {
  Write-Host "Could not locate the installed package.json to confirm the version." -ForegroundColor Red
}
Write-Host "Done. Re-run with -Clean to remove the isolated MonkySandbox build." -ForegroundColor Yellow
