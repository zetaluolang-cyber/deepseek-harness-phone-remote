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


# --- fleet view -------------------------------------------------------------
# The single-orb sample answers "one of N is in state X". A person supervising
# long agent runs needs the SHAPE of the fleet: how many need me, which ones,
# and in what triage order. These pin that aggregation.
function New-Task([string]$State, [string]$Title, [string]$SessionId, [long]$Updated) {
    return [pscustomobject]@{ state = $State; title = $Title; sessionId = $SessionId; updatedAt = $Updated }
}
$fleetTasks = @(
    (New-Task 'RUNNING'      'build'      's1' 100),
    (New-Task 'NEEDS_USER'   'approve rm' 's2' 200),
    (New-Task 'DONE'         'done job'   's3' 300),
    (New-Task 'FAILED'       'broke'      's4' 400),
    (New-Task 'NEEDS_USER'   'pick name'  's5' 500),
    (New-Task 'RUNNING'      'test'       's6' 600),
    (New-Task 'IDLE'         'idle one'   's7' 700),
    (New-Task 'STALE'        'stuck'      's8' 800)
)
$fleet = Get-OrbFleet -Tasks $fleetTasks
if ($fleet.total -ne 8) { Fail "fleet total must count every task, got $($fleet.total)" }
if ($fleet.counts['NEEDS_USER'] -ne 2) { Fail "NEEDS_USER count wrong: $($fleet.counts['NEEDS_USER'])" }
if ($fleet.counts['RUNNING'] -ne 2) { Fail "RUNNING count wrong: $($fleet.counts['RUNNING'])" }
if ($fleet.working -ne 3) { Fail "working must be RUNNING+STALE = 3, got $($fleet.working)" }
if ($fleet.settled -ne 2) { Fail "settled must be DONE+IDLE = 2, got $($fleet.settled)" }
# triage: NEEDS_USER before FAILED, newest first inside a state
$need = @($fleet.needing)
if ($need.Count -ne 3) { Fail "needing must list every alert task, got $($need.Count)" }
if ($need[0].state -ne 'NEEDS_USER' -or $need[0].sessionId -ne 's5') {
    Fail "triage order wrong: first should be the NEWEST NEEDS_USER (s5), got $($need[0].sessionId)/$($need[0].state)"
}
if ($need[1].sessionId -ne 's2') { Fail "second should be the older NEEDS_USER (s2), got $($need[1].sessionId)" }
if ($need[2].state -ne 'FAILED') { Fail "FAILED must sort after NEEDS_USER, got $($need[2].state)" }
if ($fleet.summary -notmatch '3 need you' -or $fleet.summary -notmatch '3 running') {
    Fail "summary must state the distribution, got '$($fleet.summary)'"
}
# a fleet with nothing to act on must say so with an EMPTY needing list
$calm = Get-OrbFleet -Tasks @((New-Task 'RUNNING' 'a' 's1' 10), (New-Task 'DONE' 'b' 's2' 20))
if (@($calm.needing).Count -ne 0) { Fail "no alert states must yield an empty needing list" }
if ($calm.summary -match 'need you') { Fail "summary must not claim attention is needed: '$($calm.summary)'" }
# empty / null input must never throw
$empty = Get-OrbFleet -Tasks @()
if ($empty.total -ne 0 -or @($empty.needing).Count -ne 0) { Fail "empty fleet must be empty, not null" }
$nul = Get-OrbFleet -Tasks $null
if ($nul.total -ne 0) { Fail "null task list must degrade to an empty fleet" }
# Resolve-OrbPoll must carry the fleet through, not just the sampled task
$multiBody = [pscustomobject]@{ ok = $true; value = [pscustomobject]@{ tasks = $fleetTasks } }
$decision = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $multiBody; authenticated = $true } `
    -Previous @{ state = 'IDLE' } -Config $cfg -NowMs 5000000
if ($decision.state -ne 'NEEDS_USER') { Fail "orb must still sample the most urgent state, got $($decision.state)" }
if ($decision.taskCount -ne 8) { Fail "taskCount must stay the full count, got $($decision.taskCount)" }
if (@($decision.fleet.needing).Count -ne 3) { Fail "the decision must carry the whole actionable list, not one sample" }
if ($decision.fleet.total -ne 8) { Fail "the decision must carry the whole fleet" }
Write-Host "orb-state: OK (fleet distribution, triage order, calm fleet, degradation)"

# --- deep link: the decision must name the session the orb is showing -------
$deepBody = [pscustomobject]@{ ok = $true; value = [pscustomobject]@{ tasks = @(
    (New-Task 'RUNNING' 'other' 'sess-other' 100),
    (New-Task 'NEEDS_USER' 'approve the delete' 'session-abc-123' 900)
) } }
$deep = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $deepBody; authenticated = $true } `
    -Previous @{ state = 'IDLE' } -Config $cfg -NowMs 5000000
if ($deep.taskSessionId -ne 'session-abc-123') {
    Fail "the decision must carry the SAMPLED task's sessionId, got '$($deep.taskSessionId)'"
}
if ($deep.state -ne 'NEEDS_USER') { Fail "sanity: the sampled task should be the NEEDS_USER one" }
# an empty fleet leaves it blank rather than stale
$noneBody = [pscustomobject]@{ ok = $true; value = [pscustomobject]@{ tasks = @() } }
$none = Resolve-OrbPoll -Poll @{ kind = 'ok'; body = $noneBody; authenticated = $true } `
    -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 5000000
if ($none.taskSessionId -ne '') { Fail "an empty task list must not carry a session id" }
# unauthorized/offline decisions must never name a session either
$un = Resolve-OrbPoll -Poll @{ kind = 'unauthorized'; code = 401 } -Previous @{ state = 'RUNNING' } -Config $cfg -NowMs 5000000
if ($un.taskSessionId -ne '') { Fail "an unauthorized poll must not carry a session id" }
Write-Host "orb-state: OK (deep-link session id, blank when there is nothing to point at)"
# --- extracted pure helpers -------------------------------------------------
# These shipped inside orb-widget.ps1, where a test could only reach them by
# loading WinForms. Get-OrbOpenUrl in particular went live untested.
if ((ConvertTo-OrbArgLine -Tokens @('a')) -ne '"a"') { Fail "single token must be quoted" }
if ((ConvertTo-OrbArgLine -Tokens @('C:\Program Files\x.ps1','-Quiet')) -ne '"C:\Program Files\x.ps1" "-Quiet"') {
    Fail "a spaced path must stay ONE argv token: $(ConvertTo-OrbArgLine -Tokens @('C:\Program Files\x.ps1','-Quiet'))"
}
if ((ConvertTo-OrbArgLine -Tokens @()) -ne '') { Fail "no tokens must yield an empty line" }
Write-Host "orb-state: OK (arg quoting keeps spaced paths intact)"

$U = 'http://127.0.0.1:3080/'
if ((Get-OrbOpenUrl -BaseUrl $U -SessionId 'session-abc') -ne ($U + '#remfs-session=session-abc')) {
    Fail "a session id must become a fragment"
}
if ((Get-OrbOpenUrl -BaseUrl $U -SessionId '') -ne $U) { Fail "no session id must open the bare GUI" }
# a fragment is REPLACED, never appended: two fragments in one URL is not a thing
if ((Get-OrbOpenUrl -BaseUrl ($U + '#stale') -SessionId 's1') -ne ($U + '#remfs-session=s1')) {
    Fail "a pre-existing fragment must be replaced, got $(Get-OrbOpenUrl -BaseUrl ($U + '#stale') -SessionId 's1')"
}
# anything that could break a URL must be percent-encoded
$esc = Get-OrbOpenUrl -BaseUrl $U -SessionId 'a b/c#d'
if ($esc -notmatch 'remfs-session=a%20b%2Fc%23d') { Fail "session id must be escaped, got $esc" }
if (([regex]::Matches($esc, '#')).Count -ne 1) { Fail "an escaped id must not introduce a second fragment: $esc" }
if ((Get-OrbOpenUrl -BaseUrl '' -SessionId 's1') -ne '') { Fail "no base url must yield nothing to open" }
Write-Host "orb-state: OK (deep-link URL: fragment replace, escaping, empty inputs)"

# --- panel text composition -------------------------------------------------
# The wording rules used to live inside Update-CompanionPanel, reachable only
# by constructing a WinForms panel - so every rule below was unverified.
function New-Cur { param($state, $title, $summary, $detail, $count, $fleet, $updated)
    return @{ state = $state; title = $title; summary = $summary; detail = $detail
              count = $count; fleet = $fleet; updated = $updated }
}
function New-Need($state, $ask, $sid) { return @{ state = $state; firstAsk = $ask; title = ''; sessionId = $sid } }

# a diagnostic always wins: it explains why the numbers cannot be trusted
$d = Get-OrbPanelText -Current (New-Cur -state 'DISCONNECTED' -title '' -summary 'some summary' -detail 'cache stale - dispatcher stalled' -count 27 -fleet @{ needing = @((New-Need 'NEEDS_USER' 'a' 's1'), (New-Need 'FAILED' 'b' 's2')); summary = '2 need you' } -updated '10:00')
if ($d.body -ne 'cache stale - dispatcher stalled') { Fail "a diagnostic must outrank the queue, got '$($d.body)'" }

# more than one waiting -> the QUEUE, identity first, newest cap honoured
$q = Get-OrbPanelText -Current (New-Cur -state 'NEEDS_USER' 'T' 'sampled summary' '' 9 `
    @{ needing = @((New-Need 'NEEDS_USER' 'approve the delete' 's1'),
                   (New-Need 'NEEDS_USER' 'pick a name' 's2'),
                   (New-Need 'FAILED' 'build broke' 's3'),
                   (New-Need 'FAILED' 'tests broke' 's4'));
       summary = '4 need you' } '10:00') -MaxRows 3
$rows = $q.body -split [Environment]::NewLine
if ($rows.Count -ne 4) { Fail "3 rows + an overflow line expected, got $($rows.Count)" }
if ($rows[0] -notmatch 'approve the delete') { Fail "the queue must lead with the most urgent: $($rows[0])" }
if ($rows[3] -notmatch '\+1 more waiting') { Fail "overflow must be counted, got '$($rows[3])'" }
if ($q.body -match 'sampled summary') { Fail "the sampled summary must not replace the queue" }

# exactly one waiting -> the detailed summary is more useful than a 1-row list
$one = Get-OrbPanelText -Current (New-Cur -state 'NEEDS_USER' -title 'T' -summary 'sampled summary' -detail '' -count 3 -fleet @{ needing = @((New-Need 'NEEDS_USER' 'only one' 's1')); summary = '1 need you' } -updated '10:00')
if ($one.body -ne 'sampled summary') { Fail "a single waiting task should keep the summary, got '$($one.body)'" }

# long identity is clipped with an ellipsis, never wrapped
$long = Get-OrbPanelText -Current (New-Cur -state 'NEEDS_USER' -title '' -summary '' -detail '' -count 2 -fleet @{ needing = @((New-Need 'NEEDS_USER' ('x' * 200) 's1'), (New-Need 'FAILED' 'y' 's2')); summary = '2 need you' } -updated '') -LabelChars 20
$first = ($long.body -split [Environment]::NewLine)[0]
if ($first.Length -gt 22) { Fail "a long label must be clipped, got length $($first.Length)" }
if ($first -notmatch ([char]0x2026)) { Fail "clipping must be visible" }

# meta prefers the distribution over a bare total
$m = Get-OrbPanelText -Current (New-Cur -state 'RUNNING' -title 'T' -summary 's' -detail '' -count 27 -fleet @{ needing = @(); summary = '2 need you | 5 running' } -updated '10:15')
if ($m.meta -notmatch '2 need you \| 5 running') { Fail "meta must carry the distribution, got '$($m.meta)'" }
if ($m.meta -notmatch '10:15') { Fail "meta must carry the update time" }
# no fleet (stale/unauthorized poll) -> fall back to the count, never invent one
$nf = Get-OrbPanelText -Current (New-Cur -state 'DISCONNECTED' -title '' -summary '' -detail 'offline' -count 27 -fleet $null -updated '10:15')
if ($nf.meta -notmatch 'tasks 27') { Fail "without a fleet the meta must fall back to the count, got '$($nf.meta)'" }

# idle and empty inputs never produce a blank panel
$idle = Get-OrbPanelText -Current (New-Cur -state 'IDLE' -title '' -summary '' -detail '' -count 0 -fleet $null -updated '')
if (-not $idle.title -or -not $idle.body) { Fail "IDLE must still say something" }
$null_ = Get-OrbPanelText -Current $null
if ($null_.title -ne '' -or $null_.body -ne '') { Fail "a null record must degrade to empty, not throw" }
Write-Host "orb-state: OK (panel text: diagnostic > queue > summary, clipping, meta fallback)"

# --- Get-OrbPropertyValue ---------------------------------------------------
# Every decision in this module reads its inputs through this one accessor, so
# a wrong answer here is wrong EVERYWHERE. It had a real bug: a hashtable also
# exposes its own collection members through PSObject.Properties, so asking a
# @{ count = 27 } for 'count' returned 4 - the number of KEYS. Dictionaries are
# now resolved before PSObject members.
$ht = @{ state = 'X'; count = 27; keys = 'mine'; length = 'also mine' }
if ((Get-OrbPropertyValue $ht 'count') -ne 27) { Fail "hashtable data must beat the container's Count: got $(Get-OrbPropertyValue $ht 'count')" }
if ((Get-OrbPropertyValue $ht 'keys') -ne 'mine') { Fail "a 'keys' KEY must beat the container's Keys" }
if ((Get-OrbPropertyValue $ht 'length') -ne 'also mine') { Fail "a 'length' KEY must beat the container's Length" }
if ((Get-OrbPropertyValue $ht 'COUNT') -ne 27) { Fail "hashtable lookup must be case-insensitive" }
if ($null -ne (Get-OrbPropertyValue $ht 'absent')) { Fail "a missing key must be null, not a container member" }
$pso = [pscustomobject]@{ count = 9 }
if ((Get-OrbPropertyValue $pso 'count') -ne 9) { Fail "pscustomobject must still work" }
$json = '{"count":5,"tasks":[1,2,3]}' | ConvertFrom-Json
if ((Get-OrbPropertyValue $json 'count') -ne 5) { Fail "ConvertFrom-Json objects must still work" }
if ((Get-OrbPropertyValue $json 'tasks').Count -ne 3) { Fail "array values must come back intact" }
if ($null -ne (Get-OrbPropertyValue $null 'x')) { Fail "a null object must yield null" }
Write-Host "orb-state: OK (property lookup: data beats container members, both shapes)"

Write-Host "orb-state: ALL PASS"
exit 0
