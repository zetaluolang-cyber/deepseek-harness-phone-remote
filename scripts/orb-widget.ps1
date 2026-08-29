<#
  orb-widget.ps1 — always-on-top DSH Agent Presence ball for Windows.

  A zero-dependency WinForms companion to the in-page Orb: a small circular
  ball that stays on top of every window and shows the highest-priority agent
  state by polling the harness's /remfs-presence.json (same task DTOs the
  in-page Orb renders). Click = open the harness GUI; drag = move it; the
  position is persisted to ~/.dsh/orb-widget-pos.json.

  Usage:
    powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File orb-widget.ps1

  Optional params: -IntervalSeconds 8 -PresenceUrl ... -HarnessUrl ...
  See start-orb-widget.cmd for the double-click launcher.
#>
param(
  [int]$IntervalSeconds = 8,
  [string]$PresenceUrl = 'http://127.0.0.1:3080/remfs-presence.json',
  [string]$HarnessUrl = 'http://127.0.0.1:3080/',
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$posFile = Join-Path $env:USERPROFILE '.dsh\orb-widget-pos.json'
$logFile = Join-Path $env:USERPROFILE '.dsh\orb-widget.log'
function Log([string]$msg) {
  try { Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg) -Encoding UTF8 } catch { }
}

# ── state mapping (mirrors the web Orb / lib/presence/ui.js) ──────────────
$P_NEEDS = 'NEEDS_USER'; $P_FAILED = 'FAILED'; $P_STALE = 'STALE'; $P_RUNNING = 'RUNNING'
$P_DONE = 'DONE'; $P_IDLE = 'IDLE'; $P_DISC = 'DISCONNECTED'
$P_PRIORITY = @{ $P_NEEDS = 0; $P_FAILED = 1; $P_STALE = 2; $P_RUNNING = 3; $P_DONE = 4; $P_IDLE = 5; $P_DISC = 6 }
$P_COLOR = @{ $P_IDLE = [System.Drawing.Color]::FromArgb(125, 132, 148); $P_RUNNING = [System.Drawing.Color]::FromArgb(74, 108, 247); $P_STALE = [System.Drawing.Color]::FromArgb(245, 158, 11); $P_NEEDS = [System.Drawing.Color]::FromArgb(251, 191, 36); $P_FAILED = [System.Drawing.Color]::FromArgb(239, 68, 68); $P_DONE = [System.Drawing.Color]::FromArgb(34, 197, 94); $P_DISC = [System.Drawing.Color]::FromArgb(156, 163, 175) }
$P_GLYPH = @{ $P_IDLE = '○'; $P_RUNNING = '●'; $P_STALE = '◐'; $P_NEEDS = '!'; $P_FAILED = '×'; $P_DONE = '✓'; $P_DISC = '?' }

# ── form ───────────────────────────────────────────────────────────────────
$SIZE = 46
$form = New-Object System.Windows.Forms.Form
$form.Text = 'DSH Orb'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.ClientSize = New-Object System.Drawing.Size($SIZE, $SIZE)
$form.BackColor = [System.Drawing.Color]::Magenta # transparent key — see TransparencyKey below
$form.TransparencyKey = [System.Drawing.Color]::Magenta

# restore persisted position (clamped to a screen working area)
try {
  if (Test-Path $posFile) {
    $p = Get-Content $posFile -Raw | ConvertFrom-Json
    if ($p -and $p.x -is [int] -and $p.y -is [int]) {
      $form.Location = New-Object System.Drawing.Point([int]$p.x, [int]$p.y)
    }
  }
} catch { }
if ($form.Location.X -eq 0 -and $form.Location.Y -eq 0) {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = New-Object System.Drawing.Point($wa.Right - $SIZE - 16, $wa.Bottom - $SIZE - 16)
}

$current = @{ state = $P_DISC; title = ''; text = $P_DISC; glow = 0.0; alert = $false }
$drag = @{ on = $false; sx = 0; sy = 0; ox = 0; oy = 0; moved = $false }

# ── paint ───────────────────────────────────────────────────────────────────
$form.Add_Paint({
  param($sender, $e)
  $g = $e.Graphics
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $c = $P_COLOR[$current.state]
  if (-not $c) { $c = $P_COLOR[$P_DISC] }
  $rect = New-Object System.Drawing.Rectangle(2, 2, $SIZE - 4, $SIZE - 4)

  # alert glow: pulsing outer halo for NEEDS_USER / FAILED
  if ($current.alert) {
    $halo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int](28 + 30 * $current.glow), $c.R, $c.G, $c.B))
    $g.FillEllipse($halo, -4, -4, $SIZE + 8, $SIZE + 8)
    $halo.Dispose()
  }

  # ball face: vertical gradient
  $light = [System.Drawing.Color]::FromArgb([Math]::Min(255, $c.R + 70), [Math]::Min(255, $c.G + 70), [Math]::Min(255, $c.B + 70))
  $dark = [System.Drawing.Color]::FromArgb([Math]::Max(0, $c.R - 60), [Math]::Max(0, $c.G - 60), [Math]::Max(0, $c.B - 60))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $light, $dark, 65.0)
  $g.FillEllipse($brush, $rect)
  $brush.Dispose()

  # running: dashed spin ring
  if ($current.state -eq $P_RUNNING) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, 255, 255, 255), 2)
    $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $g.DrawEllipse($pen, -3, -3, $SIZE + 6, $SIZE + 6)
    $pen.Dispose()
  }

  # state glyph
  $glyph = $P_GLYPH[$current.state]
  if (-not $glyph) { $glyph = '?' }
  $font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $font.Dispose(); $sf.Dispose()
})

# ── pulse timer (alert states only) ─────────────────────────────────────────
$pulse = New-Object System.Windows.Forms.Timer
$pulse.Interval = 300
$pulse.Add_Tick({
  if ($current.alert) {
    $current.glow = if ($current.glow -gt 0.5) { 0.0 } else { 1.0 }
    $form.Invalidate()
  }
})
$pulse.Start()

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
    # clamp into the working area of the screen under the pointer
    $screen = [System.Windows.Forms.Screen]::FromPoint((New-Object System.Drawing.Point($form.Left + $SIZE / 2, $form.Top + $SIZE / 2)))
    $wa = $screen.WorkingArea
    $nx = [Math]::Max($wa.Left, [Math]::Min($wa.Right - $SIZE, $nx))
    $ny = [Math]::Max($wa.Top, [Math]::Min($wa.Bottom - $SIZE, $ny))
    $form.Location = New-Object System.Drawing.Point($nx, $ny)
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
$refreshItem = New-Object System.Windows.Forms.ToolStripMenuItem('立即刷新')
$refreshItem.Add_Click({ PollOnce | Out-Null })
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('退出')
$quitItem.Add_Click({ $form.Close() })
$menu.Items.Add($openItem) | Out-Null
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
    $current.state = $P_IDLE; $current.text = 'Idle'; $current.title = ''; $current.alert = $false
  } else {
    $st = [string]$best.state
    $current.state = $st
    $current.text = [string]$best.text
    $current.title = [string]$best.title
    $current.alert = ($st -eq $P_NEEDS -or $st -eq $P_FAILED)
    $tip.SetToolTip($form, ($current.text + $(if ($current.title) { ' · ' + $current.title } else { '' })))
  }
  $form.Invalidate()
}

function PollOnce {
  try {
    $r = Invoke-RestMethod -Uri $PresenceUrl -TimeoutSec 6
    Resolve-State $r
  } catch {
    $current.state = $P_DISC; $current.text = 'Disconnected'; $current.alert = $false
    $tip.SetToolTip($form, 'Harness 不可达 — 检查 watchdog / 端口 3080')
    $form.Invalidate()
  }
}

$poll = New-Object System.Windows.Forms.Timer
$poll.Interval = [Math]::Max(3, [Math]::Min(60, $IntervalSeconds)) * 1000
$poll.Add_Tick({ PollOnce })
$poll.Start()

$form.Add_Shown({ PollOnce })
$form.Add_FormClosed({
  $poll.Stop(); $pulse.Stop()
  try { $poll.Dispose(); $pulse.Dispose() } catch { }
})

if (-not $Quiet) { Log "orb widget started (poll ${IntervalSeconds}s)" }
[System.Windows.Forms.Application]::Run($form)
