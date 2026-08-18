# DeepSeek Harness Phone Remote - one-click deploy.
# Checks the environment, writes start_harness.ps1 from a template with the
# detected Tailscale values, enables Tailscale Serve (HTTPS), and prints the
# phone URLs. All comments are ASCII on purpose (PS 5.1 UTF-8 issue).
#
# Run: right-click "Run with PowerShell" or double-click 一键部署.cmd

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  DeepSeek Harness Phone Remote - One-Click Deploy" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. basic checks (auto-install what is missing) ----------
$winget = Get-Command winget -ErrorAction SilentlyContinue

$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
    if ($winget) {
        Write-Host "[...] Node.js not found - installing via winget (if a UAC prompt appears, click Yes)..." -ForegroundColor Yellow
        & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Host
        Start-Sleep -Seconds 3
        $node = "C:\Program Files\nodejs\node.exe"
    }
    if (-not (Test-Path $node)) {
        Write-Host "[X] Node.js still missing. Install it from https://nodejs.org , then re-run this script." -ForegroundColor Red
        exit 1
    }
}
# Validate the actual Node version: upstream DeepSeek Harness requires
# ^22.19.0 || >=24.0.0 (node --version, not just the executable existing).
$nodeVer = (& $node --version 2>$null | Out-String).Trim()
if ($nodeVer -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') {
    Write-Host "[X] Could not read the Node.js version from '$node'." -ForegroundColor Red
    exit 1
}
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
$nodeOk = ($major -eq 22 -and $minor -ge 19) -or ($major -ge 24)
if (-not $nodeOk) {
    Write-Host "[X] Node.js $nodeVer is not supported - DeepSeek Harness needs ^22.19.0 || >=24.0.0." -ForegroundColor Red
    Write-Host "    Install a supported version from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js found: $nodeVer (supported)"

# Tailscale: auto-install via winget when missing, then guide the one-time sign-in.
$tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if (-not $tsSvc -or $tsSvc.Status -ne "Running") {
    if ($winget) {
        Write-Host "[...] Tailscale not installed - installing via winget (if a UAC prompt appears, click Yes)..." -ForegroundColor Yellow
        & winget install --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Host
        Start-Sleep -Seconds 5
        $tsSvc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
        if ($tsSvc -and $tsSvc.Status -ne "Running") {
            Write-Host "[...] Starting the Tailscale service..."
            Start-Service -Name "Tailscale" -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        }
    }
    if (-not (Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue)) {
        Write-Host "[X] Tailscale could not be installed automatically. Install it from https://tailscale.com/download , then re-run this script." -ForegroundColor Red
        exit 1
    }
}
Write-Host "[OK] Tailscale service running"

# ---------- 2. read Tailscale identity (guide the one-time sign-in) ----------
$tsCli = "C:\Program Files\Tailscale\tailscale.exe"
$tsIP = ""
$tsName = ""
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
    Write-Host "  Tailscale needs a one-time sign-in (your own account)." -ForegroundColor Cyan
    Write-Host "  This step is always manual by design - nobody can do it for you." -ForegroundColor Cyan
    Write-Host "" -ForegroundColor Cyan
    Write-Host "  1) A browser page will open. Log in or register a free" -ForegroundColor White
    Write-Host "     Tailscale account (https://tailscale.com)." -ForegroundColor White
    Write-Host "  2) Then install the Tailscale app on your PHONE and log in" -ForegroundColor White
    Write-Host "     with the SAME account (App Store / Play Store: 'Tailscale')." -ForegroundColor White
    Write-Host "  3) Both devices must show as Connected." -ForegroundColor White
    Write-Host "===============================================================" -ForegroundColor Cyan
    Write-Host ""
    try { Start-Process "https://login.tailscale.com/start" } catch { }
    Read-Host "  Press ENTER after you have signed in on this PC"
    # Re-read BOTH the IP and the MagicDNS name after sign-in: the DNSName is
    # not available before the first login.
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
    Write-Host "[!] Still no Tailscale IP. Enter it manually (look in the Tailscale app):" -ForegroundColor Yellow
    $tsIP = Read-Host "    Tailscale IP (e.g. 100.x.y.z)"
}
# Never fabricate a DNS name: a trusted host entry must come from Tailscale
# itself (tailscale status --json / Self.DNSName). Without a real name the
# HTTPS trusted-host is simply omitted (the template handles an empty name).
if ($tsName -notmatch '\.ts\.net$') {
    Write-Host "[!] No valid Tailscale MagicDNS name - the HTTPS trusted-host will be skipped (HTTPS URL unavailable until signed in)." -ForegroundColor Yellow
    $tsName = ""
}
Write-Host "[OK] Tailscale IP: $tsIP"
Write-Host "[OK] MagicDNS name: $tsName"

# ---------- 3. write runtime files ----------
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$ws  = Join-Path $env:USERPROFILE "Documents"
# Shared helpers (Set-RemfsPatchRow, Get-VersionKey, ...) - single source of
# truth for the installer and the CI integration tests.
$commonHelper = Join-Path $src "harness-common.ps1"
if (Test-Path $commonHelper) { . $commonHelper }
if (-not (Get-Command Get-VersionKey -ErrorAction SilentlyContinue)) {
    Write-Host "[!] harness-common.ps1 missing Get-VersionKey - dsh resolution will use a fallback." -ForegroundColor Yellow
}
# Runtime scripts live OUTSIDE Documents so the phone file plugin can never
# rewrite its own launcher (Documents is the default allowed root).
$scriptDir = Join-Path $env:USERPROFILE ".dsh\launcher"
New-Item -ItemType Directory -Force -Path $scriptDir | Out-Null

foreach ($f in @("tailscale_forward.js", "restart_harness.ps1", "restart_harness_once.ps1", "stop_harness.ps1", "keep_awake.ps1", "harness-common.ps1", "refresh_pairing.ps1", "watchdog.ps1")) {
    if (Test-Path (Join-Path $src $f)) {
        Copy-Item (Join-Path $src $f) (Join-Path $scriptDir $f) -Force
    }
}

# ---------- 3a. register the self-healing watchdog (create or update) ----------
# Runs every 5 minutes as the current user with a hidden window. It checks
# that OUR dsh process owns 127.0.0.1:3080 (command-line verified, never a
# bare port) and restarts the harness headlessly when it is down. /f makes
# re-runs UPDATE the task instead of failing on "already exists".
$watchdogBin = Join-Path $scriptDir "watchdog.ps1"
if (Test-Path $watchdogBin) {
    $taskName = "dsh_harness_watchdog"
    $taskCmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogBin`""
    $regOut = (& schtasks /create /tn $taskName /tr $taskCmd /sc minute /mo 5 /f 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Watchdog scheduled task '$taskName' registered (every 5 minutes, hidden window)" -ForegroundColor Green
    } else {
        Write-Host "[!] Watchdog task registration failed (schtasks exit $LASTEXITCODE):" -ForegroundColor Yellow
        Write-Host "    $regOut" -ForegroundColor Yellow
        Write-Host "    Manual: schtasks /create /tn $taskName /tr `"$taskCmd`" /sc minute /mo 5 /f" -ForegroundColor Yellow
    }
} else {
    Write-Host "[!] watchdog.ps1 missing in $src - watchdog NOT registered" -ForegroundColor Yellow
}

# ---------- 3b. desktop shortcut (create or repair) ----------
# %USERPROFILE%\Desktop\DeepSeek Harness.lnk -> start_harness.ps1, hidden,
# no profile, bypass execution policy, working dir = Documents. CreateShortcut
# on an EXISTING .lnk + Save() UPDATES its target/arguments in place, so
# re-runs repair a stale or broken shortcut instead of duplicating it.
$launcherPs1 = Join-Path $scriptDir "start_harness.ps1"
if (Test-Path $launcherPs1) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop "DeepSeek Harness.lnk"
    try {
        $wsShell = New-Object -ComObject WScript.Shell
        $lnk = $wsShell.CreateShortcut($lnkPath)
        $lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPs1`""
        $lnk.WorkingDirectory = $ws
        $lnk.Description = "DeepSeek Harness phone remote"
        $lnk.Save()
        Write-Host "[OK] Desktop shortcut ready: $lnkPath" -ForegroundColor Green
    } catch {
        Write-Host "[!] Desktop shortcut could not be created: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[!] start_harness.ps1 missing - desktop shortcut skipped" -ForegroundColor Yellow
}

$template = Join-Path $src "start_harness.template.ps1"
if (Test-Path $template) {
    # Resolve the dsh entry DETERMINISTICALLY: several stale npx cache entries
    # can exist, so we NEVER pick the first arbitrary one. Every candidate's
    # package.json version is compared and the HIGHEST is chosen (verified to
    # actually contain lib\bin.js). The resolved version is recorded so the
    # user sees exactly which dsh build the launcher runs.
    function Get-DshCandidates {
        $list = @()
        $cacheRoots = @(
            (Join-Path $env:LOCALAPPDATA "npm-cache\_npx"),
            (Join-Path $env:APPDATA "npm-cache\_npx")
        )
        foreach ($cacheRoot in $cacheRoots) {
            $dirs = Get-ChildItem $cacheRoot -Directory -ErrorAction SilentlyContinue
            foreach ($c in $dirs) {
                $pkg = Join-Path $c.FullName "node_modules\@deepseek-ai\dsh\package.json"
                $bin = Join-Path $c.FullName "node_modules\@deepseek-ai\dsh\lib\bin.js"
                if ((Test-Path $pkg) -and (Test-Path $bin)) {
                    try {
                        $pj = Get-Content $pkg -Raw | ConvertFrom-Json
                        $list += [pscustomobject]@{ Version = [string]$pj.version; Bin = $bin }
                    } catch { }
                }
            }
        }
        return $list
    }
    $dshBin = ""
    $dshVersion = ""
    $cands = Get-DshCandidates
    if ($cands.Count -gt 0) {
        $best = $cands | Sort-Object -Property @{ Expression = { Get-VersionKey $_.Version } } -Descending | Select-Object -First 1
        $dshBin = $best.Bin
        $dshVersion = $best.Version
    }
    if (-not $dshBin) {
        Write-Host "[!] dsh entry not found under the npx cache; start_harness.ps1 will need a manual dshBin path." -ForegroundColor Yellow
    } else {
        Write-Host "[OK] dsh v$dshVersion resolved: $dshBin" -ForegroundColor Green
    }

    $content = Get-Content $template -Raw
    $content = $content -replace '__TSIP__', $tsIP
    $content = $content -replace '__WORKSPACE__', $ws
    $content = $content -replace '__DSHBIN__', $dshBin
    $content = $content -replace '__DSHVERSION__', $dshVersion
    $tsNameValid = ($tsName -match '\.ts\.net$')
    if ($tsNameValid) {
        $content = $content -replace '__TSNAME__', $tsName
    } else {
        $content = $content -replace ', "--trusted-host", "__TSNAME__"', ''
    }
    $content | Out-File -FilePath (Join-Path $scriptDir "start_harness.ps1") -Encoding ascii
    Write-Host "[OK] start_harness.ps1 written to $scriptDir (dsh v$dshVersion, trusted host: $tsIP)"
} else {
    Write-Host "[!] template missing: $template" -ForegroundColor Yellow
}

# ---------- 3b. install the persistent file plugin into the web profile ----------
$profileDir = Join-Path (Join-Path $env:USERPROFILE ".dsh") "profiles\web"
$pkgSrc = Join-Path $src "remfs-persistent"
if ((Test-Path $profileDir) -and (Test-Path $pkgSrc)) {
    # The patch-row logic (including MIGRATION of an existing row) lives in
    # harness-common.ps1 so install.ps1 and the CI real-dsh-smoke job share the
    # exact same source of truth - CI must test the REAL installer path.
    $commonHelper = Join-Path $src "harness-common.ps1"
    if (Test-Path $commonHelper) { . $commonHelper }

    $pkgDst = Join-Path $profileDir "vendor\remfs-persistent"
    # Copy the WHOLE package (lib/ is copied as a directory, so new lib modules
    # like security.js are never missed by a per-file list).
    New-Item -ItemType Directory -Force -Path $pkgDst | Out-Null
    Copy-Item (Join-Path $pkgSrc "package.json") (Join-Path $pkgDst "package.json") -Force
    Copy-Item (Join-Path $pkgSrc "lib") (Join-Path $pkgDst "lib") -Recurse -Force
    if (Test-Path (Join-Path $pkgSrc "README.md")) {
        Copy-Item (Join-Path $pkgSrc "README.md") (Join-Path $pkgDst "README.md") -Force
    }

    # Link (or copy) into the profile node_modules so the loader can resolve it.
    $nmPkg = Join-Path $profileDir "node_modules\@zetaluolang\remfs-persistent"
    New-Item -ItemType Directory -Force -Path (Split-Path $nmPkg) | Out-Null
    if (-not (Test-Path $nmPkg)) {
        New-Item -ItemType Junction -Path $nmPkg -Target $pkgDst -ErrorAction SilentlyContinue | Out-Null
        if (-not (Test-Path (Join-Path $nmPkg "package.json"))) {
            Copy-Item $pkgDst $nmPkg -Recurse -Force
        }
    }

    # Ensure the loader patch row exists with the exact four-service inject the
    # host half requires. Set-RemfsPatchRow MIGRATES an existing row (old
    # installs wrote `inject: [connection, fs]`) instead of leaving it stale.
    if (Get-Command Set-RemfsPatchRow -ErrorAction SilentlyContinue) {
        Set-RemfsPatchRow -ProfileDir $profileDir | Out-Null
        Write-Host "[OK] remfs-persistent loader row ensured (four-service inject, migrated if needed)"
    } else {
        Write-Host "[!] Set-RemfsPatchRow helper missing - skipping loader patch (re-run install.ps1)" -ForegroundColor Yellow
    }
    Write-Host "[OK] persistent plugin installed into the web profile"
} else {
    Write-Host "[!] web profile or remfs-persistent package missing - skip plugin install" -ForegroundColor Yellow
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

# ---------- 5. print phone URLs ----------
Write-Host ""
Write-Host "================== DONE ==================" -ForegroundColor Green
if ($tsName -match '\.ts\.net$') {
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
