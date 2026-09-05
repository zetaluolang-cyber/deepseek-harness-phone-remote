# orb-state.ps1 - pure presence-state decision helpers for the desktop
# companion (scripts/orb-widget.ps1) and its regression test
# (test/orb-state.test.ps1).
#
# Every function here is deterministic in its arguments: no UI, no WinForms,
# no network, no file I/O. The single entry point is Resolve-OrbPoll, which
# turns one poll OUTCOME into a display decision (state + cache-staleness +
# toast gate) given the previous decision and poll config.
#
# Kept plain ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 files
# without a BOM, and this file has none (same convention as harness-common.ps1
# and the test scripts). Do not add non-ASCII comments or literals here.
#
# State vocabulary (mirrors remfs-persistent/lib/presence/contract.js):
#   real states:    NEEDS_USER FAILED STALE RUNNING DONE IDLE DISCONNECTED
#   virtual states: UNAUTHORIZED (401/403, or a redacted body while we hold a
#                   companion token) and OFFLINE (transport failure only).
#
# Freshness model (see Get-OrbServerStampMs): the push dispatcher serves a
# CACHED snapshot and stamps it with `cachedAt` at the envelope top level
# (remfs-persistent/lib/push/controller.js). A stamp that stops advancing while
# the widget keeps polling means the dispatcher is stalled, so the task states
# inside are stale and must not be rendered as live. A response WITHOUT a stamp
# is a live (uncached) answer and always counts as fresh.

# --- vocabulary ------------------------------------------------------------
$script:OrbStateIds = @('NEEDS_USER','FAILED','STALE','RUNNING','DONE','IDLE','DISCONNECTED')
$script:OrbVirtualStates = @('UNAUTHORIZED','OFFLINE')
$script:OrbAlertStates = @('NEEDS_USER','FAILED')
# Lower priority number = shown first; unknown/off-wire states sort last.
$script:OrbStatePriority = @{
  'NEEDS_USER'    = 0
  'FAILED'        = 1
  'STALE'         = 2
  'RUNNING'       = 3
  'DONE'          = 4
  'IDLE'          = 5
  'DISCONNECTED'  = 6
  'UNAUTHORIZED'  = 7
  'OFFLINE'       = 7
}
# Server-side redaction placeholder for unauthenticated callers
# (remfs-persistent/lib/presence/redact.js).
$script:OrbRedactedTitle = '(paired)'
# .NET ticks (100ns) between 0001-01-01 and 1970-01-01, expressed in ms.
$script:OrbEpochOffsetMs = 62135596800000

# --- time helpers ----------------------------------------------------------

function Get-OrbUtcNowMs {
  # Local machine UTC time as epoch ms. Used only when the caller does not
  # inject $NowMs (tests always inject it for determinism).
  return [long][Math]::Floor(([datetime]::UtcNow.Ticks / 10000) - $script:OrbEpochOffsetMs)
}

function ConvertTo-OrbMs {
  # ISO-8601 string or numeric epoch ms -> UTC epoch ms (0 when absent/invalid).
  param([object]$Stamp)
  if ($null -eq $Stamp) { return [long]0 }
  $s = [string]$Stamp
  if ($s.Length -eq 0) { return [long]0 }
  if ($s -match '^\d+(\.\d+)?$') {
    $d = [double]$s
    if ($d -gt 0) { return [long][Math]::Round($d) }
    return [long]0
  }
  try {
    $dt = [datetime]::Parse(
      $s,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
        [System.Globalization.DateTimeStyles]::AdjustToUniversal
    )
    return [long][Math]::Floor(($dt.Ticks / 10000) - $script:OrbEpochOffsetMs)
  } catch {
    return [long]0
  }
}

# --- object access helpers (work on ConvertFrom-Json and pscustomobject) ---

function Get-OrbPropertyValue {
  param([object]$Obj, [string]$Name)
  if ($null -eq $Obj) { return $null }
  # PSCustomObject (ConvertFrom-Json) and pscustomobject literals expose
  # properties; case-insensitive lookup is built into the PS adapter.
  $p = $Obj.PSObject.Properties[$Name]
  if ($null -ne $p) { return $p.Value }
  # Hashtable fallback (Poll/Previous/Config are passed as hashtables by the
  # widget; ordinary hashtables do not surface keys through PSObject.Properties).
  try {
    if ($Obj -is [System.Collections.IDictionary] -and $Obj.ContainsKey($Name)) {
      return $Obj[$Name]
    }
  } catch { }
  return $null
}

# --- envelope parsing ------------------------------------------------------

function Get-OrbServerStampMs {
  # Best available freshness stamp of one served presence snapshot.
  # Precedence: value.serverTime, value.cachedAt, then top-level cachedAt.
  # 0 means "no stamp" (a live, non-cached answer) and always counts as fresh.
  param([object]$Parsed)
  if ($null -eq $Parsed) { return [long]0 }
  $value = Get-OrbPropertyValue $Parsed 'value'
  $cands = @()
  foreach ($name in @('serverTime', 'cachedAt')) {
    if ($null -ne $value) {
      $c = Get-OrbPropertyValue $value $name
      if ($null -ne $c -and ([string]$c).Length -gt 0) { $cands += [string]$c }
    }
  }
  $top = Get-OrbPropertyValue $Parsed 'cachedAt'
  if ($null -ne $top -and ([string]$top).Length -gt 0) { $cands += [string]$top }
  foreach ($c in $cands) {
    $ms = ConvertTo-OrbMs $c
    if ($ms -gt 0) { return $ms }
  }
  return [long]0
}

function Get-OrbTasksList {
  # The raw tasks array, or $null when value/tasks is absent (distinct from an
  # empty list, which means "no sessions" = IDLE).
  param([object]$Parsed)
  if ($null -eq $Parsed) { return $null }
  $value = Get-OrbPropertyValue $Parsed 'value'
  if ($null -eq $value) { return $null }
  # Read the property object directly: a property whose value is an EMPTY
  # array must not be mistaken for a missing property (returning it through
  # the generic accessor would emit nothing and collapse to $null).
  $tasks = $null
  try {
    $prop = $value.PSObject.Properties['tasks']
    if ($null -ne $prop) { $tasks = $prop.Value }
  } catch { }
  if ($null -eq $tasks -and $value -is [System.Collections.IDictionary]) {
    try { if ($value.ContainsKey('tasks')) { $tasks = $value['tasks'] } } catch { }
  }
  if ($null -eq $tasks) { return $null }
  # Unary comma keeps an EMPTY array intact across the pipeline.
  return ,$tasks
}

function Select-OrbTask {
  # Best task DTO for the single-orb display: lowest priority number, then the
  # newest updatedAt. Returns the DTO itself, or $null for an empty list.
  param([object[]]$Tasks)
  $best = $null
  $bestP = 99
  $bestU = [long]-1
  foreach ($t in $Tasks) {
    if ($null -eq $t) { continue }
    $st = [string](Get-OrbPropertyValue $t 'state')
    $p = $script:OrbStatePriority[$st]
    if ($null -eq $p) { $p = 99 }
    $u = [long]0
    try { $u = [long](Get-OrbPropertyValue $t 'updatedAt') } catch { $u = [long]0 }
    if ($null -eq $best -or $p -lt $bestP -or ($p -eq $bestP -and $u -gt $bestU)) {
      $best = $t
      $bestP = $p
      $bestU = $u
    }
  }
  return $best
}

function Get-OrbFleet {
  # Fleet view: the SHAPE of the whole task set, not one sampled task.
  #
  # The single-orb display answers "one of your N tasks is in state X", which
  # collapses a 27-task snapshot into one glyph. A person running long agent
  # sessions is not supervising an agent, they are supervising a fleet: what
  # they need at a glance is the distribution (how many need me, how many are
  # working, how many finished) and, for triage, WHICH ones need them.
  #
  # Returns:
  #   counts     ordered hashtable state -> count (only non-zero states)
  #   total      total task count
  #   needing    tasks in an ALERT state (NEEDS_USER/FAILED), priority-ordered
  #              then newest-first; each @{ state; title; sessionId }
  #   working    count of RUNNING + STALE
  #   settled    count of DONE + IDLE
  #   summary    compact one-line distribution, e.g. "2 need you | 5 running"
  param([object[]]$Tasks)

  $res = @{
    counts  = @{}
    total   = 0
    needing = @()
    working = 0
    settled = 0
    summary = ''
  }
  if ($null -eq $Tasks) { return $res }

  $alerts = @()
  foreach ($t in $Tasks) {
    if ($null -eq $t) { continue }
    $res.total++
    $st = [string](Get-OrbPropertyValue $t 'state')
    if (-not $st) { $st = 'DISCONNECTED' }
    if ($res.counts.ContainsKey($st)) { $res.counts[$st] = $res.counts[$st] + 1 }
    else { $res.counts[$st] = 1 }
    if ($st -eq 'RUNNING' -or $st -eq 'STALE') { $res.working++ }
    if ($st -eq 'DONE' -or $st -eq 'IDLE') { $res.settled++ }
    if ($script:OrbAlertStates -contains $st) {
      $u = [long]0
      try { $u = [long](Get-OrbPropertyValue $t 'updatedAt') } catch { $u = [long]0 }
      $p = $script:OrbStatePriority[$st]
      if ($null -eq $p) { $p = 99 }
      $alerts += @{
        state     = $st
        title     = [string](Get-OrbPropertyValue $t 'title')
        sessionId = [string](Get-OrbPropertyValue $t 'sessionId')
        priority  = [int]$p
        updatedAt = $u
      }
    }
  }

  # Triage order. The elements are HASHTABLES, and on PS 5.1 a Sort-Object
  # property given as @{Expression='priority'} resolves a literal PROPERTY
  # name, which a hashtable does not have - the level is silently dropped and
  # the list comes back ordered by the other key alone. A scriptblock
  # expression reads the key correctly. (Verified on 5.1.19041: the string
  # form yields s5,s4,s2; the scriptblock form yields s5,s2,s4.)
  $res.needing = @($alerts | Sort-Object -Property `
    @{ Expression = { $_.priority }; Ascending = $true }, `
    @{ Expression = { $_.updatedAt }; Descending = $true })

  $parts = @()
  $needCount = @($res.needing).Count
  if ($needCount -gt 0) { $parts += ("{0} need you" -f $needCount) }
  if ($res.working -gt 0) { $parts += ("{0} running" -f $res.working) }
  if ($res.settled -gt 0) { $parts += ("{0} settled" -f $res.settled) }
  $res.summary = ($parts -join ' | ')
  return $res
}

function Test-OrbRedactedBody {
  # True when EVERY task in a 200 body carries the redaction placeholder title
  # '(paired)' plus an empty summary. Outside pocketStrict mode the server
  # answers 200 with redacted content instead of 403 when the companion token
  # is rejected (remfs-persistent/lib/push/http.js), so this signature is the
  # only way the widget can tell "token refused" from "everything is fine".
  param([object]$Parsed)
  $tasks = Get-OrbTasksList $Parsed
  if ($null -eq $tasks -or $tasks.Count -eq 0) { return $false }
  foreach ($t in $tasks) {
    if ($null -eq $t) { return $false }
    $title = [string](Get-OrbPropertyValue $t 'title')
    $sum = [string](Get-OrbPropertyValue $t 'summary')
    if ($title -ne $script:OrbRedactedTitle -or $sum -ne '') { return $false }
  }
  return $true
}

function Test-OrbToastDue {
  # A Windows toast fires only when the DISPLAYED state moves INTO an alert
  # state (NEEDS_USER / FAILED). Repeats of the same state never toast, and
  # transitions into quiet real states or the virtual UNAUTHORIZED/OFFLINE
  # states never toast. This is the pure gate; the widget also keeps its own
  # per-(state,title) dedupe map as a second guard.
  param([string]$PreviousState, [string]$NewState)
  if ($NewState -notin $script:OrbAlertStates) { return $false }
  if ($NewState -eq $PreviousState) { return $false }
  return $true
}

# --- the one decision entry point ------------------------------------------

function Resolve-OrbPoll {
  # Decide what the companion should DISPLAY after one poll.
  #
  # $Poll - @{ kind; code; message; body; authenticated }
  #     kind           'ok'          200 + parseable envelope (body set)
  #                    'unauthorized' 401/403 from the presence endpoint
  #                    'offline'      transport failure (timeout/DNS/reset)
  #                    'http'         any other non-2xx status (code set)
  #                    'parse'        200 with an unparseable body
  #     code           HTTP status when relevant
  #     message        diagnostic free text
  #     body           the parsed JSON envelope when kind = 'ok'
  #     authenticated  $true only when the caller actually sent the companion
  #                    token header this poll (enables the redaction probe)
  # $Previous - the last decision record: @{ state; markerMs; markerSeenMs }
  #     markerMs       last observed snapshot stamp (epoch ms; 0 = none)
  #     markerSeenMs   local time (epoch ms) that stamp was first observed
  # $Config - @{ pollIntervalSec; staleThresholdSec }; staleThresholdSec is an
  #     optional override; the default is max(30, 3 * pollIntervalSec) seconds.
  # $NowMs  - local UTC epoch ms; 0 means "use the clock".
  #
  # Returns a hashtable:
  #   state, taskTitle, taskSummary, taskCount, detail, cacheStale,
  #   unauthorized, offline, toastShouldFire, markerMs, markerSeenMs,
  #   fleet (see Get-OrbFleet: counts/total/needing/working/settled/summary)
  param(
    [object]$Poll = $null,
    [object]$Previous = $null,
    [object]$Config = $null,
    [long]$NowMs = 0
  )

  $now = $NowMs
  if ($now -le 0) { $now = Get-OrbUtcNowMs }

  $kind = ''
  $code = 0
  $message = ''
  $body = $null
  $authenticated = $false
  if ($null -ne $Poll) {
    $kind = [string](Get-OrbPropertyValue $Poll 'kind')
    $c = Get-OrbPropertyValue $Poll 'code'
    if ($null -ne $c) { $code = [int]$c }
    $m = Get-OrbPropertyValue $Poll 'message'
    if ($null -ne $m) { $message = [string]$m }
    $body = Get-OrbPropertyValue $Poll 'body'
    $auth = Get-OrbPropertyValue $Poll 'authenticated'
    $authenticated = ($auth -eq $true)
  }

  $prevState = ''
  $prevTitle = ''
  $prevMarkerMs = [long]0
  $prevMarkerSeenMs = [long]0
  if ($null -ne $Previous) {
    $ps = Get-OrbPropertyValue $Previous 'state'
    if ($null -ne $ps) { $prevState = [string]$ps }
    $pt = Get-OrbPropertyValue $Previous 'taskTitle'
    if ($null -ne $pt) { $prevTitle = [string]$pt }
    $pm = Get-OrbPropertyValue $Previous 'markerMs'
    if ($null -ne $pm) { $prevMarkerMs = [long]$pm }
    $psm = Get-OrbPropertyValue $Previous 'markerSeenMs'
    if ($null -ne $psm) { $prevMarkerSeenMs = [long]$psm }
  }

  $iv = 8
  $overrideSec = 0
  if ($null -ne $Config) {
    $civ = Get-OrbPropertyValue $Config 'pollIntervalSec'
    if ($null -ne $civ) { $iv = [int]$civ }
    $cov = Get-OrbPropertyValue $Config 'staleThresholdSec'
    if ($null -ne $cov) { $overrideSec = [int]$cov }
  }
  if ($iv -lt 3) { $iv = 3 } elseif ($iv -gt 60) { $iv = 60 }
  $thresholdSec = $overrideSec
  if ($thresholdSec -le 0) { $thresholdSec = [Math]::Max(30, 3 * $iv) }

  $res = @{
    state            = 'DISCONNECTED'
    taskTitle        = ''
    taskSummary      = ''
    taskCount        = 0
    detail           = ''
    cacheStale       = $false
    unauthorized     = $false
    offline          = $false
    toastShouldFire  = $false
    markerMs         = $prevMarkerMs
    markerSeenMs     = $prevMarkerSeenMs
    fleet            = (Get-OrbFleet -Tasks @())
  }

  switch ($kind) {
    'unauthorized' {
      $res.state = 'UNAUTHORIZED'
      $res.unauthorized = $true
      $res.detail = 'companion token invalid - re-run install or refresh the token'
      break
    }
    'offline' {
      $res.state = 'OFFLINE'
      $res.offline = $true
      $res.detail = 'harness unreachable - check watchdog / port 3080'
      if ($message) { $res.detail = $res.detail + ' (' + $message + ')' }
      break
    }
    'http' {
      $res.state = 'DISCONNECTED'
      $res.detail = 'presence returned HTTP ' + $code
      break
    }
    'parse' {
      $res.state = 'DISCONNECTED'
      $res.detail = 'presence response could not be parsed'
      break
    }
    'ok' {
      # Redaction probe first: a 200 whose tasks are all placeholders means the
      # server refused our token (non-strict mode answers 200, not 403).
      if ($authenticated -and (Test-OrbRedactedBody $body)) {
        $res.state = 'UNAUTHORIZED'
        $res.unauthorized = $true
        $res.detail = 'companion token invalid - re-run install or refresh the token'
        break
      }
      if ($null -eq $body) {
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence response missing body'
        break
      }
      if ((Get-OrbPropertyValue $body 'ok') -ne $true) {
        $err = Get-OrbPropertyValue $body 'error'
        $errCode = ''
        if ($null -ne $err) {
          $ec = Get-OrbPropertyValue $err 'code'
          if ($null -ne $ec) { $errCode = [string]$ec }
        }
        $errCodeText = $errCode
        if (-not $errCodeText) { $errCodeText = 'unknown error' }
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence unavailable - ' + $errCodeText
        break
      }
      $tasks = Get-OrbTasksList $body
      if ($null -eq $tasks) {
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence response missing tasks'
        break
      }

      # Snapshot freshness: a stamp that stopped advancing longer than the
      # threshold means the dispatcher cache is stale (its task states must not
      # be rendered as live). A missing stamp means a live, uncached answer.
      $stamp = Get-OrbServerStampMs $body
      $stale = $false
      $marker = $prevMarkerMs
      $seen = $prevMarkerSeenMs
      if ($stamp -eq 0) {
        $marker = [long]0
        $seen = $now
      } elseif ($stamp -ne $prevMarkerMs -or $prevMarkerSeenMs -le 0) {
        # First sighting of this snapshot stamp (or the very first poll).
        $marker = $stamp
        $seen = $now
      } elseif (($now - $prevMarkerSeenMs) -ge ($thresholdSec * 1000)) {
        $stale = $true
        $marker = $stamp
        $seen = $prevMarkerSeenMs
      }
      $res.markerMs = $marker
      $res.markerSeenMs = $seen

      if ($stale) {
        $res.cacheStale = $true
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence cache stale - snapshot not refreshed for over ' + $thresholdSec + 's; the push dispatcher may be stalled'
        break
      }
      if ($tasks.Count -eq 0) {
        $res.state = 'IDLE'
        $res.taskCount = 0
        break
      }
      # Fleet shape is computed from EVERY task, independently of which one
      # the single orb samples - that sampling is what collapsed a 27-task
      # snapshot into one glyph.
      $res.fleet = Get-OrbFleet -Tasks $tasks
      $best = Select-OrbTask -Tasks $tasks
      $res.taskCount = $tasks.Count
      if ($null -eq $best) {
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence returned no usable task'
        break
      }
      $st = [string](Get-OrbPropertyValue $best 'state')
      if ($null -eq $script:OrbStatePriority[$st] -or $st -notin $script:OrbStateIds) {
        $res.state = 'DISCONNECTED'
        $res.detail = 'presence returned unknown state - ' + $st
        break
      }
      $title = [string](Get-OrbPropertyValue $best 'title')
      $summary = [string](Get-OrbPropertyValue $best 'summary')
      $detail = ''
      $sr = Get-OrbPropertyValue $best 'staleReason'
      if ($null -ne $sr) {
        try {
          $parts = @()
          foreach ($line in @($sr)) { if ($null -ne $line -and ([string]$line).Length -gt 0) { $parts += [string]$line } }
          if ($parts.Count -gt 0) { $detail = $parts -join '; ' }
        } catch { $detail = '' }
      }
      $res.state = $st
      $res.taskTitle = $title
      $res.taskSummary = $summary
      $res.detail = $detail
      $res.toastShouldFire = (Test-OrbToastDue -PreviousState $prevState -NewState $st)
      break
    }
    default {
      # Unknown/missing kind (defensive): never crash the widget.
      $res.state = 'DISCONNECTED'
      $res.detail = 'poll outcome kind missing or unknown'
      break
    }
  }

  return $res
}
