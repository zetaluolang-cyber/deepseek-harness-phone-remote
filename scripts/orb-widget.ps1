<#
  orb-widget.ps1 — always-on-top DSH Agent Presence ball for Windows (v2).

  Zero-dependency WinForms companion to the in-page Orb:
    - Crisp DPI-aware rendering (SetProcessDPIAware + per-monitor scale)
    - Brand DSH ball: blue gradient + white whale + glossy highlight
    - Particle embers + sinusoidal breathing glow (state-tinted)
    - Always-visible status tag below the ball (state text + task title,
      toggleable from the right-click menu)
    - Click = open the harness; drag = move (position persisted)

  Usage:
    powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File orb-widget.ps1
#>
param(
  [int]$IntervalSeconds = 8,
  [string]$PresenceUrl = 'http://127.0.0.1:3080/remfs-presence.json',
  [string]$HarnessUrl = 'http://127.0.0.1:3080/',
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

# ── DPI awareness FIRST (before any window / GDI object is created) ─────────
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class DpiNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@ -ErrorAction SilentlyContinue
try { [DpiNative]::SetProcessDPIAware() | Out-Null } catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$posFile = Join-Path $env:USERPROFILE '.dsh\orb-widget-pos.json'
$logFile = Join-Path $env:USERPROFILE '.dsh\orb-widget.log'
function Log([string]$msg) {
  try { Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg) -Encoding UTF8 } catch { }
}

# ── single-instance guard ───────────────────────────────────────────────────
# Started by the Startup entry, the .cmd or a shortcut — only one ball may
# exist. Match only real launches ("-File ...orb-widget.ps1"); diagnostic
# shells that merely mention the path must not count.
$others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File[^"]*orb-widget\.ps1' }
if ($others) { exit 0 }

# ── state mapping (mirrors the web Orb / lib/presence/ui.js) ──────────────
$P_NEEDS = 'NEEDS_USER'; $P_FAILED = 'FAILED'; $P_STALE = 'STALE'; $P_RUNNING = 'RUNNING'
$P_DONE = 'DONE'; $P_IDLE = 'IDLE'; $P_DISC = 'DISCONNECTED'
$P_PRIORITY = @{ $P_NEEDS = 0; $P_FAILED = 1; $P_STALE = 2; $P_RUNNING = 3; $P_DONE = 4; $P_IDLE = 5; $P_DISC = 6 }
$P_COLOR = @{ $P_IDLE = [System.Drawing.Color]::FromArgb(125, 132, 148); $P_RUNNING = [System.Drawing.Color]::FromArgb(74, 108, 247); $P_STALE = [System.Drawing.Color]::FromArgb(245, 158, 11); $P_NEEDS = [System.Drawing.Color]::FromArgb(251, 191, 36); $P_FAILED = [System.Drawing.Color]::FromArgb(239, 68, 68); $P_DONE = [System.Drawing.Color]::FromArgb(34, 197, 94); $P_DISC = [System.Drawing.Color]::FromArgb(156, 163, 175) }
$P_GLYPH = @{ $P_IDLE = '○'; $P_RUNNING = '●'; $P_STALE = '◐'; $P_NEEDS = '!'; $P_FAILED = '×'; $P_DONE = '✓'; $P_DISC = '?' }
$P_TEXT = @{ $P_IDLE = 'Idle'; $P_RUNNING = 'Running'; $P_STALE = 'Stalled'; $P_NEEDS = 'Needs you'; $P_FAILED = 'Failed'; $P_DONE = 'Done'; $P_DISC = 'Disconnected' }

# ── form ───────────────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = 'DSH Orb'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Magenta # transparent key
$form.TransparencyKey = [System.Drawing.Color]::Magenta
$null = $form.Handle # force handle creation so the DPI query returns real values

# crisp DPI-scaled geometry (46 px ball at 96 DPI; scales on HiDPI screens)
$dpiScale = 1.0
try {
  $g0 = [System.Drawing.Graphics]::FromHwnd($form.Handle)
  $dpiScale = $g0.DpiX / 96.0
  $g0.Dispose()
} catch { }
$SIZE = [int][Math]::Round(46 * $dpiScale)
$TAG_H = [int][Math]::Round(22 * $dpiScale)
$form.ClientSize = [System.Drawing.Size]::new($SIZE, $SIZE + $TAG_H)

# restore persisted position (clamped to a screen working area)
try {
  if (Test-Path $posFile) {
    $p = Get-Content $posFile -Raw | ConvertFrom-Json
    if ($p -and $p.x -is [int] -and $p.y -is [int]) {
      $form.Location = [System.Drawing.Point]::new([int]$p.x, [int]$p.y)
    }
  }
} catch { }
if ($form.Location.X -eq 0 -and $form.Location.Y -eq 0) {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = [System.Drawing.Point]::new($wa.Right - $SIZE - 16, $wa.Bottom - $SIZE - $TAG_H - 16)
}

$current = @{ state = $P_DISC; title = ''; text = $P_DISC; prev = $null }
$drag = @{ on = $false; sx = 0; sy = 0; ox = 0; oy = 0; moved = $false }
$fx = @{ time = 0.0; particles = @(); showTag = $true }

# ── brand whale (same SVG path as the web Orb) ──────────────────────────────
$WHALE_SVG = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

# Minimal SVG path -> GraphicsPath parser (M / C / L / Z, explicit commands).
function New-WhalePath {
  param([string]$d)
  $gp = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $tokens = [regex]::Matches($d, '[MCLZ]|-?\d+(?:\.\d+)?') | ForEach-Object { $_.Value }
  $i = 0
  $cur = $null
  while ($i -lt $tokens.Count) {
    $cmd = $tokens[$i]; $i++
    switch ($cmd) {
      'M' {
        if ($i + 1 -lt $tokens.Count) {
          $cur = @([double]$tokens[$i], [double]$tokens[$i + 1]); $i += 2
          $gp.StartFigure()
        }
      }
      'L' {
        if ($i + 1 -lt $tokens.Count) {
          $p = @([double]$tokens[$i], [double]$tokens[$i + 1]); $i += 2
          $gp.AddLine([float]$cur[0], [float]$cur[1], [float]$p[0], [float]$p[1])
          $cur = $p
        }
      }
      'C' {
        if ($i + 5 -lt $tokens.Count) {
          $p = @([double]$tokens[$i], [double]$tokens[$i + 1], [double]$tokens[$i + 2], [double]$tokens[$i + 3], [double]$tokens[$i + 4], [double]$tokens[$i + 5]); $i += 6
          $gp.AddBezier([float]$cur[0], [float]$cur[1], [float]$p[0], [float]$p[1], [float]$p[2], [float]$p[3], [float]$p[4], [float]$p[5])
          $cur = @($p[4], $p[5])
        }
      }
      'Z' { $gp.CloseFigure() }
    }
  }
  return $gp
}
$whalePath = New-WhalePath $WHALE_SVG
$whaleBounds = $whalePath.GetBounds()

# ── particles ───────────────────────────────────────────────────────────────
function Spawn-Burst([int]$count) {
  $c = $P_COLOR[$current.state]
  if (-not $c) { $c = $P_COLOR[$P_DISC] }
  for ($i = 0; $i -lt $count; $i++) {
    $ang = (Get-Random -Maximum 360) * [Math]::PI / 180
    $speed = (0.4 + (Get-Random -Maximum 100) / 100.0) * $dpiScale
    $r = $SIZE * 0.45
    $fx.particles += @{
      x = ($SIZE / 2) + [Math]::Cos($ang) * $r
      y = ($SIZE / 2) + [Math]::Sin($ang) * $r
      vx = [Math]::Cos($ang) * $speed
      vy = [Math]::Sin($ang) * $speed
      life = 1.0
      decay = 0.015 + (Get-Random -Maximum 25) / 1000.0
      size = (1.5 + (Get-Random -Maximum 25) / 10.0) * $dpiScale
      color = $c
    }
  }
}

function Update-Particles {
  $alive = @()
  foreach ($p in $fx.particles) {
    $p.x += $p.vx
    $p.y += $p.vy
    $p.vy -= 0.015 * $dpiScale # slight buoyancy
    $p.life -= $p.decay
    if ($p.life -gt 0) { $alive += $p }
  }
  $fx.particles = $alive
  # spawn rate by state: alert states breathe embers, running/stale a gentle
  # trail, done a soft sprinkle, idle/disconnected none
  $rate = 0
  if ($current.alert) { $rate = 2 }
  elseif ($current.state -eq $P_RUNNING -or $current.state -eq $P_STALE) { $rate = 1 }
  elseif ($current.state -eq $P_DONE) { $rate = 1 }
  if ($rate -gt 0 -and (Get-Random -Maximum 100) -lt ($rate * 40)) {
    Spawn-Burst 1
  }
  if ($fx.particles.Count -gt 70) { $fx.particles = $fx.particles | Select-Object -Last 50 }
}

# ── paint (brand ball + particles + breathing glow + status tag) ───────────
$form.Add_Paint({
  param($sender, $e)
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $c = $P_COLOR[$current.state]
  if (-not $c) { $c = $P_COLOR[$P_DISC] }
  $quiet = ($current.state -eq $P_IDLE -or $current.state -eq $P_DONE -or $current.state -eq $P_DISC)
  $breath = 0.5 + 0.5 * [Math]::Sin($fx.time * ([Math]::PI * 2) / 1.6) # 1.6s breathing period
  $rect = [System.Drawing.Rectangle]::new(2, 2, $SIZE - 4, $SIZE - 4)

  # ── particles (behind the ball) ──
  foreach ($p in $fx.particles) {
    $pa = [int](120 * $p.life)
    $pb = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($pa, $p.color.R, $p.color.G, $p.color.B))
    $pr = [single]($p.size * (0.5 + 0.5 * $p.life))
    $g.FillEllipse($pb, [single]($p.x - $pr), [single]($p.y - $pr), $pr * 2, $pr * 2)
    $pb.Dispose()
  }

  # ── breathing halo ──
  $haloBase = if ($current.alert) { 34 } elseif ($quiet) { 12 } else { 22 }
  $haloA = [int]($haloBase * (0.6 + 0.4 * $breath))
  $halo = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($haloA, $c.R, $c.G, $c.B))
  $hh = [int][Math]::Round($SIZE * 0.22)
  $g.FillEllipse($halo, -$hh, -$hh, $SIZE + $hh * 2, $SIZE + $hh * 2)
  $halo.Dispose()

  # ── ball face: brand blue gradient + glossy highlight ──
  $alpha = if ($quiet) { 195 } else { 255 }
  $light = [System.Drawing.Color]::FromArgb($alpha, 123, 150, 255)
  $dark = [System.Drawing.Color]::FromArgb($alpha, 44, 75, 214)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $light, $dark, 65.0)
  $g.FillEllipse($brush, $rect)
  $brush.Dispose()
  # gloss: translucent white ellipse, top-left
  $gloss = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(60, 255, 255, 255))
  $gw = [int][Math]::Round($SIZE * 0.5)
  $gh = [int][Math]::Round($SIZE * 0.3)
  $g.FillEllipse($gloss, [int][Math]::Round($SIZE * 0.14), [int][Math]::Round($SIZE * 0.1), $gw, $gh)
  $gloss.Dispose()

  # ── white brand whale ──
  $scale = (($SIZE - 10) / [Math]::Max($whaleBounds.Width, $whaleBounds.Height))
  $tx = (($SIZE - $whaleBounds.Width * $scale) / 2) - $whaleBounds.X * $scale
  $ty = (($SIZE - $whaleBounds.Height * $scale) / 2) - $whaleBounds.Y * $scale
  $mat = [System.Drawing.Drawing2D.Matrix]::new()
  $mat.Translate([float]$tx, [float]$ty); $mat.Scale([float]$scale, [float]$scale)
  $g.Transform = $mat
  $g.FillPath([System.Drawing.Brushes]::White, $whalePath)
  $g.ResetTransform()
  $mat.Dispose()

  # ── state ring (breathing alpha; alert pulses harder) ──
  $ringW = if ($current.alert) { [single](3.0 * $dpiScale) } else { [single](2.0 * $dpiScale) }
  $ringBase = if ($current.alert) { 150 } elseif ($quiet) { 120 } else { 220 }
  $ringA = [int]($ringBase * (0.55 + 0.45 * $breath))
  $ringColor = [System.Drawing.Color]::FromArgb([Math]::Min(255, $ringA), $c.R, $c.G, $c.B)
  $pen = [System.Drawing.Pen]::new($ringColor, $ringW)
  $g.DrawEllipse($pen, [single](1.5 * $dpiScale), [single](1.5 * $dpiScale), [single]($SIZE - 3 * $dpiScale), [single]($SIZE - 3 * $dpiScale))
  $pen.Dispose()

  # running: dashed spin ring outside
  if ($current.state -eq $P_RUNNING) {
    $spin = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(170, 255, 255, 255), [single](2 * $dpiScale))
    $spin.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $g.DrawEllipse($spin, [single](-3 * $dpiScale), [single](-3 * $dpiScale), [single]($SIZE + 6 * $dpiScale), [single]($SIZE + 6 * $dpiScale))
    $spin.Dispose()
  }

  # ── corner badge: white circle + state glyph ──
  $glyph = $P_GLYPH[$current.state]
  if (-not $glyph) { $glyph = '?' }
  $bs = [int][Math]::Round(18 * $dpiScale)
  $bd = [System.Drawing.Rectangle]::new($SIZE - $bs - 2, -2, $bs, $bs)
  $g.FillEllipse([System.Drawing.Brushes]::White, $bd)
  $g.DrawEllipse(([System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(200, 60, 65, 80), [single](1 * $dpiScale))), $bd)
  $bfont = [System.Drawing.Font]::new('Segoe UI', [single](10 * $dpiScale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bsf = [System.Drawing.StringFormat]::new()
  $bsf.Alignment = [System.Drawing.StringAlignment]::Center
  $bsf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $bb = [System.Drawing.SolidBrush]::new($c)
  $bdF = [System.Drawing.RectangleF]::new([single]$bd.X, [single]$bd.Y, [single]$bd.Width, [single]$bd.Height)
  $g.DrawString($glyph, $bfont, $bb, $bdF, $bsf)
  $bfont.Dispose(); $bsf.Dispose(); $bb.Dispose()

  # ── status tag below the ball (state text + task title) ──
  if ($fx.showTag) {
    $text = $P_TEXT[$current.state]
    if (-not $text) { $text = 'Unknown' }
    if ($current.title) { $text = $text + ' · ' + $current.title }
    if ($text.Length -gt 30) { $text = $text.Substring(0, 29) + '…' }
    $tfont = [System.Drawing.Font]::new('Segoe UI', [single](9.5 * $dpiScale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $sz = $g.MeasureString($text, $tfont)
    $padX = [int][Math]::Round(8 * $dpiScale)
    $padY = [int][Math]::Round(3 * $dpiScale)
    $tw = [int][Math]::Min([Math]::Ceiling($sz.Width) + $padX * 2, $SIZE)
    $th = [int][Math]::Ceiling($sz.Height) + $padY * 2
    $tx0 = [int][Math]::Max(0, [Math]::Floor(($SIZE - $tw) / 2))
    $ty0 = $SIZE + [int][Math]::Round(2 * $dpiScale)
    $tagRect = [System.Drawing.Rectangle]::new($tx0, $ty0, $tw, $th)
    $tagPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $rad = [int][Math]::Round(6 * $dpiScale)
    $tagPath.AddArc($tagRect.X, $tagRect.Y, $rad * 2, $rad * 2, 180, 90)
    $tagPath.AddArc($tagRect.Right - $rad * 2, $tagRect.Y, $rad * 2, $rad * 2, 270, 90)
    $tagPath.AddArc($tagRect.Right - $rad * 2, $tagRect.Bottom - $rad * 2, $rad * 2, $rad * 2, 0, 90)
    $tagPath.AddArc($tagRect.X, $tagRect.Bottom - $rad * 2, $rad * 2, $rad * 2, 90, 90)
    $tagPath.CloseFigure()
    $tagBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(200, 18, 20, 26))
    $g.FillPath($tagBrush, $tagPath)
    $tagBrush.Dispose(); $tagPath.Dispose()
    $tsf = [System.Drawing.StringFormat]::new()
    $tsf.Alignment = [System.Drawing.StringAlignment]::Center
    $tsf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $tagRF = [System.Drawing.RectangleF]::new([single]$tagRect.X, [single]$tagRect.Y, [single]$tagRect.Width, [single]$tagRect.Height)
    $g.DrawString($text, $tfont, [System.Drawing.Brushes]::White, $tagRF, $tsf)
    $tfont.Dispose(); $tsf.Dispose()
  }
})

# ── animation timer (particles + breathing) ─────────────────────────────────
$anim = New-Object System.Windows.Forms.Timer
$anim.Interval = 40
$anim.Add_Tick({
  $fx.time += 0.04
  Update-Particles
  $form.Invalidate()
})
$anim.Start()

# ── drag / click ────────────────────────────────────────────────────────────
$form.Add_MouseDown({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $drag.on = $true; $drag.sx = $e.X; $drag.sy = $e.Y; $drag.ox = $form.Left; $drag.oy = $form.Top; $drag.moved = $false
  }
})
$form.Add_MouseMove({
  param($sender, $e)
  if ($drag.on -and $e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $dx = $e.X - $drag.sx; $dy = $e.Y - $drag.sy
    if ([Math]::Abs($dx) -gt 4 -or [Math]::Abs($dy) -gt 4) { $drag.moved = $true }
    $nx = $drag.ox + $dx; $ny = $drag.oy + $dy
    $center = [System.Drawing.Point]::new($form.Left + $SIZE / 2, $form.Top + $SIZE / 2)
    $screen = [System.Windows.Forms.Screen]::FromPoint($center)
    $wa = $screen.WorkingArea
    $nx = [Math]::Max($wa.Left, [Math]::Min($wa.Right - $SIZE, $nx))
    $ny = [Math]::Max($wa.Top, [Math]::Min($wa.Bottom - $SIZE - $TAG_H, $ny))
    $form.Location = [System.Drawing.Point]::new($nx, $ny)
  }
})
$form.Add_MouseUp({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    if ($drag.moved) {
      try { @{ x = $form.Left; y = $form.Top } | ConvertTo-Json | Set-Content -Path $posFile -Encoding UTF8 } catch { }
    } else {
      try { Start-Process $HarnessUrl } catch { }
    }
    $drag.on = $false
  }
})

# ── context menu (right-click) ──────────────────────────────────────────────
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem('打开 Harness')
$openItem.Add_Click({ try { Start-Process $HarnessUrl } catch { } })
$tagItem = New-Object System.Windows.Forms.ToolStripMenuItem('显示状态文字')
$tagItem.CheckOnClick = $true
$tagItem.Checked = $true
$tagItem.Add_Click({ $fx.showTag = $tagItem.Checked; $form.Invalidate() })
$refreshItem = New-Object System.Windows.Forms.ToolStripMenuItem('立即刷新')
$refreshItem.Add_Click({ PollOnce | Out-Null })
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('退出')
$quitItem.Add_Click({ $form.Close() })
$menu.Items.Add($openItem) | Out-Null
$menu.Items.Add($tagItem) | Out-Null
$menu.Items.Add($refreshItem) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($quitItem) | Out-Null
$form.ContextMenuStrip = $menu

# ── tooltip (hover) ─────────────────────────────────────────────────────────
$tip = New-Object System.Windows.Forms.ToolTip
$tip.AutomaticDelay = 400

# ── polling ─────────────────────────────────────────────────────────────────
function Resolve-State {
  param($r)
  $best = $null; $bestP = 99
  if ($r -and $r.ok -and $r.value -and $r.value.tasks) {
    foreach ($t in $r.value.tasks) {
      if (-not $t) { continue }
      $st = [string]$t.state
      $p = $P_PRIORITY[$st]
      if ($null -eq $p) { $p = 99 }
      if ($p -lt $bestP) { $best = $t; $bestP = $p }
    }
  }
  if ($null -eq $best) {
    Set-State $P_IDLE ''
  } else {
    Set-State ([string]$best.state) ([string]$best.title)
  }
}

function Set-State {
  param([string]$st, [string]$title)
  if ($current.state -ne $st) {
    # burst on meaningful transitions: alert up, done, running
    if ($st -eq $P_NEEDS -or $st -eq $P_FAILED) { Spawn-Burst 10 }
    elseif ($st -eq $P_DONE) { Spawn-Burst 8 }
    elseif ($st -eq $P_RUNNING) { Spawn-Burst 4 }
  }
  $current.state = $st
  $current.title = $title
  $tip.SetToolTip($form, ($P_TEXT[$st] + $(if ($title) { ' · ' + $title } else { '' })))
  $form.Invalidate()
}

function PollOnce {
  try {
    $r = Invoke-RestMethod -Uri $PresenceUrl -TimeoutSec 6
    Resolve-State $r
  } catch {
    Set-State $P_DISC 'Harness 不可达 — 检查看门狗 / 端口 3080'
  }
}

$poll = New-Object System.Windows.Forms.Timer
$poll.Interval = [Math]::Max(3, [Math]::Min(60, $IntervalSeconds)) * 1000
$poll.Add_Tick({ PollOnce })
$poll.Start()

$form.Add_Shown({ PollOnce })
$form.Add_FormClosed({
  $poll.Stop(); $anim.Stop()
  try { $poll.Dispose(); $anim.Dispose() } catch { }
})

if (-not $Quiet) { Log "orb widget started (poll ${IntervalSeconds}s)" }
[System.Windows.Forms.Application]::Run($form)
