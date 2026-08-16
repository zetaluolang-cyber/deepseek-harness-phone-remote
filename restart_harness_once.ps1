# One-shot harness restart, run DETACHED via Task Scheduler so it survives
# killing the harness (which would kill any child of my own command).
# SAFETY: nothing is killed until the plugin code is verified present
# (pre-flight). If anything is missing the script aborts and the running
# harness keeps serving. Only processes this project owns are ever killed.
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
$ErrorActionPreference = "Continue"

# Optional delay (seconds) before the kill, so the caller can finish talking
# before the harness goes away. Defaults to 0 (immediate).
$delay = 0
if ($args.Count -gt 0 -and $args[0] -match '^\d+$') { $delay = [int]$args[0] }
if ($delay -gt 0) { Start-Sleep -Seconds $delay }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$common = Join-Path $scriptDir "harness-common.ps1"
if (-not (Test-Path $common)) {
    "[$(Get-Date -Format o)] restart aborted: harness-common.ps1 missing - nothing killed" | Out-File -FilePath (Join-Path $env:TEMP "dsh_restart_fail.log") -Append -Encoding ascii
    Write-Host "harness-common.ps1 missing - aborting without killing anything"
    exit 2
}
. $common
if (-not (Get-Command Test-RemfsPluginReady -ErrorAction SilentlyContinue) -or
    -not (Get-Command Stop-OwnedHarnessStack -ErrorAction SilentlyContinue)) {
    "[$(Get-Date -Format o)] restart aborted: ownership helpers unavailable - nothing killed" | Out-File -FilePath (Join-Path $env:TEMP "dsh_restart_fail.log") -Append -Encoding ascii
    Write-Host "ownership helpers unavailable - aborting without killing anything"
    exit 2
}

$vendor = Join-Path $env:USERPROFILE ".dsh\profiles\web\vendor\remfs-persistent"
$nmPkg = Join-Path $env:USERPROFILE ".dsh\profiles\web\node_modules\@zetaluolang\remfs-persistent"
$failLog = Join-Path $env:TEMP "dsh_restart_fail.log"

# ---- PRE-FLIGHT: never kill anything if the new code cannot be deployed ----
if (-not (Test-RemfsPluginReady -Vendor $vendor -NmPkg $nmPkg)) {
    $msg = "[$(Get-Date -Format o)] restart aborted: plugin code incomplete (vendor or node_modules missing files) - old harness keeps running"
    $msg | Out-File -FilePath $failLog -Append -Encoding ascii
    Write-Host $msg
    exit 2
}

# Identify our harness marker and owned forwarder IP from the launcher itself.
$startScript = Join-Path $scriptDir "start_harness.ps1"
$marker = ""
$forwardIPs = @()
if (Test-Path $startScript) {
    $dshLine = Get-Content $startScript | Where-Object { $_ -match '^\$dshBin\s*=\s*"' } | Select-Object -First 1
    if ($dshLine -and $dshLine -match '"([^"]+)"') { $marker = $Matches[1] }
    $tsLine = Get-Content $startScript | Where-Object { $_ -match '^\$tailscaleIP\s*=\s*"' } | Select-Object -First 1
    if ($tsLine -and $tsLine -match '"([^"]+)"') { $forwardIPs += $Matches[1] }
}

# Kill only owned processes (harness + our Tailscale forwarder).
if ($marker -and (Get-Command Stop-OwnedHarnessStack -ErrorAction SilentlyContinue)) {
    Stop-OwnedHarnessStack -Marker $marker -ForwarderIPs $forwardIPs
} elseif ($marker) {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($marker)) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            }
        }
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 250
            $still = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
            if (-not $still) { break }
        }
    }
}

# Sync the plugin package while the old harness is dead and its file locks are
# released. If the sync fails, DO NOT launch a likely-broken harness.
if (-not (Sync-RemfsPlugin -Vendor $vendor -NmPkg $nmPkg)) {
    $msg = "[$(Get-Date -Format o)] restart aborted: plugin sync to node_modules failed - not launching"
    $msg | Out-File -FilePath $failLog -Append -Encoding ascii
    Write-Host $msg
    exit 2
}

# Unattended restart: never open a browser or a modal dialog. A stuck
# "Open with" chooser (observed 2026-08-17) blocked the whole restart chain:
# Task Scheduler keeps the task "Running" until the script exits.
$env:DSH_HEADLESS = "1"
& (Join-Path $scriptDir "start_harness.ps1")

# Post-start health check: confirm OUR harness is actually up.
Start-Sleep -Seconds 3
$hp = $null
if ($marker -and (Get-Command Get-OwnedHarnessPid -ErrorAction SilentlyContinue)) {
    $hp = Get-OwnedHarnessPid -Port 3080 -Marker $marker
}
if ($null -eq $hp) {
    $msg = "[$(Get-Date -Format o)] restart completed but our harness is not listening on 3080 (see launcher logs)"
    $msg | Out-File -FilePath $failLog -Append -Encoding ascii
    Write-Host $msg
}
