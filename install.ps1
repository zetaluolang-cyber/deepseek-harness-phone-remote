# DeepSeek Harness Phone Remote - one-click deploy.
# Checks the environment, writes start_harness.ps1 from a template with the
# detected Tailscale values, enables Tailscale Serve (HTTPS), and prints the
# phone URLs. All comments are ASCII on purpose (PS 5.1 UTF-8 issue).
#
# Run: right-click "Run with PowerShell" or double-click the deploy CMD.

param(
    # Primarily for release testing and controlled rollouts. Normal users leave
    # this empty and receive the current npm "latest" release.
    [string]$DshSpec = "",
    # CI-only isolation: no Tailscale, Startup entry, scheduled task, shortcut,
    # browser, or live process. The actual package/profile deployment still runs.
    [switch]$TestMode,
    [switch]$SkipLaunch
)

$ErrorActionPreference = "Stop"

function Resolve-CommandPath {
    param([string[]]$Candidates, [string]$CommandName)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }
    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return ""
}

function Test-SupportedNode {
    param([string]$Version)
    if ($Version -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { return $false }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    return (($major -eq 22 -and $minor -ge 19) -or ($major -ge 24))
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  DeepSeek Harness Phone Remote - One-Click Deploy" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. basic checks (auto-install what is missing) ----------
$winget = Get-Command winget -ErrorAction SilentlyContinue

$node = Resolve-CommandPath -Candidates @("C:\Program Files\nodejs\node.exe") -CommandName "node.exe"
if (-not $node) {
    if ($winget) {
        Write-Host "[...] Node.js not found - installing via winget (if a UAC prompt appears, click Yes)..." -ForegroundColor Yellow
        & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "winget could not install Node.js (exit $LASTEXITCODE)" }
        Start-Sleep -Seconds 3
        $node = Resolve-CommandPath -Candidates @("C:\Program Files\nodejs\node.exe") -CommandName "node.exe"
    }
    if (-not $node) {
        Write-Host "[X] Node.js still missing. Install it from https://nodejs.org , then re-run this script." -ForegroundColor Red
        exit 1
    }
}
# Validate the actual Node version: upstream DeepSeek Harness requires
# ^22.19.0 || >=24.0.0 (node --version, not just the executable existing).
$nodeVer = (& $node --version 2>$null | Out-String).Trim()
if (-not (Test-SupportedNode $nodeVer)) {
    if ($winget -and -not $TestMode) {
        Write-Host "[...] Node.js $nodeVer is too old - upgrading the LTS release via winget..." -ForegroundColor Yellow
        & winget upgrade --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Host
        Start-Sleep -Seconds 3
        $node = Resolve-CommandPath -Candidates @("C:\Program Files\nodejs\node.exe") -CommandName "node.exe"
        $nodeVer = (& $node --version 2>$null | Out-String).Trim()
    }
}
if (-not (Test-SupportedNode $nodeVer)) {
    Write-Host "[X] Node.js $nodeVer is not supported - DeepSeek Harness needs ^22.19.0 || >=24.0.0." -ForegroundColor Red
    Write-Host "    Install a supported version from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js found: $nodeVer (supported)"

$npm = Resolve-CommandPath -Candidates @((Join-Path (Split-Path $node) "npm.cmd"), "C:\Program Files\nodejs\npm.cmd") -CommandName "npm.cmd"
if (-not $npm) {
    Write-Host "[X] npm.cmd is missing next to Node.js. Repair the Node.js installation and re-run." -ForegroundColor Red
    exit 1
}

$tsIP = ""
$tsName = ""
if ($TestMode) {
    $tsIP = "100.64.0.1"
    Write-Host "[TEST] Tailscale installation and sign-in skipped"
} else {
    # Tailscale: auto-install via winget when missing, then use the actual CLI
    # login flow. Opening the admin website alone does not authenticate this PC.
    $tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    if (-not $tsSvc) {
        if (-not $winget) {
            Write-Host "[X] Tailscale is missing and winget is unavailable. Install Tailscale, then re-run." -ForegroundColor Red
            exit 1
        }
        Write-Host "[...] Tailscale not installed - installing via winget (if a UAC prompt appears, click Yes)..." -ForegroundColor Yellow
        & winget install --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "winget could not install Tailscale (exit $LASTEXITCODE)" }
        Start-Sleep -Seconds 5
        $tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    }
    if (-not $tsSvc) {
        Write-Host "[X] Tailscale could not be installed. Install it from https://tailscale.com/download and re-run." -ForegroundColor Red
        exit 1
    }
    if ($tsSvc.Status -ne "Running") {
        Write-Host "[...] Starting the Tailscale service..."
        Start-Service -Name "Tailscale"
        Start-Sleep -Seconds 3
        $tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
    }
    if (-not $tsSvc -or $tsSvc.Status -ne "Running") {
        Write-Host "[X] Tailscale service is not running." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Tailscale service running"

    # ---------- 2. read Tailscale identity (guide the one-time sign-in) ----------
    $tsCli = Resolve-CommandPath -Candidates @("C:\Program Files\Tailscale\tailscale.exe") -CommandName "tailscale.exe"
    if (-not $tsCli) { throw "Tailscale CLI not found after installation" }
    try {
        $tsIP = (& $tsCli ip -4 2>$null | Select-Object -First 1).Trim()
        $json = & $tsCli status --json 2>$null | Out-String
        if ($json) {
            $obj = $json | ConvertFrom-Json
            $tsName = ($obj.Self.DNSName -replace '\.$', '')
        }
    } catch { }
    if (-not $tsIP) {
        Write-Host ""
        Write-Host "===============================================================" -ForegroundColor Cyan
        Write-Host "  Tailscale needs a one-time sign-in for this PC." -ForegroundColor Cyan
        Write-Host "  Complete the login URL shown by the Tailscale CLI." -ForegroundColor White
        Write-Host "  Install Tailscale on the phone and use the same account." -ForegroundColor White
        Write-Host "===============================================================" -ForegroundColor Cyan
        Write-Host ""
        & $tsCli up
        if ($LASTEXITCODE -ne 0) { throw "tailscale up failed (exit $LASTEXITCODE)" }
        # Re-read BOTH the IP and MagicDNS name after this PC is authenticated.
        try {
            $tsIP = (& $tsCli ip -4 2>$null | Select-Object -First 1).Trim()
            $json = & $tsCli status --json 2>$null | Out-String
            if ($json) {
                $obj = $json | ConvertFrom-Json
                $tsName = ($obj.Self.DNSName -replace '\.$', '')
            }
        } catch { }
    }
    if (-not $tsIP) {
        Write-Host "[X] This PC is still not connected to Tailscale. Finish sign-in and re-run." -ForegroundColor Red
        exit 1
    }
}

# Never fabricate a DNS name: a trusted host entry must come from Tailscale
# itself (tailscale status --json / Self.DNSName). Without a real name the
# HTTPS trusted-host is simply omitted (the template handles an empty name).
if ($tsName -notmatch '\.ts\.net$') {
    if (-not $TestMode) {
        Write-Host "[!] No valid Tailscale MagicDNS name - HTTPS is unavailable until MagicDNS/certificates are enabled." -ForegroundColor Yellow
    }
    $tsName = ""
}
Write-Host "[OK] Tailscale IP: $tsIP"
if ($tsName) { Write-Host "[OK] MagicDNS name: $tsName" }

# ---------- 3. write runtime files ----------
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws  = Join-Path $env:USERPROFILE "Documents"
# Shared helpers (Set-RemfsPatchRow, Get-VersionKey, ...) - single source of
# truth for the installer and the CI integration tests.
$commonHelper = Join-Path $src "harness-common.ps1"
if (Test-Path $commonHelper) { . $commonHelper }
if (-not (Get-Command Set-RemfsPatchRow -ErrorAction SilentlyContinue)) {
    throw "harness-common.ps1 is missing required installer helpers"
}
# Runtime scripts live OUTSIDE Documents so the phone file plugin can never
# rewrite its own launcher (Documents is the default allowed root).
$dshRoot = Join-Path $env:USERPROFILE ".dsh"
$scriptDir = Join-Path $dshRoot "launcher"
$profileDir = Join-Path $dshRoot "profiles\web"
New-Item -ItemType Directory -Force -Path $scriptDir | Out-Null

# Stop only a stack previously deployed by this project before replacing files
# or updating its managed runtime. This releases plugin/native-module locks and
# safely migrates old npx-based launchers without touching foreign processes.
$launcherPs1 = Join-Path $scriptDir "start_harness.ps1"
if ((Test-Path $launcherPs1) -and (Get-Command Stop-OwnedHarnessStack -ErrorAction SilentlyContinue)) {
    $oldDshLine = Get-Content $launcherPs1 | Where-Object { $_ -match '^\$dshBin\s*=\s*"' } | Select-Object -First 1
    $oldTsLine = Get-Content $launcherPs1 | Where-Object { $_ -match '^\$tailscaleIP\s*=\s*"' } | Select-Object -First 1
    $oldMarker = ""
    $oldForwardIPs = @()
    if ($oldDshLine -and $oldDshLine -match '"([^"]+)"') { $oldMarker = $Matches[1] }
    if ($oldTsLine -and $oldTsLine -match '"([^"]+)"') { $oldForwardIPs += $Matches[1] }
    if ($oldMarker) { Stop-OwnedHarnessStack -Marker $oldMarker -ForwarderIPs $oldForwardIPs }
}

# ---------- 3a. install a project-owned DeepSeek Harness runtime ----------
# Never depend on an incidental npx cache entry. A private runtime is stable,
# works without admin rights, and gives launch/ownership checks one exact path.
$runtimeDir = Join-Path $dshRoot "runtime"
$dshPkgDir = Join-Path $runtimeDir "node_modules\@deepseek-ai\dsh"
$dshBin = Join-Path $dshPkgDir "lib\bin.js"
$dshPkgJson = Join-Path $dshPkgDir "package.json"
$requestedDsh = if ($DshSpec) { $DshSpec } elseif ($env:DSH_REMFS_DSH_SPEC) { $env:DSH_REMFS_DSH_SPEC } else { "@deepseek-ai/dsh@latest" }
$installDsh = (-not (Test-Path $dshBin)) -or (-not (Test-Path $dshPkgJson)) -or [bool]$DshSpec -or [bool]$env:DSH_REMFS_DSH_SPEC
if ($installDsh) {
    Write-Host "[...] Installing DeepSeek Harness runtime ($requestedDsh)..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    & $npm install --prefix $runtimeDir --no-audit --no-fund --save-exact $requestedDsh 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm could not install DeepSeek Harness (exit $LASTEXITCODE)" }
}
if (-not (Test-Path $dshBin) -or -not (Test-Path $dshPkgJson)) {
    throw "DeepSeek Harness installation is incomplete: $dshPkgDir"
}
$dshPackage = Get-Content $dshPkgJson -Raw | ConvertFrom-Json
$dshVersion = [string]$dshPackage.version
if (-not $dshVersion) { throw "DeepSeek Harness package has no version: $dshPkgJson" }
Write-Host "[OK] DeepSeek Harness v$dshVersion ready: $dshBin" -ForegroundColor Green

foreach ($f in @("tailscale_forward.js", "restart_harness.ps1", "restart_harness_once.ps1", "stop_harness.ps1", "keep_awake.ps1", "harness-common.ps1", "refresh_pairing.ps1", "watchdog.ps1")) {
    if (Test-Path (Join-Path $src $f)) {
        Copy-Item (Join-Path $src $f) (Join-Path $scriptDir $f) -Force
    }
}

# Orb widget (always-on-top presence ball): copied from scripts/ so the
# double-click launcher (start-orb-widget.cmd) works after deploy.
foreach ($f in @("orb-widget.ps1", "start-orb-widget.cmd")) {
    $widgetSrc = Join-Path $src "scripts\$f"
    if (Test-Path $widgetSrc) {
        Copy-Item $widgetSrc (Join-Path $scriptDir $f) -Force
    }
}

# Generate the launcher BEFORE creating anything that points to it. The old
# order guaranteed that every first install skipped the desktop shortcut.
$template = Join-Path $src "start_harness.template.ps1"
if (-not (Test-Path $template)) { throw "launcher template missing: $template" }
$content = Get-Content $template -Raw
$content = $content.Replace('__NODEBIN__', $node)
$content = $content.Replace('__TSIP__', $tsIP)
$content = $content.Replace('__WORKSPACE__', $ws)
$content = $content.Replace('__DSHBIN__', $dshBin)
$content = $content.Replace('__DSHVERSION__', $dshVersion)
if ($tsName -match '\.ts\.net$') {
    $content = $content.Replace('__TSNAME__', $tsName)
} else {
    $content = $content.Replace(', "--trusted-host", "__TSNAME__"', '')
    $content = $content.Replace('__TSNAME__', '')
}
# UTF-8 BOM is intentional: Windows PowerShell 5.1 needs the BOM to decode
# non-ASCII user/profile paths correctly. ASCII corrupted Chinese usernames.
$utf8Bom = New-Object System.Text.UTF8Encoding -ArgumentList $true
[System.IO.File]::WriteAllText($launcherPs1, $content, $utf8Bom)
if (-not (Test-Path $launcherPs1)) { throw "launcher was not written: $launcherPs1" }
Write-Host "[OK] launcher written (dsh v$dshVersion, trusted host: $tsIP)"

# ---------- 3b. install the persistent file plugin into the web profile ----------
$pkgSrc = Join-Path $src "remfs-persistent"
if (-not (Test-Path $pkgSrc)) { throw "remfs-persistent package missing: $pkgSrc" }

# A brand-new user has no profile yet. Create it instead of silently skipping
# the core product, then deploy both the immutable vendor source and loader copy.
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$pkgDst = Join-Path $profileDir "vendor\remfs-persistent"
New-Item -ItemType Directory -Force -Path (Join-Path $pkgDst "lib") | Out-Null
Copy-Item (Join-Path $pkgSrc "package.json") (Join-Path $pkgDst "package.json") -Force
Copy-Item (Join-Path $pkgSrc "lib\*") (Join-Path $pkgDst "lib") -Recurse -Force
if (Test-Path (Join-Path $pkgSrc "README.md")) {
    Copy-Item (Join-Path $pkgSrc "README.md") (Join-Path $pkgDst "README.md") -Force
}

$nmPkg = Join-Path $profileDir "node_modules\@zetaluolang\remfs-persistent"
New-Item -ItemType Directory -Force -Path $nmPkg | Out-Null
if (-not (Sync-RemfsPlugin -Vendor $pkgDst -NmPkg $nmPkg)) {
    throw "persistent plugin could not be synchronized into the web profile"
}
Set-RemfsPatchRow -ProfileDir $profileDir | Out-Null
Write-Host "[OK] persistent plugin installed into a ready web profile" -ForegroundColor Green

# Register user-facing/system integration only after the core deployment is
# complete, so a broken package/profile never gets a shortcut claiming success.
if (-not $TestMode) {
    # Orb widget auto-start at logon. It is the daily status/control surface;
    # installation success never depends on the widget.
    $orbBin = Join-Path $scriptDir "orb-widget.ps1"
    if (Test-Path $orbBin) {
        $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
        New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
        $startupCmd = "@echo off`r`n" +
            "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$orbBin`""
        Set-Content -Path (Join-Path $startupDir "dsh-orb-widget.cmd") -Value $startupCmd -Encoding ASCII
        Write-Host "[OK] orb widget auto-start registered" -ForegroundColor Green
    }

    # Register/update the self-healing watchdog.
    $watchdogBin = Join-Path $scriptDir "watchdog.ps1"
    if (Test-Path $watchdogBin) {
        $taskName = "dsh_harness_watchdog"
        $taskCmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogBin`""
        $regOut = (& schtasks /create /tn $taskName /tr $taskCmd /sc minute /mo 5 /f 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] watchdog registered (every 5 minutes)" -ForegroundColor Green
        } else {
            Write-Host "[!] Watchdog task registration failed (non-fatal): $regOut" -ForegroundColor Yellow
        }
    }

    # Create/repair the desktop shortcut only after the target exists.
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop "DeepSeek Harness.lnk"
    $wsShell = New-Object -ComObject WScript.Shell
    $lnk = $wsShell.CreateShortcut($lnkPath)
    $lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPs1`""
    $lnk.WorkingDirectory = $ws
    $lnk.Description = "DeepSeek Harness phone remote"
    $lnk.Save()
    if (-not (Test-Path $lnkPath)) { throw "desktop shortcut was not created: $lnkPath" }
    Write-Host "[OK] Desktop shortcut ready: $lnkPath" -ForegroundColor Green
}

# ---------- 4. Tailscale Serve (HTTPS) is OWNED BY THE LAUNCHER ----------
# Tailscale Serve --bg persists until explicitly disabled and resumes after
# reboot/Tailscale restart. Enabling it here at install time (before the
# harness is even started) could map a FOREIGN process on 127.0.0.1:3080 into
# the tailnet. The launcher therefore enables/verifies Serve ONLY after OUR dsh
# process is confirmed to own :3080, disables ONLY this project's mapping on
# stop, and re-enables on start. We never wipe the whole serve config (it
# would destroy unrelated user Serve config).
Write-Host ""
Write-Host "[...] Tailscale Serve (HTTPS) is managed by the launcher: it is enabled only when the DeepSeek Harness process owns :3080, and disabled on stop (only this project's mapping)." -ForegroundColor Yellow
Write-Host "    If 'HTTPS Certificates' is not yet enabled for your tailnet, enable it at https://login.tailscale.com/admin/dns and the launcher will pick it up automatically." -ForegroundColor Yellow

# ---------- 5. launch and prove the deployed stack ----------
$httpsReady = $false
if (-not $TestMode -and -not $SkipLaunch) {
    Write-Host "[...] Starting DeepSeek Harness and verifying the deployment..." -ForegroundColor Yellow
    $oldHeadless = $env:DSH_HEADLESS
    try {
        $env:DSH_HEADLESS = "1"
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcherPs1
        if ($LASTEXITCODE -ne 0) { throw "launcher failed (exit $LASTEXITCODE); inspect $scriptDir" }
    } finally {
        $env:DSH_HEADLESS = $oldHeadless
    }

    $homeCheck = Invoke-WebRequest -Uri "http://127.0.0.1:3080/" -UseBasicParsing -TimeoutSec 10
    if ($homeCheck.StatusCode -lt 200 -or $homeCheck.StatusCode -ge 400) {
        throw "Harness health check returned HTTP $($homeCheck.StatusCode)"
    }
    $forwarderPid = Get-OwnedForwarderPid -ListenIP $tsIP -Port 3080
    if (-not $forwarderPid) { throw "owned phone forwarder is not listening on $tsIP`:3080" }
    $phoneCheck = Invoke-WebRequest -Uri "http://$tsIP`:3080/" -UseBasicParsing -TimeoutSec 10
    if ($phoneCheck.StatusCode -lt 200 -or $phoneCheck.StatusCode -ge 400) {
        throw "phone-path health check returned HTTP $($phoneCheck.StatusCode)"
    }
    try {
        $pluginCheck = Invoke-WebRequest -Uri "http://127.0.0.1:3080/remfs-presence.json" -UseBasicParsing -TimeoutSec 10
        if ($pluginCheck.StatusCode -eq 404) { throw "plugin route returned 404" }
    } catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        # pocketStrict may intentionally require authentication. That still
        # proves the plugin route exists; 404 or transport errors do not.
        if ($status -ne 401 -and $status -ne 403) { throw }
    }
    if ($tsName -match '\.ts\.net$') {
        $httpsReady = Test-OwnedServeMapping
    }
    Write-Host "[OK] live health check passed (Harness + remfs route + phone forwarder)" -ForegroundColor Green
}

# ---------- 6. print phone URLs ----------
Write-Host ""
Write-Host "================== DONE ==================" -ForegroundColor Green
if ($httpsReady -and $tsName -match '\.ts\.net$') {
    Write-Host "Phone URL (recommended):" -ForegroundColor Green
    Write-Host "   https://$tsName" -ForegroundColor White
} else {
    Write-Host "Phone URL (recommended):" -ForegroundColor Green
    Write-Host "   (HTTPS unavailable - no Tailscale MagicDNS name; enable HTTPS Certificates in the tailnet and re-run, or use the fallback below)" -ForegroundColor Yellow
}
Write-Host "Fallback (plain HTTP):" -ForegroundColor Green
Write-Host "   http://$tsIP`:3080" -ForegroundColor White
Write-Host ""
Write-Host "Phone: 1) Tailscale app -> Connected. 2) Open the URL in the browser." -ForegroundColor Yellow
Write-Host "PC daily: double-click the 'DeepSeek Harness' desktop shortcut." -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
if (-not $TestMode -and -not $SkipLaunch) {
    Start-Process "http://127.0.0.1:3080/"
}
