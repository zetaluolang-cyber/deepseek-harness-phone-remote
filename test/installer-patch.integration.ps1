# P0 installer/CI contract integration test (b3dfc4b audit item 1).
#
# The production installer (install.ps1) must write the SAME four-service
# inject row the host half requires:
#     inject: [connection, fs, sandboxPolicy, workspaceRegistry]
# - an EXISTING remfs-persistent row (e.g. from an older install that wrote
#   `inject: [connection, fs]`) must be MIGRATED, not left stale
# - a profile with no row must get the full row inserted
# - real current DeepSeek Harness must boot with the GENERATED cordis.patch.yml
#   and register the /remfs channel
#
# This test runs the ACTUAL shared installer logic (Set-RemfsPatchRow from
# harness-common.ps1) - never a hand-written idealized patch. The CI
# real-dsh-smoke job must call this script (or Set-RemfsPatchRow itself) so
# the CI path and the production installer path are byte-for-byte identical.
#
# When a dsh binary is available (DSH_BIN env or on PATH) it also boots a real
# `dsh web` against the generated profile and verifies /remfs registration.
# Windows PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root "harness-common.ps1")

if (-not (Get-Command Set-RemfsPatchRow -ErrorAction SilentlyContinue)) {
    Write-Error "Set-RemfsPatchRow not defined (harness-common.ps1 missing the shared installer logic?)"
    exit 1
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("remfs-instpatch-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    # ---- case A: brand-new profile (no patch file) ----
    $profileA = Join-Path $tmp "profiles\web"
    Set-RemfsPatchRow -ProfileDir $profileA
    $patchA = Join-Path $profileA "cordis.patch.yml"
    if (-not (Test-Path $patchA)) { Write-Error "case A: patch file not created"; exit 1 }
    $textA = Get-Content $patchA -Raw
    if ($textA -notmatch "inject:\s*\[connection,\s*fs,\s*sandboxPolicy,\s*workspaceRegistry\]") {
        Write-Error "case A: new row must carry the four-service inject list:`n$textA"
        exit 1
    }
    if ($textA -notmatch 'remfs-persistent') { Write-Error "case A: row must reference remfs-persistent"; exit 1 }
    Write-Host "case A (fresh profile): OK - full four-service row inserted"

    # ---- case B: OLD install row (two-service inject) must be MIGRATED ----
    $profileB = Join-Path $tmp "profiles\web-b"
    New-Item -ItemType Directory -Force -Path $profileB | Out-Null
    $patchB = Join-Path $profileB "cordis.patch.yml"
    @"
# Phone remote workbench (persistent plugin).
- insert:
    - id: remfs-persistent
      name: '@zetaluolang/remfs-persistent'
      inject: [connection, fs]
"@ | Set-Content -Path $patchB -Encoding ascii
    Set-RemfsPatchRow -ProfileDir $profileB
    $textB = Get-Content $patchB -Raw
    if ($textB -match "inject:\s*\[connection,\s*fs\]\s*$") {
        Write-Error "case B: stale two-service inject row was NOT migrated:`n$textB"
        exit 1
    }
    if ($textB -notmatch "inject:\s*\[connection,\s*fs,\s*sandboxPolicy,\s*workspaceRegistry\]") {
        Write-Error "case B: migrated row must carry the four-service inject list:`n$textB"
        exit 1
    }
    if (([regex]::Matches($textB, 'remfs-persistent')).Count -lt 1) {
        Write-Error "case B: migrated patch must keep the remfs-persistent row"
        exit 1
    }
    if (([regex]::Matches($textB, '- insert:')).Count -ne 1) {
        Write-Error "case B: migration must not append a duplicate insert block:`n$textB"
        exit 1
    }
    Write-Host "case B (old row migration): OK - two-service inject migrated to four-service, no duplicate"

    # ---- case C: patch with other content + remfs row; only the inject line changes ----
    $profileC = Join-Path $tmp "profiles\web-c"
    New-Item -ItemType Directory -Force -Path $profileC | Out-Null
    $patchC = Join-Path $profileC "cordis.patch.yml"
    @"
# unrelated machine-local preference - must survive untouched
- insert:
    - id: some-other-plugin
      name: '@acme/other'
- insert:
    - id: remfs-persistent
      name: '@zetaluolang/remfs-persistent'
      inject: [connection, fs]
"@ | Set-Content -Path $patchC -Encoding ascii
    Set-RemfsPatchRow -ProfileDir $profileC
    $textC = Get-Content $patchC -Raw
    if ($textC -notmatch 'some-other-plugin') { Write-Error "case C: unrelated row was destroyed"; exit 1 }
    if ($textC -notmatch "inject:\s*\[connection,\s*fs,\s*sandboxPolicy,\s*workspaceRegistry\]") {
        Write-Error "case C: remfs row not migrated:`n$textC"
        exit 1
    }
    Write-Host "case C (mixed patch): OK - unrelated rows untouched, remfs row migrated"

    # ---- real-DSH boot (only when a dsh binary is available) ----
    $dshBin = $env:DSH_BIN
    if ($dshBin -and -not (Test-Path $dshBin)) { $dshBin = "" }
    if (-not $dshBin) {
        $cmd = Get-Command dsh -ErrorAction SilentlyContinue
        if ($cmd) { $dshBin = $cmd.Source }
    }
    if (-not $dshBin) {
        Write-Host "real-DSH boot: SKIPPED (no dsh binary available; set DSH_BIN to force)"
    } else {
        $bootHome = Join-Path $tmp "dsh-home"
        $profileDir = Join-Path $bootHome "profiles\web"
        Set-RemfsPatchRow -ProfileDir $profileDir
        # install the plugin the way install.ps1 does (vendor + node_modules)
        New-Item -ItemType Directory -Force -Path (Join-Path $profileDir "vendor") | Out-Null
        Copy-Item (Join-Path $root "remfs-persistent") (Join-Path $profileDir "vendor\remfs-persistent") -Recurse -Force
        $nmDir = Join-Path $profileDir "node_modules\@zetaluolang"
        New-Item -ItemType Directory -Force -Path $nmDir | Out-Null
        Copy-Item (Join-Path $root "remfs-persistent") (Join-Path $nmDir "remfs-persistent") -Recurse -Force
        $env:DSH_HOME = $bootHome
        $env:DSH_TELEMETRY_DISABLED = "1"
        $log = Join-Path $tmp "dsh-boot.log"
        # The dsh entry can be a node script (npx cache) OR a global npm wrapper
        # script. Launch node scripts via node.exe/node; run wrapper scripts
        # directly with only the web args.
        $nodeExe = (Get-Command node -ErrorAction SilentlyContinue)
        $launcher = $dshBin
        $bootArgs = @("web", "--port", "3182")
        if ($dshBin -like '*.js') {
            if (-not $nodeExe) { Write-Error "node required to boot the dsh entry $dshBin"; exit 1 }
            $launcher = $nodeExe.Source
            $bootArgs = @($dshBin) + $bootArgs
        }
        $p = Start-Process -FilePath $launcher -ArgumentList $bootArgs -WindowStyle Hidden `
            -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru
        $registered = $false
        $pocket = $false
        for ($i = 0; $i -lt 90; $i++) {
            Start-Sleep -Seconds 2
            if (Test-Path $log) {
                $txt = Get-Content $log -Raw -ErrorAction SilentlyContinue
                if ($txt -match "host applied: /remfs \+ /pocket channels registered") {
                    $registered = $true; $pocket = $true; break
                }
                if ($txt -match "host applied: /remfs channel registered") { $registered = $true }
            }
            if ($p.HasExited) { break }
        }
        if (-not $registered) {
            Write-Error "real-DSH boot: /remfs never registered with the installer-generated patch. Log:`n$(Get-Content $log -Raw -ErrorAction SilentlyContinue)"
            exit 1
        }
        Write-Host "real-DSH boot: OK - /remfs registered using the installer-generated cordis.patch.yml (pocket: $pocket)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    Write-Host "installer patch integration: OK"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
