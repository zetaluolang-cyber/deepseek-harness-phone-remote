# Clean-user one-click deployment integration test.
# Runs the real install.ps1 against an isolated USERPROFILE and an offline fake
# DSH npm package. System integration and process launch are skipped, but the
# actual npm runtime install, profile creation, plugin copy, patch, and launcher
# generation paths are exercised twice (fresh install + idempotent re-run).
# Windows PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"
trap { Write-Host "FATAL (uncaught): $_"; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("remfs-clean-install-" + [guid]::NewGuid().ToString("N"))
$fakePkg = Join-Path $tmp "fake-dsh"
$fakeLib = Join-Path $fakePkg "lib"
$unicodeUser = ([char]0x6D4B).ToString() + ([char]0x8BD5).ToString() + " user"
$fakeUser = Join-Path $tmp $unicodeUser
$oldUserProfile = $env:USERPROFILE
$oldNpmCache = $env:npm_config_cache

try {
    New-Item -ItemType Directory -Force -Path $fakeLib | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fakeUser "Documents") | Out-Null
    @'
{
  "name": "@deepseek-ai/dsh",
  "version": "9.9.9-test",
  "type": "module",
  "bin": { "dsh": "lib/bin.js" }
}
'@ | Set-Content -LiteralPath (Join-Path $fakePkg "package.json") -Encoding ASCII
    @'
#!/usr/bin/env node
console.log('fake dsh fixture')
'@ | Set-Content -LiteralPath (Join-Path $fakeLib "bin.js") -Encoding ASCII

    $env:USERPROFILE = $fakeUser
    $env:npm_config_cache = Join-Path $tmp "npm-cache"

    for ($pass = 1; $pass -le 2; $pass++) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "install.ps1") `
            -TestMode -SkipLaunch -DshSpec $fakePkg
        if ($LASTEXITCODE -ne 0) {
            Write-Error "clean install pass $pass failed with exit $LASTEXITCODE"
            exit 1
        }
    }

    $dshRoot = Join-Path $fakeUser ".dsh"
    $required = @(
        "runtime\node_modules\@deepseek-ai\dsh\lib\bin.js",
        "profiles\web\vendor\remfs-persistent\lib\security.js",
        "profiles\web\node_modules\@zetaluolang\remfs-persistent\lib\security.js",
        "profiles\web\cordis.patch.yml",
        "launcher\start_harness.ps1"
    )
    foreach ($rel in $required) {
        if (-not (Test-Path (Join-Path $dshRoot $rel))) {
            Write-Error "clean install missing $rel"
            exit 1
        }
    }

    $launcher = Get-Content (Join-Path $dshRoot "launcher\start_harness.ps1") -Raw
    if ($launcher -match '__[A-Z]+__') {
        Write-Error "generated launcher still contains a placeholder"
        exit 1
    }
    if ($launcher -notmatch '\$dshVersion\s*=\s*"9\.9\.9-test"') {
        Write-Error "generated launcher did not record the installed DSH version"
        exit 1
    }
    if (-not $launcher.Contains($fakeUser)) {
        Write-Error "generated launcher corrupted the non-ASCII user profile path"
        exit 1
    }

    $patch = Get-Content (Join-Path $dshRoot "profiles\web\cordis.patch.yml") -Raw
    $rows = [regex]::Matches($patch, "id:\s*remfs-persistent")
    if ($rows.Count -ne 1) {
        Write-Error "installer is not idempotent: expected one remfs row, got $($rows.Count)"
        exit 1
    }
    if ($patch -notmatch "inject:\s*\[connection,\s*fs,\s*sandboxPolicy,\s*workspaceRegistry\]") {
        Write-Error "clean install patch is missing the required four-service inject"
        exit 1
    }

    Write-Host "clean one-click install: OK (fresh profile + private DSH + idempotent re-run)"
} finally {
    $env:USERPROFILE = $oldUserProfile
    $env:npm_config_cache = $oldNpmCache
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
