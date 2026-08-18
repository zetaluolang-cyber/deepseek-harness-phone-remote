# archive-sessions.ps1 - move oversized dsh sessions out of the live profile.
# The harness loads whole sessions into memory and checkpoints them, so a very
# long session both bloats RAM and makes every start slower. This script moves
# sessions above a size threshold to ~/.dsh/sessions-archive\<date>\ and removes
# their references from the dsh storages (after backing them up). Nothing is
# ever deleted.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\archive-sessions.ps1 [-ThresholdMB 10] [-WhatIf] [-Force]
#
# Safety:
#   - Refuses to run while anything listens on 127.0.0.1:3080 (moving files of
#     a live harness can corrupt its next checkpoint) unless -Force.
#   - Registry files are copied to ~/.dsh\backup-archive-<ts>\ before editing.
#   - -WhatIf prints what would be moved without changing anything.
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

param(
    [int]$ThresholdMB = 10,
    [switch]$WhatIf,
    [switch]$Force
)

$ErrorActionPreference = "Continue"

$dshHome = Join-Path $env:USERPROFILE ".dsh"
$sessionsRoot = Join-Path $dshHome "sessions"
$archiveRoot = Join-Path $dshHome "sessions-archive"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$threshold = $ThresholdMB * 1MB

if (-not (Test-Path $sessionsRoot)) {
    Write-Host "[X] sessions root not found: $sessionsRoot"
    exit 1
}

# Refuse while a harness may be running (unless forced or a read-only preview).
# Get-NetTCPConnection can return nothing even when the port is up (observed on
# some systems), so netstat is used as a reliable fallback - either one wins.
if (-not $WhatIf -and -not $Force) {
    $listener = $null
    try {
        $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
    } catch { }
    if (-not $listener) {
        $netstatLine = netstat -ano | Select-String "127\.0\.0\.1:3080\s+.*LISTENING"
        if ($netstatLine) { $listener = $netstatLine }
    }
    if ($listener) {
        Write-Host "[X] 127.0.0.1:3080 is listening - stop the harness first (stop_harness.ps1) or pass -Force. Nothing was changed."
        exit 1
    }
}

$candidates = @()
Get-ChildItem -LiteralPath $sessionsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $ws = $_
    Get-ChildItem -LiteralPath $ws.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "session-*" } | ForEach-Object {
        $log = Join-Path $_.FullName "session.jsonl.zstd"
        if (Test-Path $log) {
            $size = (Get-Item $log).Length
            if ($size -gt $threshold) {
                $candidates += [pscustomobject]@{
                    SessionDir = $_.FullName
                    Id = $_.Name
                    WorkspaceKey = $ws.Name
                    MB = [math]::Round($size / 1MB, 1)
                }
            }
        }
    }
}

if ($candidates.Count -eq 0) {
    Write-Host "[OK] no session larger than $ThresholdMB MB - nothing to archive."
    exit 0
}

Write-Host ("[..] {0} session(s) over {1} MB:" -f $candidates.Count, $ThresholdMB)
$candidates | ForEach-Object { Write-Host ("     {0}  ({1} MB)  {2}" -f $_.Id, $_.MB, $_.WorkspaceKey) }

if ($WhatIf) {
    Write-Host "[WhatIf] would move the above to $archiveRoot\$stamp and update dsh storages. Nothing changed."
    exit 0
}

$destRoot = Join-Path $archiveRoot $stamp
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
$movedIds = @()
foreach ($c in $candidates) {
    $dest = Join-Path $destRoot $c.Id
    if (Test-Path $dest) { $dest = Join-Path $destRoot ($c.Id + "-" + $stamp) }
    Move-Item -LiteralPath $c.SessionDir -Destination $dest -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $dest "session.jsonl.zstd")) {
        $movedIds += $c.Id
        Write-Host ("[OK] moved {0} -> {1}" -f $c.Id, $dest)
    } else {
        Write-Host ("[!] failed to move {0}" -f $c.Id)
    }
}

if ($movedIds.Count -eq 0) { exit 1 }

# Back up the registries, then remove the archived session references.
$backupDir = Join-Path $dshHome ("backup-archive-" + $stamp)
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
foreach ($reg in @("workspace.json", "session_projcache.json", "message_feedback.json")) {
    $src = Join-Path $dshHome ("storages\" + $reg)
    if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $backupDir $reg) -Force }
}

$wsFile = Join-Path $dshHome "storages\workspace.json"
if (Test-Path $wsFile) {
    $ws = Get-Content -LiteralPath $wsFile -Encoding UTF8 -Raw | ConvertFrom-Json
    foreach ($w in $ws.tables.workspaces.PSObject.Properties) {
        $w.Value.sessionIds = @($w.Value.sessionIds | Where-Object { $movedIds -notcontains $_ })
    }
    $ws | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $wsFile -Encoding UTF8
}

$pcFile = Join-Path $dshHome "storages\session_projcache.json"
if (Test-Path $pcFile) {
    $pc = Get-Content -LiteralPath $pcFile -Encoding UTF8 -Raw | ConvertFrom-Json
    foreach ($id in $movedIds) { $pc.tables.sessions.PSObject.Properties.Remove($id) }
    $pc | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $pcFile -Encoding UTF8
}

$mfFile = Join-Path $dshHome "storages\message_feedback.json"
if (Test-Path $mfFile) {
    $mf = Get-Content -LiteralPath $mfFile -Encoding UTF8 -Raw | ConvertFrom-Json
    foreach ($id in $movedIds) { $mf.tables.sessions.PSObject.Properties.Remove($id) }
    $mf | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $mfFile -Encoding UTF8
}

Write-Host ("[OK] archived {0} session(s); registry backup in {1}" -f $movedIds.Count, $backupDir)