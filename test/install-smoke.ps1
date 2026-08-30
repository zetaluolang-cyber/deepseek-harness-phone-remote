# Deployment smoke test (bug-fix pass: full lib/ copy, no per-file list).
# Verifies: (1) the deploy package ships every lib module, (2) package.json
# ships lib/, (3) install.ps1 copies the WHOLE lib dir, (4) a dry deployment
# actually yields an importable security.js. Windows PowerShell 5.1 compatible.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pkg = Join-Path $root "remfs-persistent"

$required = @("host.js", "client.js", "security.js", "dispatch.js")

# 1) every lib file present in the deploy package
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $pkg "lib\$f"))) {
        Write-Error "missing lib\$f in the deploy package"
        exit 1
    }
}

# 2) package.json ships the whole lib dir
$pj = Get-Content (Join-Path $pkg "package.json") -Raw | ConvertFrom-Json
if ($null -eq $pj.files -or $pj.files -notcontains "lib") {
    Write-Error "package.json files must include 'lib'"
    exit 1
}

# 3) install.ps1 copies the whole lib dir (Recurse), never a per-file list
$install = Get-Content (Join-Path $root "install.ps1") -Raw
if ($install -match 'Copy-Item\s+\(Join-Path\s+\$pkgSrc\s+"lib\\\*"\)\s+\(Join-Path\s+\$pkgDst\s+"lib"\)\s+-Recurse') {
    # ok
} else {
    Write-Error "install.ps1 must copy the whole lib dir (Copy-Item ... lib ... -Recurse)"
    exit 1
}

# 4) dry deployment to a temp profile and import the deployed security module
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("remfs-smoke-" + [guid]::NewGuid().ToString("N"))
$profileDir = Join-Path $tmp "profiles\web"
$dst = Join-Path $profileDir "vendor\remfs-persistent"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $pkg "package.json") (Join-Path $dst "package.json") -Force
Copy-Item (Join-Path $pkg "lib") (Join-Path $dst "lib") -Recurse -Force
try {
    foreach ($f in $required) {
        if (-not (Test-Path (Join-Path $dst "lib\$f"))) {
            Write-Error "dry deployment missing lib\$f"
            exit 1
        }
    }
    $url = "file:///" + ((Join-Path $dst "lib\security.js") -replace '\\', '/')
    & node --input-type=module -e "const m = await import('$url'); if (!m || typeof m.verifyDevice !== 'function') process.exit(1);" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "deployed security.js is not importable"
        exit 1
    }
    Write-Host "install smoke: OK (full lib dir deployed, security.js importable)"
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# 5) install.ps1 must never print a blank "https://" phone URL when the
#    Tailscale MagicDNS name is unavailable (65c52ca audit item 6): the print
#    must be guarded by a tsName validity check, and appear exactly once.
$httpsHits = [regex]::Matches($install, 'https://\$tsName')
if ($httpsHits.Count -ne 1) {
    Write-Error "install.ps1 must print the https phone URL exactly once (guarded); found $($httpsHits.Count)"
    exit 1
}
if ($install -notmatch '(?s)if \(\$tsName -match ''\\\.ts\\\.net\$''\) \{.*?https://\$tsName') {
    Write-Error "install.ps1 phone-URL print must be guarded by a valid tsName check"
    exit 1
}
Write-Host "install smoke: OK (phone URL guarded, no blank https://)"

# 6) A clean install must own a deterministic DSH runtime. Never depend on an
#    incidental npx cache, and generate the launcher before its shortcut.
if ($install -notmatch 'runtime.*node_modules\\@deepseek-ai\\dsh' -or
    $install -notmatch 'npm install --prefix \$runtimeDir' -or
    $install -notmatch '@deepseek-ai/dsh@latest') {
    Write-Error "install.ps1 must install a private DeepSeek Harness runtime"
    exit 1
}
if ($install -match 'npm-cache\\_npx|Get-DshCandidates') {
    Write-Error "install.ps1 must not depend on the npx cache"
    exit 1
}
if ($install -notmatch '\$dshVersion' -or $install -notmatch '__DSHVERSION__') {
    Write-Error "install.ps1 must record the installed dsh version into start_harness.ps1"
    exit 1
}
$launcherWrite = $install.IndexOf('[System.IO.File]::WriteAllText($launcherPs1')
$shortcutCreate = $install.IndexOf('$wsShell.CreateShortcut($lnkPath)')
if ($launcherWrite -lt 0 -or $shortcutCreate -lt 0 -or $launcherWrite -gt $shortcutCreate) {
    Write-Error "installer must write start_harness.ps1 before creating its shortcut"
    exit 1
}
$tpl = Get-Content (Join-Path $root "start_harness.template.ps1") -Raw
if ($tpl -notmatch '__DSHVERSION__' -or $tpl -notmatch '__NODEBIN__') {
    Write-Error "launcher template must declare DSH version and Node path placeholders"
    exit 1
}
if ($tpl -match 'npx cache|npm-cache|npx @deepseek-ai') {
    Write-Error "launcher must not tell users to repair an incidental npx cache"
    exit 1
}
Write-Host "install smoke: OK (private DSH runtime, launcher-before-shortcut ordering)"

$oneClickPath = (Get-ChildItem -LiteralPath $root -Filter *.cmd | Select-Object -First 1).FullName
$oneClick = Get-Content -LiteralPath $oneClickPath -Raw
if ($oneClick -notmatch 'if errorlevel 1' -or $oneClick -notmatch 'exit /b 1') {
    Write-Error "one-click CMD must preserve install.ps1 failure instead of printing success"
    exit 1
}
Write-Host "install smoke: OK (one-click CMD propagates failure)"

# 7) b3dfc4b audit item 1 (P0): install.ps1 must write the FOUR-service inject
#    row the host half requires, through the SHARED Set-RemfsPatchRow helper
#    (which also MIGRATES an existing row) - never a stale two-service row.
if ($install -notmatch 'Set-RemfsPatchRow') {
    Write-Error "install.ps1 must call the shared Set-RemfsPatchRow helper (single source of truth for the patch row)"
    exit 1
}
if ($install -match "inject:\s*\[connection,\s*fs\]\s*$") {
    Write-Error "install.ps1 must not write a stale two-service inject row"
    exit 1
}
# The four-service inject row lives in the shared helper (harness-common.ps1).
$common = Get-Content (Join-Path $root "harness-common.ps1") -Raw
if ($common -notmatch "inject:\s*\[connection,\s*fs,\s*sandboxPolicy,\s*workspaceRegistry\]") {
    Write-Error "Set-RemfsPatchRow (harness-common.ps1) must write the four-service inject row"
    exit 1
}
if ($common -notmatch 'function Set-RemfsPatchRow') {
    Write-Error "harness-common.ps1 must define the shared Set-RemfsPatchRow function"
    exit 1
}
Write-Host "install smoke: OK (installer writes the four-service inject row via shared helper)"

# 8) b3dfc4b audit item 2: install.ps1 must NOT enable Tailscale Serve
#    unconditionally at install time (the launcher owns the serve lifecycle
#    and only enables it after DSH ownership is verified), and must NEVER use
#    `tailscale serve reset` anywhere.
if ($install -match 'tailscale serve reset|serve reset') {
    Write-Error "install.ps1 must never use 'tailscale serve reset' (would destroy unrelated user config)"
    exit 1
}
if ($install -match 'serve --bg http://127\.0\.0\.1:3080') {
    Write-Error "install.ps1 must not enable Tailscale Serve before DSH ownership is verified (launcher owns the serve lifecycle)"
    exit 1
}
Write-Host "install smoke: OK (no unconditional serve enable, no serve reset)"

# 9) b3dfc4b audit item 4 (SEMVER): Get-VersionKey must be a CORRECT
#    zero-padded semantic-version comparator. The previous implementation did
#    not zero-pad major/minor/patch, so 0.10.0 sorted BELOW 0.9.0 and
#    rc.10 below rc.9. We test the SHARED function from harness-common.ps1
#    (the exact one install.ps1 runs), not a copy.
. (Join-Path $root "harness-common.ps1")
if (-not (Get-Command Get-VersionKey -ErrorAction SilentlyContinue)) {
    Write-Error "Get-VersionKey must live in harness-common.ps1 (shared with install.ps1)"
    exit 1
}
if ($install -match 'function Get-VersionKey') {
    Write-Error "install.ps1 must not define its own Get-VersionKey - use the shared comparator"
    exit 1
}
function Assert-LessThan([string]$a, [string]$b) {
    $ka = Get-VersionKey $a
    $kb = Get-VersionKey $b
    if (-not ($ka.CompareTo($kb) -lt 0)) {
        Write-Error "SemVer ordering broken: '$a' ($ka) must sort BEFORE '$b' ($kb)"
        exit 1
    }
}
Assert-LessThan '0.9.0' '0.10.0'
Assert-LessThan '1.9.0' '1.10.0'
Assert-LessThan '0.1.0-rc.9' '0.1.0-rc.10'
Assert-LessThan '0.1.0-rc.10' '0.1.0'
Write-Host "semver: OK (0.9.0<0.10.0, 1.9.0<1.10.0, rc.9<rc.10, rc.10<0.1.0)"
