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
$stateFile = Join-Path $scriptDir "watchdog.state"
$failedFile = Join-Path $scriptDir "watchdog.failed"
$maxFailures = 3

function Write-WatchdogLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    try { $line | Out-File -FilePath $logFile -Append -Encoding ascii } catch { }
}

# Reset the consecutive-failure counter after any healthy outcome.
function Reset-WatchdogState {
    try { Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue } catch { }
    try { Remove-Item -LiteralPath $failedFile -Force -ErrorAction SilentlyContinue } catch { }
}

# Record a failed recovery; returns the consecutive failure count. Escalates
# to a visible marker file after $maxFailures consecutive failures so a
# silently broken recovery cannot hide forever in the log.
function Add-WatchdogFailure {
    $count = 0
    try {
        if (Test-Path $stateFile) {
            $raw = [System.IO.File]::ReadAllText($stateFile)
            if ($raw -match '^\d+') { $count = [int]($raw -split "`r?`n")[0] }
        }
    } catch { }
    $count += 1
    try {
        [System.IO.File]::WriteAllText($stateFile, ($count.ToString() + "`n" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')), (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
    if ($count -ge $maxFailures) {
        try {
            [System.IO.File]::WriteAllText($failedFile, ("$count consecutive recovery failures - last at " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ". Manual intervention needed (see watchdog.log)`n"), (New-Object System.Text.UTF8Encoding($false)))
        } catch { }
        Write-WatchdogLog ("ESCALATE: $count consecutive recovery failures - watchdog.failed marker written")
    }
    return $count
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
    Reset-WatchdogState
    Write-WatchdogLog "OK: our harness (pid $owned) owns 127.0.0.1:3080"
    exit 0
}

# Our harness is down. If a FOREIGN process owns the port, restarting ours
# would fail to bind and could disturb the foreign service - log and stand
# down instead of fighting over the port.
$foreign = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($foreign) {
    $pids = ($foreign.OwningProcess | Sort-Object -Unique) -join ','
    Reset-WatchdogState
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
    Reset-WatchdogState
    Write-WatchdogLog "RECOVERED: our harness is up (pid $after)"
} else {
    $fails = Add-WatchdogFailure
    Write-WatchdogLog "NOT RECOVERED: harness still down after restart ($fails consecutive failure(s); see launcher harness_*.log)"
}
