# Shared process-ownership helpers for the DeepSeek Harness launcher.
#
# "Port 3080 is listening" is NOT enough to mean "our harness is running": an
# unrelated localhost service could occupy it. Every check verifies the owning
# process's command line before trusting, starting or killing anything, so the
# launcher never exposes a foreign 3080 service to Tailscale/LAN and stop /
# restart never kills a process we do not own.
#
# All ASCII on purpose: Windows PowerShell 5.1 mis-decodes UTF-8 no-BOM scripts.

$ErrorActionPreference = "Continue"

# Returns the PID of the process listening on 127.0.0.1:$Port whose command
# line contains $Marker (e.g. the dsh bin path), or $null when it is not ours.
function Get-OwnedHarnessPid {
    param([int]$Port = 3080, [string]$Marker)
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -and $Marker -and $proc.CommandLine.Contains($Marker)) {
            return [int]$p
        }
    }
    return $null
}

# Returns the PID of the process listening on $ListenIP:$Port whose command
# line contains "tailscale_forward.js" (one of our forwarders), or $null.
function Get-OwnedForwarderPid {
    param([string]$ListenIP, [int]$Port = 3080)
    $conn = Get-NetTCPConnection -LocalAddress $ListenIP -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $null }
    foreach ($p in ($conn.OwningProcess | Sort-Object -Unique)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains("tailscale_forward.js")) {
            return [int]$p
        }
    }
    return $null
}

# Returns EVERY owned forwarder PID (Tailscale IP + dynamic LAN IP) whose
# command line contains the deployed forwarder bin path. Ownership is the
# exact command-line identity, so a stale or foreign process that merely
# occupies a port is never matched, and a LAN forwarder on an IP we do not
# track statically is still found.
function Get-OwnedForwarderPids {
    param([string]$ForwarderBin)
    $pids = @()
    if (-not $ForwarderBin) { return $pids }
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        if ($proc.CommandLine -and $proc.CommandLine.Contains($ForwarderBin)) {
            $pids += [int]$proc.ProcessId
        }
    }
    return ($pids | Sort-Object -Unique)
}

# Kills ONLY processes this project owns (the harness matching $Marker and our
# forwarders), then waits for the harness port to free up. Forwarders are
# identified EITHER by an explicit bin path ($ForwarderBin - covers every
# owned forwarder, Tailscale + LAN) OR by a static IP list ($ForwarderIPs).
function Stop-OwnedHarnessStack {
    param([string]$Marker, [string[]]$ForwarderIPs = @(), [string]$ForwarderBin = "", [int]$Port = 3080)
    $mine = @()
    $hp = Get-OwnedHarnessPid -Port $Port -Marker $Marker
    if ($hp) { $mine += $hp }
    if ($ForwarderBin) {
        $mine += Get-OwnedForwarderPids -ForwarderBin $ForwarderBin
    } else {
        foreach ($ip in $ForwarderIPs) {
            if (-not $ip) { continue }
            $fp = Get-OwnedForwarderPid -ListenIP $ip -Port $Port
            if ($fp) { $mine += $fp }
        }
    }
    $mine | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-OwnedHarnessPid -Port $Port -Marker $Marker)) { break }
    }
}

# The plugin package the loader needs. We sync the WHOLE package tree (never a
# per-file list): a hand-maintained list silently misses new lib/ modules and
# recreates the original missing-module bug class.
$script:RemfsPluginPackage = "remfs-persistent"

# READ-ONLY pre-flight: the vendor package root and the node_modules target
# directory must exist. Call BEFORE killing anything.
function Test-RemfsPluginReady {
    param([string]$Vendor, [string]$NmPkg)
    if (-not $Vendor -or -not (Test-Path $Vendor)) { return $false }
    if (-not (Test-Path (Join-Path $Vendor "package.json"))) { return $false }
    if (-not (Test-Path (Join-Path $Vendor "lib"))) { return $false }
    if (-not $NmPkg -or -not (Test-Path $NmPkg)) { return $false }
    return $true
}

# Copy the plugin from vendor into node_modules. MUST run only while the old
# harness is dead (its file locks are released). Copies the WHOLE package tree
# (lib/ recursively) so no module can be missed. Returns $true on success.
# Creates missing target subdirectories.
function Sync-RemfsPlugin {
    param([string]$Vendor, [string]$NmPkg)
    # A clean install has no node_modules target yet. Only the vendor source is
    # required up front; this function owns creating the destination.
    if (-not $Vendor -or -not (Test-Path (Join-Path $Vendor "package.json")) -or
        -not (Test-Path (Join-Path $Vendor "lib")) -or -not $NmPkg) { return $false }
    New-Item -ItemType Directory -Force -Path $NmPkg | Out-Null
    # package.json
    Copy-Item (Join-Path $Vendor "package.json") (Join-Path $NmPkg "package.json") -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $NmPkg "package.json"))) { return $false }
    # the ENTIRE lib/ directory tree (recursive) - a per-file list would
    # silently drop new modules
    if (Test-Path (Join-Path $Vendor "lib")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $NmPkg "lib") | Out-Null
        Copy-Item (Join-Path $Vendor "lib\*") (Join-Path $NmPkg "lib") -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path (Join-Path $NmPkg "lib"))) { return $false }
    }
    return $true
}

# True only when the pid file points to a LIVE process whose command line
# contains the exact deployed keep_awake.ps1 path. A stale/reused pid must
# never be trusted or killed blindly.
function Test-KeepAwakeOwned {
    param([string]$PidFile, [string]$KeepAwakeBin)
    if (-not $PidFile -or -not (Test-Path $PidFile)) { return $false }
    $kp = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($kp -notmatch '^\d+$') { return $false }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$kp)" -ErrorAction SilentlyContinue
    return ($proc -and $proc.CommandLine -and $KeepAwakeBin -and $proc.CommandLine.Contains($KeepAwakeBin))
}

# ---------------------------------------------------------------------------
# Semantic-version sort key (b3dfc4b audit item 4). Shared by install.ps1 (dsh
# entry resolution) and the install-smoke regression test, so the test verifies
# the EXACT comparator the installer runs.
# ---------------------------------------------------------------------------
function Get-VersionKey([string]$v) {
    # Correct zero-padded semantic-version sort key. Every numeric part is
    # zero-padded so lexicographic order == numeric order:
    #   0.9.0  -> 00000000.00000009.00000000.99999999.0
    #   0.10.0 -> 00000000.00000010.00000000.99999999.0  (0.9.0 < 0.10.0)
    #   1.9.0  < 1.10.0
    #   0.1.0-rc.9  -> ...00000009  (rc.9 < rc.10)
    #   0.1.0-rc.10 -> ...00000010
    #   0.1.0       -> .99999999.   (final > any pre-release of same core)
    $m = [regex]::Match($v, '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$')
    if (-not $m.Success) { return '0.0.0.0.0' }
    $major = [int]$m.Groups[1].Value
    $minor = [int]$m.Groups[2].Value
    $patch = [int]$m.Groups[3].Value
    $core = '{0:D8}.{1:D8}.{2:D8}' -f $major, $minor, $patch
    if (-not $m.Groups[4].Success) { return $core + '.99999999.0' }
    $pre = $m.Groups[4].Value
    $preNum = 0
    $pn = [regex]::Match($pre, '(\d+)$')
    if ($pn.Success) { $preNum = [int]$pn.Groups[1].Value }
    return $core + '.0.' + $preNum.ToString('D8')
}

# Kill keep_awake only when ownership is verified; always clean up the pid file.
function Stop-OwnedKeepAwake {
    param([string]$PidFile, [string]$KeepAwakeBin)
    if (Test-KeepAwakeOwned -PidFile $PidFile -KeepAwakeBin $KeepAwakeBin) {
        $kp = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($kp -match '^\d+$') { Stop-Process -Id ([int]$kp) -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# The inject list the host half REQUIRES. lib/host.js declares
#   inject: ['connection', 'fs', 'sandboxPolicy', 'workspaceRegistry']
# and the loader row must match EXACTLY, otherwise apply() can run before the
# workspace-root services exist (accidental plugin ordering). Older installs
# wrote the two-service list [connection, fs] - Set-RemfsPatchRow migrates it.
$script:RemfsPatchInject = "inject: [connection, fs, sandboxPolicy, workspaceRegistry]"

# Ensure the web profile's cordis.patch.yml carries a remfs-persistent row with
# the exact four-service inject list. MIGRATES an existing row in place (never
# appends a duplicate, never leaves a stale two-service row). This is the
# single source of truth used by BOTH install.ps1 and the CI real-dsh-smoke
# job, so the CI path tests the real installer patch logic.
# param([string]$ProfileDir) - directory containing cordis.patch.yml.
function Set-RemfsPatchRow {
    param([string]$ProfileDir)
    if (-not $ProfileDir) { return $false }
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $patch = Join-Path $ProfileDir "cordis.patch.yml"
    if (Test-Path $patch) {
        $lines = @(Get-Content $patch)
        $out = New-Object System.Collections.Generic.List[string]
        $rowFound = $false
        $inRow = $false
        $injectReplaced = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -match '^\s*- id:\s*remfs-persistent\s*$') {
                $rowFound = $true
                $inRow = $true
                $out.Add($line)
                continue
            }
            if ($inRow) {
                # The row ends at the next top-level "- " list item or an
                # unindented line.
                if ($line -match '^-\s' -or ($line -match '^\S' -and $line -notmatch '^\s')) {
                    $inRow = $false
                } elseif ($line -match '^\s+inject:') {
                    $out.Add('      ' + $script:RemfsPatchInject)
                    $injectReplaced = $true
                    continue
                }
            }
            $out.Add($line)
        }
        if ($rowFound -and $injectReplaced) {
            [System.IO.File]::WriteAllLines($patch, $out.ToArray())
            return $true
        }
        if ($rowFound -and -not $injectReplaced) {
            # Row exists but has no inject line: append the inject line.
            $final = New-Object System.Collections.Generic.List[string]
            foreach ($line in $out) {
                $final.Add($line)
                if ($line -match '^\s*name:\s*''@zetaluolang/remfs-persistent''\s*$') {
                    $final.Add('      ' + $script:RemfsPatchInject)
                    $injectReplaced = $true
                }
            }
            [System.IO.File]::WriteAllLines($patch, $final.ToArray())
            return $true
        }
        # No remfs-persistent row: append a new insert block.
    }
    $block = @(
        '- insert:'
        '    - id: remfs-persistent'
        "      name: '@zetaluolang/remfs-persistent'"
        ('      ' + $script:RemfsPatchInject)
    )
    if (Test-Path $patch) { Add-Content -Path $patch -Value $block -Encoding ascii }
    else { [System.IO.File]::WriteAllLines($patch, [string[]]$block) }
    return $true
}

# The exact row text, for tests/verification.
function Get-RemfsPatchRowText {
    return ('- insert:`n    - id: remfs-persistent`n      name: ''@zetaluolang/remfs-persistent''`n      ' + $script:RemfsPatchInject)
}

# ---------------------------------------------------------------------------
# Tailscale Serve lifecycle (b3dfc4b audit item 2).
#
# `tailscale serve --bg http://127.0.0.1:3080` PERSISTS until explicitly
# disabled and resumes after reboot / Tailscale restart. If the mapping is
# left active after our stack stops, a foreign process that later binds
# localhost:3080 could be proxied into the tailnet. Rules:
#   - enable/verify ONLY after our dsh process is confirmed to own :3080
#   - disable ONLY this project's mapping on stop
#   - NEVER use `tailscale serve reset` (it destroys unrelated user config)
# ---------------------------------------------------------------------------

# The exact proxy target our serve mapping points at.
$script:RemfsServeTarget = "http://127.0.0.1:3080"

# Resolve the tailscale CLI: explicit path, PATH, or the standard Windows
# install location. Returns "" when unavailable.
function Resolve-TsCli {
    param([string]$TsCli)
    if ($TsCli -and $TsCli -ne "tailscale" -and (Test-Path $TsCli)) { return $TsCli }
    if ($TsCli -eq "tailscale") {
        $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $std = "C:\Program Files\Tailscale\tailscale.exe"
    if (Test-Path $std) { return $std }
    return ""
}

# True when the CURRENT serve config maps the tailnet HTTPS entry to OUR
# target. Parses `tailscale serve status --json` (Web.<host>:443.Handlers["/"]
# .Proxy). Returns $false when there is no serve config, the mapping is
# foreign, or the CLI is unavailable - a foreign mapping must never be
# disabled or re-enabled by us.
# param([string]$TsCli) - tailscale CLI path (default: resolve from PATH).
function Test-OwnedServeMapping {
    param([string]$TsCli = "tailscale")
    $cli = Resolve-TsCli $TsCli
    if (-not $cli) { return $false }
    $json = (& $cli serve status --json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $false }
    try {
        $obj = $json | ConvertFrom-Json
        if (-not $obj.Web) { return $false }
        foreach ($prop in $obj.Web.PSObject.Properties) {
            if ($prop.Value -and $prop.Value.Handlers) {
                foreach ($h in $prop.Value.Handlers.PSObject.Properties) {
                    if ($h.Value -and $h.Value.Proxy -and $h.Value.Proxy -eq $script:RemfsServeTarget) {
                        return $true
                    }
                }
            }
        }
    } catch { }
    return $false
}

# True when the serve config has ANY web handler at all (ours or foreign).
function Test-AnyServeMapping {
    param([string]$TsCli = "tailscale")
    $cli = Resolve-TsCli $TsCli
    if (-not $cli) { return $false }
    $json = (& $cli serve status --json 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $false }
    try {
        $obj = $json | ConvertFrom-Json
        if (-not $obj.Web) { return $false }
        foreach ($prop in $obj.Web.PSObject.Properties) {
            if ($prop.Value -and $prop.Value.Handlers) { return $true }
        }
    } catch { }
    return $false
}

# Enable the serve mapping ONLY when the harness process owns :3080 AND there
# is no FOREIGN serve mapping to clobber. Never touches an existing mapping.
# param([string]$TsCli) - tailscale CLI path.
# param([bool]$HarnessOwned) - pass Test-HarnessRunning's result; without
#   verified ownership we refuse to create the mapping.
function Enable-OwnedServe {
    param([string]$TsCli = "tailscale", [bool]$HarnessOwned = $false)
    if (-not $HarnessOwned) { return $false }
    $cli = Resolve-TsCli $TsCli
    if (-not $cli) { return $false }
    if (Test-OwnedServeMapping -TsCli $cli) { return $true }
    # A foreign mapping exists: enabling would overwrite unrelated user config.
    if (Test-AnyServeMapping -TsCli $cli) { return $false }
    & $cli serve --bg $script:RemfsServeTarget 2>$null | Out-Null
    Start-Sleep -Milliseconds 800
    return (Test-OwnedServeMapping -TsCli $cli)
}

# Disable ONLY our serve mapping (never `serve reset`, never a foreign
# mapping). Uses `serve --bg --https=443 off` which removes just the 443 web
# serve entry; unrelated user serve config is untouched.
# param([string]$TsCli) - tailscale CLI path.
function Disable-OwnedServe {
    param([string]$TsCli = "tailscale")
    $cli = Resolve-TsCli $TsCli
    if (-not $cli) { return $false }
    if (-not (Test-OwnedServeMapping -TsCli $cli)) { return $false }
    & $cli serve --bg --https=443 off 2>$null | Out-Null
    Start-Sleep -Milliseconds 800
    return (-not (Test-OwnedServeMapping -TsCli $cli))
}

# Quarantine corrupt demo session folders (e.g. "demo-presence-*" left by
# phone-side presence demos). dsh's workspace plugin VALIDATES every session
# log at startup and aborts the whole plugin tree on the first corrupt one, so
# a stray demo session bricks the launcher. The scan is RECURSIVE: observed
# corrupt artifacts also appear nested inside a stray workspace-key directory
# (e.g. sessions\<ws>\--C-Users-...--\demo-presence-*), so any descendant
# matching demo/presence OR a nested workspace-key directory is quarantined.
# Folders are MOVED aside (never deleted) before the harness starts.
# Returns the relative paths of what was moved.
function Quarantine-DemoSessions {
    param(
        [string]$SessionsRoot = (Join-Path $env:USERPROFILE ".dsh\sessions"),
        [string]$QuarantineRoot = (Join-Path $env:USERPROFILE ".dsh\sessions-quarantine")
    )
    $moved = @()
    if (-not (Test-Path $SessionsRoot)) { return $moved }
    $workspaces = Get-ChildItem -LiteralPath $SessionsRoot -Directory -ErrorAction SilentlyContinue
    foreach ($ws in $workspaces) {
        $suspects = Get-ChildItem -LiteralPath $ws.FullName -Directory -Recurse -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -match '^(demo|presence)-' -or
                $_.Name -match '-presence-' -or
                $_.Name -match '^--.*--$'
            } |
            Sort-Object { $_.FullName.Length }
        foreach ($sd in $suspects) {
            if (-not (Test-Path $sd.FullName)) { continue }
            $destDir = Join-Path $QuarantineRoot $ws.Name
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            $dest = Join-Path $destDir $sd.Name
            if (Test-Path $dest) {
                $dest = Join-Path $destDir ($sd.Name + '-' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
            }
            Move-Item -LiteralPath $sd.FullName -Destination $dest -Force -ErrorAction SilentlyContinue
            if (Test-Path $dest) { $moved += $sd.FullName.Substring($ws.FullName.Length + 1) }
        }
    }
    return $moved
}
