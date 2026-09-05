# Orb state-decision regression test (bug-fix pass, items 2.2/2.3/2.5).
# Drives scripts/orb-state.ps1 - the PURE poll-to-display decision module that
# scripts/orb-widget.ps1 dot-sources. No UI, no network, no filesystem: every
# call is deterministic because NowMs is injected.
#
# Covers:
#   - fresh cached snapshot      -> live task state is shown
#   - snapshot stamp frozen      -> cacheStale flag (task state NOT shown)
#   - 401/403                    -> explicit unauthorized state
#   - redacted body + token sent -> unauthorized (non-strict mode answers 200)
#   - transport failure          -> offline state, distinct from unauthorized
#   - toast gate                 -> same state twice never re-toasts;
#                                   NEEDS_USER->FAILED toasts;
#                                   FAILED->RUNNING never toasts
#   - task selection             -> lowest priority wins, count preserved
#
# Windows PowerShell 5.1 compatible, plain ASCII (no BOM). Run from the repo
# root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File test\orb-state.test.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

. (Join-Path $root "scripts\orb-state.ps1")
if (-not (Get-Command Resolve-OrbPoll -ErrorAction SilentlyContinue)) {
    Write-Error "Resolve-OrbPoll not defined (scripts\orb-state.ps1 missing?)"
    exit 1
}

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

# A 200 envelope with one task plus an optional top-level cachedAt stamp.
function New-PresenceBody {
    param(
        [string]$State = 'RUNNING',
        [string]$Title = 'Task A',
        [string]$Summary = 'working',
        [int]$UpdatedAt = 100,
        [object]$CachedAt = $null
    )
    $value = [pscustomobject]@{
        tasks = @([pscustomobject]@{
            taskId = 's1'
            sessionId = 's1'
            state = $State
            title = $Title
            summary = $Summary
            updatedAt = $UpdatedAt
            staleReason = $null
        })
    }
    if ($null -eq $CachedAt) {
        return [pscustomobject]@{ ok = $true; value = $value }
    }
    return [pscustomobject]@{ ok = $true; cachedAt = $CachedAt; value = $value }
}

$cfg = @{ pollIntervalSec = 8 }  # stale threshold defaults to 30s (3x, min 30)
$stampA = '2026-01-01T00:00:00Z'

# ---------------------------------------------------------------- 1) fresh cache
Write-Host "orb-state: fresh cached snapshot -> live task state"
$fresh = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -CachedAt $stampA); authenticated = $true } `
    -Previous @{ state = 'DISCONNECTED'; markerMs = 0; markerSeenMs = 0 } -Config $cfg -NowMs 1000000
if ($fresh.state -ne 'RUNNING') { Fail "fresh snapshot must show RUNNING, got $($fresh.state)" }
if ($fresh.taskTitle -ne 'Task A') { Fail "fresh snapshot must keep the task title" }
if ($fresh.cacheStale) { Fail "first sighting of a stamp must not be flagged stale" }
if ($fresh.unauthorized -or $fresh.offline) { Fail "fresh snapshot must be neither unauthorized nor offline" }
if ($fresh.markerMs -eq 0) { Fail "cachedAt stamp must be captured" }
Write-Host "orb-state: OK (fresh -> RUNNING, stamp $($fresh.markerMs))"

# ------------------------------------------- 2) stale cache (frozen serverTime)
Write-Host "orb-state: frozen snapshot stamp over threshold -> cache stale"
$stale = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -CachedAt $stampA); authenticated = $true } `
    -Previous @{ state = 'RUNNING'; taskTitle = 'Task A'; markerMs = $fresh.markerMs; markerSeenMs = $fresh.markerSeenMs } `
    -Config $cfg -NowMs (1000000 + 31000)
if (-not $stale.cacheStale) { Fail "same stamp after >30s must be flagged cache-stale" }
if ($stale.state -ne 'DISCONNECTED') { Fail "stale cache must render DISCONNECTED, got $($stale.state)" }
if ($stale.taskTitle -ne '') { Fail "stale cache must not show the stale task title as live" }
if ($stale.toastShouldFire) { Fail "cache-stale must never fire a toast" }
if ($stale.detail -notmatch 'presence cache stale') { Fail "cache-stale detail must carry the 'presence cache stale' note" }
Write-Host "orb-state: OK (stale -> DISCONNECTED + cacheStale, no toast)"

# cache-stale must recover as soon as the stamp advances
$recovered = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -CachedAt '2026-01-01T00:10:00Z'); authenticated = $true } `
    -Previous @{ state = 'DISCONNECTED'; markerMs = $fresh.markerMs; markerSeenMs = $fresh.markerSeenMs } `
    -Config $cfg -NowMs 2000000
if ($recovered.cacheStale) { Fail "an advanced stamp must clear the cache-stale flag" }
if ($recovered.state -ne 'RUNNING') { Fail "advanced stamp must restore the live state, got $($recovered.state)" }
Write-Host "orb-state: OK (stamp advance clears cacheStale)"

# a stamp that is unchanged but WITHIN the threshold stays live
$stillFresh = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -CachedAt $stampA); authenticated = $true } `
    -Previous @{ state = 'RUNNING'; markerMs = $fresh.markerMs; markerSeenMs = $fresh.markerSeenMs } `
    -Config $cfg -NowMs (1000000 + 20000)
if ($stillFresh.cacheStale) { Fail "same stamp within 30s must not be flagged stale" }
if ($stillFresh.state -ne 'RUNNING') { Fail "same stamp within 30s must keep showing the task" }
Write-Host "orb-state: OK (same stamp within threshold stays live)"

# --------------------------------------------------------- 3) unauthorized (HTTP)
Write-Host "orb-state: 401/403 -> explicit unauthorized state"
foreach ($bad in @(401, 403)) {
    $u = Resolve-OrbPoll -Poll @{ kind = 'unauthorized'; code = $bad } `
        -Previous @{ state = 'NEEDS_USER'; taskTitle = 'Old task' } -Config $cfg -NowMs 3000000
    if ($u.state -ne 'UNAUTHORIZED') { Fail "HTTP $bad must render UNAUTHORIZED, got $($u.state)" }
    if (-not $u.unauthorized) { Fail "HTTP $bad must set the unauthorized flag" }
    if ($u.offline) { Fail "unauthorized must NOT be classified offline" }
    if ($u.taskTitle -ne '') { Fail "unauthorized must not keep the last-known task title" }
    if ($u.toastShouldFire) { Fail "transition into unauthorized must never toast" }
    if ($u.detail -notmatch 'companion token invalid') { Fail "unauthorized detail must explain the token problem" }
}
Write-Host "orb-state: OK (401 and 403 -> UNAUTHORIZED, no toast, no stale title)"

# 200 + redacted body while the caller sent a token == unauthorized (non-strict)
$redacted = Resolve-OrbPoll -Poll @{ kind = 'ok'; authenticated = $true; body = ([pscustomobject]@{
    ok = $true
    value = [pscustomobject]@{ tasks = @([pscustomobject]@{ state = 'RUNNING'; title = '(paired)'; summary = ''; updatedAt = 5 }) }
}) } -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 3000000
if ($redacted.state -ne 'UNAUTHORIZED' -or -not $redacted.unauthorized) {
    Fail "a redacted 200 body with a token sent must surface as unauthorized"
}
Write-Host "orb-state: OK (redacted 200 with token -> UNAUTHORIZED)"

# ---------------------------------------------------------------- 4) offline
Write-Host "orb-state: transport failure -> offline, distinct from unauthorized"
$off = Resolve-OrbPoll -Poll @{ kind = 'offline'; message = 'timeout' } `
    -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 3000000
if ($off.state -ne 'OFFLINE') { Fail "transport failure must render OFFLINE, got $($off.state)" }
if (-not $off.offline) { Fail "transport failure must set the offline flag" }
if ($off.unauthorized) { Fail "transport failure must NOT be classified unauthorized" }
if ($off.toastShouldFire) { Fail "transition into offline must never toast" }
Write-Host "orb-state: OK (offline distinct from unauthorized)"

# ----------------------------------------------- 5) toast gate / dedupe
Write-Host "orb-state: toast dedupe and transitions"
# same state twice -> no second toast
$t1 = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -State 'NEEDS_USER' -Title 'T'); authenticated = $true } `
    -Previous @{ state = 'NEEDS_USER'; taskTitle = 'T' } -Config $cfg -NowMs 4000000
if ($t1.toastShouldFire) { Fail "same alert state twice must not toast" }
# NEEDS_USER -> FAILED -> toast fires (a real alert transition)
$t2 = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -State 'FAILED' -Title 'T'); authenticated = $true } `
    -Previous @{ state = 'NEEDS_USER'; taskTitle = 'T' } -Config $cfg -NowMs 4000000
if (-not $t2.toastShouldFire) { Fail "NEEDS_USER -> FAILED must toast" }
# FAILED -> RUNNING -> no toast (quiet state)
$t3 = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -State 'RUNNING' -Title 'T'); authenticated = $true } `
    -Previous @{ state = 'FAILED'; taskTitle = 'T' } -Config $cfg -NowMs 4000000
if ($t3.toastShouldFire) { Fail "FAILED -> RUNNING must not toast" }
# recovery INTO an alert state after an offline window DOES toast
$t4 = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = (New-PresenceBody -State 'NEEDS_USER' -Title 'New task'); authenticated = $true } `
    -Previous @{ state = 'OFFLINE' } -Config $cfg -NowMs 4000000
if (-not $t4.toastShouldFire) { Fail "recovering from offline straight into NEEDS_USER must toast" }
Write-Host "orb-state: OK (same state never re-toasts; alert transitions gate correctly)"

# ------------------------------------------------- 6) selection + envelope errors
Write-Host "orb-state: task selection and envelope failures"
$multi = [pscustomobject]@{
    ok = $true
    cachedAt = $stampA
    value = [pscustomobject]@{
        tasks = @(
            [pscustomobject]@{ taskId = 'low'; state = 'RUNNING'; title = 'Running task'; summary = ''; updatedAt = 999 }
            [pscustomobject]@{ taskId = 'high'; state = 'NEEDS_USER'; title = 'Needs task'; summary = ''; updatedAt = 1 }
            [pscustomobject]@{ taskId = 'mid'; state = 'FAILED'; title = 'Failed task'; summary = ''; updatedAt = 500 }
        )
    }
}
$sel = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $multi; authenticated = $true } `
    -Previous @{ state = 'IDLE' } -Config $cfg -NowMs 5000000
if ($sel.state -ne 'NEEDS_USER' -or $sel.taskTitle -ne 'Needs task') { Fail "highest-priority task must drive the orb" }
if ($sel.taskCount -ne 3) { Fail "task count must reflect the whole list" }
# empty task list -> IDLE, not DISCONNECTED
$emptyBody = '{ "ok": true, "value": { "tasks": [] } }' | ConvertFrom-Json
$idle = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $emptyBody; authenticated = $true } `
    -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 5000000
if ($idle.state -ne 'IDLE') { Fail "an empty task list must render IDLE, got $($idle.state)" }
# host error envelope -> DISCONNECTED with the code surfaced
$errBody = [pscustomobject]@{ ok = $false; error = [pscustomobject]@{ code = 'sessions-unavailable' } }
$err = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $errBody; authenticated = $true } `
    -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 5000000
if ($err.state -ne 'DISCONNECTED' -or $err.detail -notmatch 'sessions-unavailable') {
    Fail "host error envelope must surface as DISCONNECTED with its code"
}
# unknown task state -> DISCONNECTED, never rendered as a live state
$unkBody = New-PresenceBody -State 'BOGUS' -Title 'X'
$unk = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $unkBody; authenticated = $true } `
    -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 5000000
if ($unk.state -ne 'DISCONNECTED' -or $unk.detail -notmatch 'BOGUS') {
    Fail "an unknown task state must render DISCONNECTED with the state named"
}
Write-Host "orb-state: OK (priority selection, empty -> IDLE, error/unknown envelopes)"

Write-Host "orb-state: ALL PASS"
exit 0
