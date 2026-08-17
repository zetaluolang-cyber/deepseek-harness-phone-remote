# watchdog.ps1 - self-healing watchdog for the DeepSeek Harness remote stack.
# Registered by install.ps1 as the scheduled task "dsh_harness_watchdog"
# (every 5 minutes, current user, hidden window; re-running install.ps1
# updates the task instead of duplicating it).
#
# Rules (same ownership discipline as the rest of the launcher):
#   - "port 3080 is listening" is NEVER enough: only a process whose command
#     line contains the deployed dsh bin path counts as our harness
#     (Get-OwnedHarnessPid from harness-common.ps1).
#   - A FOREIGN process on 127.0.0.1:3080 is never killed and never restarted
#     over: we log the conflict and stand down.
#   - When our harness is down, restart it headlessly via
#     restart_harness_once.ps1 (DSH_HEADLESS=1: no browser, no dialogs) and
#     append every step to watchdog.log.
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.
$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$common = Join-Path $scriptDir "harness-common.ps1"
$logFile = Join-Path $scriptDir "watchdog.log"
$restartBin = Join-Path $scriptDir "restart_harness_once.ps1"

function Write-WatchdogLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    try { $line | Out-File -FilePath $logFile -Append -Encoding ascii } catch { }
}

if (-not (Test-Path $common)) {
    Write-WatchdogLog "FATAL: harness-common.ps1 missing - ownership cannot be verified; nothing done"
    exit 1
}
. $common
if (-not (Get-Command Get-OwnedHarnessPid -ErrorAction SilentlyContinue)) {
    Write-WatchdogLog "FATAL: ownership helpers unavailable - nothing done"
    exit 1
}
if (-not (Test-Path $restartBin)) {
    Write-WatchdogLog "FATAL: restart_harness_once.ps1 missing - cannot self-heal"
    exit 1
}

# Our harness marker comes from the launcher's own dshBin line (single source
# of truth: whatever start_harness.ps1 launches is what we verify/restart).
$startScript = Join-Path $scriptDir "start_harness.ps1"
$marker = ""
if (Test-Path $startScript) {
    $dshLine = Get-Content $startScript | Where-Object { $_ -match '^\$dshBin\s*=\s*"' } | Select-Object -First 1
    if ($dshLine -and $dshLine -match '"([^"]+)"') { $marker = $Matches[1] }
}
if (-not $marker) {
    Write-WatchdogLog "FATAL: dshBin marker not found in start_harness.ps1 - nothing done"
    exit 1
}

$owned = Get-OwnedHarnessPid -Port 3080 -Marker $marker
if ($null -ne $owned) {
    Write-WatchdogLog "OK: our harness (pid $owned) owns 127.0.0.1:3080"
    exit 0
}

# Our harness is down. If a FOREIGN process owns the port, restarting ours
# would fail to bind and could disturb the foreign service - log and stand
# down instead of fighting over the port.
$foreign = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($foreign) {
    $pids = ($foreign.OwningProcess | Sort-Object -Unique) -join ','
    Write-WatchdogLog "WARN: 127.0.0.1:3080 is listening but NOT ours (foreign pid(s): $pids) - standing down"
    exit 0
}

Write-WatchdogLog "our harness is DOWN - restarting headlessly via restart_harness_once.ps1"
$env:DSH_HEADLESS = "1"
try {
    & $restartBin *>&1 | ForEach-Object {
        $s = ($_ | Out-String).Trim()
        if ($s) { Write-WatchdogLog $s }
    }
} catch {
    Write-WatchdogLog ("restart threw: " + $_.Exception.Message)
}
Start-Sleep -Seconds 3
$after = Get-OwnedHarnessPid -Port 3080 -Marker $marker
if ($null -ne $after) {
    Write-WatchdogLog "RECOVERED: our harness is up (pid $after)"
} else {
    Write-WatchdogLog "NOT RECOVERED: harness still down after restart (see launcher harness_*.log)"
}
