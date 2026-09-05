<#
  orb-widget.ps1 — always-on-top DSH desktop companion for Windows (v5).

  Per-pixel-alpha layered window: only the orb, energy rings and particles are
  visible. There is no card background and no TransparencyKey/color-key leak.

    - DPI-aware crisp rendering (SetProcessDPIAware + system-DPI scaling)
    - Brand DSH ball: blue gradient + white whale + glossy highlight
    - Orbital sparks + comet trails + state bursts + rotating energy ring
    - Compact always-on-top presence companion (single instance)
    - Click = task quick panel; panel button = open Harness
    - Drag = move (position persisted across monitors)

  Usage:
    powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File orb-widget.ps1
#>
param(
  [int]$IntervalSeconds = 8,
  [string]$PresenceUrl = 'http://127.0.0.1:3080/remfs-presence.json',
  [string]$HarnessUrl = 'http://127.0.0.1:3080/',
  [switch]$Quiet,
  [switch]$SmokeTest,
  [string]$SmokeScreenshotPath = ''
)
$ErrorActionPreference = 'Stop'

# ── pure state-decision module (extracted for testability) ────────────────
# The poll-to-display decision (task state, stale snapshot cache, 401/403,
# offline, toast gating) lives in orb-state.ps1 - functions only, no UI. It
# must sit NEXT TO this script (the repo scripts\ dir and the deployed
# ~/.dsh\launcher copy both carry it). Fail early and loud: a missing module
# at logon beats a silently dead orb.
$orbStateModule = Join-Path $PSScriptRoot 'orb-state.ps1'
if (-not (Test-Path -LiteralPath $orbStateModule)) {
  throw 'orb-state.ps1 is missing next to orb-widget.ps1 - re-run install.ps1'
}
. $orbStateModule

# ── argument-line quoting helper (Windows PowerShell 5.1) ─────────────────
# PS 5.1 Start-Process joins an ArgumentList ARRAY into a raw command line
# with NO quoting, so a spaced path (e.g. C:\Users\My Name\.dsh\...) arrives
# split into several argv tokens. Wrap every token in exactly one pair of
# double quotes and join them into ONE argument string, which 5.1 then hands
# to the child unchanged (same proven style as ConvertTo-ArgLine in
# start_harness.template.ps1).
function ConvertTo-ArgLine {
  param([object[]]$Tokens)
  $out = @()
  foreach ($t in $Tokens) { $out += ('"' + [string]$t + '"') }
  return ($out -join ' ')
}

# ── single-instance guard (FIRST: before any expensive Add-Type) ────────────
# A named mutex is atomic. Process-list matching was both racy and dependent on
# WMI permissions, so two simultaneous Startup launches could still stack.
$mutexCreated = $false
$mutexName = if ($SmokeTest) { 'Local\DshRemoteDesktopCompanionSmoke-' + $PID } else { 'Local\DshRemoteDesktopCompanion' }
$singleInstanceMutex = [System.Threading.Mutex]::new($true, $mutexName, [ref]$mutexCreated)
if (-not $mutexCreated) {
  $singleInstanceMutex.Dispose()
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── DPI + per-pixel-alpha window plumbing ──────────────────────────────────
# UpdateLayeredWindow sends one premultiplied ARGB bitmap to DWM. It never
# exposes a color-key background, and native caption dragging lets Windows move
# the already-composited surface without our paint loop fighting the cursor.
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class DpiNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

public sealed class LayeredOrbForm : Form {
  public int HitCenterX;
  public int HitCenterY;
  public int HitRadius;

  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
      cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
      return cp;
    }
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0084) { // WM_NCHITTEST
      long lp = m.LParam.ToInt64();
      int sx = (short)(lp & 0xffff);
      int sy = (short)((lp >> 16) & 0xffff);
      Point p = PointToClient(new Point(sx, sy));
      int dx = p.X - HitCenterX;
      int dy = p.Y - HitCenterY;
      if (dx * dx + dy * dy > HitRadius * HitRadius) {
        m.Result = new IntPtr(-1); // HTTRANSPARENT: click through clear pixels
        return;
      }
    }
    base.WndProc(ref m);
  }
}

public static class LayeredOrbNative {
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; public POINT(int x0, int y0) { x=x0; y=y0; } }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; public SIZE(int x0, int y0) { cx=x0; cy=y0; } }
  [StructLayout(LayoutKind.Sequential, Pack=1)] struct BLEND { public byte Op, Flags, Alpha, Format; }

  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hDC);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hDC);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hDC, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("user32.dll", SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr dstDC, ref POINT dst, ref SIZE size, IntPtr srcDC, ref POINT src, int key, ref BLEND blend, int flags);
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wp, IntPtr lp);

  public static void SetBitmap(Form form, Bitmap bitmap) {
    IntPtr screen = GetDC(IntPtr.Zero);
    IntPtr memory = CreateCompatibleDC(screen);
    IntPtr hBitmap = IntPtr.Zero;
    IntPtr old = IntPtr.Zero;
    try {
      hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
      old = SelectObject(memory, hBitmap);
      POINT dst = new POINT(form.Left, form.Top);
      POINT src = new POINT(0, 0);
      SIZE size = new SIZE(bitmap.Width, bitmap.Height);
      BLEND blend = new BLEND(); blend.Op = 0; blend.Alpha = 255; blend.Format = 1;
      if (!UpdateLayeredWindow(form.Handle, screen, ref dst, ref size, memory, ref src, 0, ref blend, 2)) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally {
      if (old != IntPtr.Zero) SelectObject(memory, old);
      if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
      DeleteDC(memory);
      ReleaseDC(IntPtr.Zero, screen);
    }
  }

  public static void BeginDrag(IntPtr hwnd) {
    ReleaseCapture();
    SendMessage(hwnd, 0x00A1, new IntPtr(2), IntPtr.Zero); // WM_NCLBUTTONDOWN/HTCAPTION
  }
}
"@ -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') -ErrorAction Stop
try { [DpiNative]::SetProcessDPIAware() | Out-Null } catch { }

$posFile = Join-Path $env:USERPROFILE '.dsh\orb-widget-pos.json'
$logFile = Join-Path $env:USERPROFILE '.dsh\orb-widget.log'
$companionTokenFile = Join-Path $env:USERPROFILE '.dsh\remfs-companion-token'
$LOG_MAX_BYTES = 1MB

# Dedupe + rotate. A per-frame failure (e.g. a paint error at 25fps) must not
# turn the log into a 160 KB wall of the same line: identical consecutive
# messages inside a 60s window are counted, not written.
$logLast = @{ msg = ''; count = 0; at = [DateTime]::MinValue }
function Write-LogLine([string]$line) {
  try {
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt $LOG_MAX_BYTES) {
      Move-Item -Path $logFile -Destination ($logFile + '.old') -Force -ErrorAction SilentlyContinue
    }
    Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $line) -Encoding UTF8
  } catch { }
}
function Log([string]$msg) {
  $now = Get-Date
  if ($msg -eq $logLast.msg -and ($now - $logLast.at).TotalSeconds -lt 60) {
    $logLast.count++
    return
  }
  if ($logLast.count -gt 0) {
    Write-LogLine ('  (previous message repeated ' + $logLast.count + ' more times)')
  }
  $logLast.msg = $msg; $logLast.count = 0; $logLast.at = $now
  Write-LogLine $msg
}

# ── state mapping (mirrors the web Orb / lib/presence/ui.js) ──────────────
$P_NEEDS = 'NEEDS_USER'; $P_FAILED = 'FAILED'; $P_STALE = 'STALE'; $P_RUNNING = 'RUNNING'
$P_DONE = 'DONE'; $P_IDLE = 'IDLE'; $P_DISC = 'DISCONNECTED'
# Virtual transport states (never come from the server; produced by the
# decision module only): UNAUTHORIZED = 401/403 or a redacted body while we
# hold a companion token, OFFLINE = transport failure. Both render with the
# DISCONNECTED silhouette but carry their own labels/tooltips.
$P_UNAUTH = 'UNAUTHORIZED'; $P_OFFLINE = 'OFFLINE'
$P_PRIORITY = @{ $P_NEEDS = 0; $P_FAILED = 1; $P_STALE = 2; $P_RUNNING = 3; $P_DONE = 4; $P_IDLE = 5; $P_DISC = 6; $P_UNAUTH = 7; $P_OFFLINE = 7 }
$P_COLOR = @{ $P_IDLE = [System.Drawing.Color]::FromArgb(125, 132, 148); $P_RUNNING = [System.Drawing.Color]::FromArgb(74, 108, 247); $P_STALE = [System.Drawing.Color]::FromArgb(245, 158, 11); $P_NEEDS = [System.Drawing.Color]::FromArgb(251, 191, 36); $P_FAILED = [System.Drawing.Color]::FromArgb(239, 68, 68); $P_DONE = [System.Drawing.Color]::FromArgb(34, 197, 94); $P_DISC = [System.Drawing.Color]::FromArgb(156, 163, 175); $P_UNAUTH = [System.Drawing.Color]::FromArgb(96, 102, 115); $P_OFFLINE = [System.Drawing.Color]::FromArgb(156, 163, 175) }
$P_GLYPH = @{ $P_IDLE = '○'; $P_RUNNING = '●'; $P_STALE = '◐'; $P_NEEDS = '!'; $P_FAILED = '×'; $P_DONE = '✓'; $P_DISC = '?'; $P_UNAUTH = '?'; $P_OFFLINE = '?' }
$P_TEXT = @{ $P_IDLE = '空闲'; $P_RUNNING = '运行中'; $P_STALE = '可能卡住'; $P_NEEDS = '等待你处理'; $P_FAILED = '失败'; $P_DONE = '已完成'; $P_DISC = '未连接'; $P_UNAUTH = '未授权'; $P_OFFLINE = '离线' }
# States that render calm (no continuous animation). Virtual transport states
# are as quiet as DISCONNECTED so the orb dims instead of buzzing when the
# link is broken or refused.
$P_QUIET = @{ $P_IDLE = $true; $P_DONE = $true; $P_DISC = $true; $P_UNAUTH = $true; $P_OFFLINE = $true }

# ── form ───────────────────────────────────────────────────────────────────
# DPI-scaled transparent canvas. The visible ball is compact; the larger clear
# canvas gives the glow and particle trails room without creating a dark card.
$dpiScale = 1.0
try {
  $g0 = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
  $dpiScale = $g0.DpiX / 96.0
  $g0.Dispose()
} catch { }
$SIZE = [int][Math]::Round(58 * $dpiScale)        # visible ball diameter
$CARD_W = [int][Math]::Round(118 * $dpiScale)     # transparent ARGB canvas
$CARD_H = $CARD_W
$BALL_X = [int][Math]::Round(($CARD_W - $SIZE) / 2)
$BALL_Y = [int][Math]::Round(($CARD_H - $SIZE) / 2)

$form = New-Object LayeredOrbForm
$form.Text = 'DSH Orb'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.ClientSize = [System.Drawing.Size]::new($CARD_W, $CARD_H)
$form.MinimumSize = [System.Drawing.Size]::new($CARD_W, $CARD_H)
$form.MaximumSize = [System.Drawing.Size]::new($CARD_W, $CARD_H)
$form.HitCenterX = [int]($CARD_W / 2)
$form.HitCenterY = [int]($CARD_H / 2)
$form.HitRadius = [int]($SIZE / 2 + 5 * $dpiScale)
Log ("geometry: dpi=" + $dpiScale + " canvas=" + $CARD_W + "x" + $CARD_H + " ball=" + $SIZE)

# Restore persisted position, ACTUALLY clamped to a screen working area. The
# old code documented a clamp it never performed: after unplugging a second
# monitor the card restored off-screen, invisible and unclickable, and the only
# recovery was deleting orb-widget-pos.json by hand. Screen.FromPoint returns
# the nearest screen for an off-screen point, so clamping to its working area
# always brings the card back into view.
# A restored (0,0) is also honoured now - the old "is it 0,0?" test could not
# tell a deliberate top-left drag from "nothing was restored".
$restored = $false
try {
  if (Test-Path $posFile) {
    $p = Get-Content $posFile -Raw | ConvertFrom-Json
    if ($p -and $null -ne $p.x -and $null -ne $p.y) {
      $px = [int]$p.x; $py = [int]$p.y
      $center = [System.Drawing.Point]::new($px + [int]($CARD_W / 2), $py + [int]($CARD_H / 2))
      $wa = [System.Windows.Forms.Screen]::FromPoint($center).WorkingArea
      $px = [Math]::Max($wa.Left, [Math]::Min($wa.Right - $CARD_W, $px))
      $py = [Math]::Max($wa.Top, [Math]::Min($wa.Bottom - $CARD_H, $py))
      $form.Location = [System.Drawing.Point]::new($px, $py)
      $restored = $true
    }
  }
} catch { }
if (-not $restored) {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = [System.Drawing.Point]::new($wa.Right - $CARD_W - 16, $wa.Bottom - $CARD_H - 16)
}

# `alert` drives the emphasised visuals (bigger halo, thicker ring, faster
# embers) for the two states this widget exists to surface. It was read in
# three places but never assigned, so NEEDS_USER/FAILED rendered exactly like
# any other state - Set-State now maintains it.
$current = @{ state = $P_DISC; title = ''; summary = ''; detail = ''; count = 0; updated = ''; alert = $false }
$fx = @{ time = 0.0; particles = @(); staticPainted = $false; hover = $false }

# ── quick panel ─────────────────────────────────────────────────────────────
# The browser no longer has its own floating Orb. This desktop panel is the
# single companion surface: ambient state when collapsed, useful task context
# and high-frequency actions when expanded.
$panel = New-Object System.Windows.Forms.Form
$panel.Text = 'DSH Companion'
$panel.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$panel.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$panel.ShowInTaskbar = $false
$panel.TopMost = $true
$panel.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$panel.BackColor = [System.Drawing.Color]::FromArgb(24, 26, 34)
$panel.ForeColor = [System.Drawing.Color]::FromArgb(240, 242, 248)
$panel.ClientSize = [System.Drawing.Size]::new([int](328 * $dpiScale), [int](238 * $dpiScale))
$panel.MinimumSize = $panel.Size
$panel.MaximumSize = $panel.Size
try {
  $panel.GetType().GetProperty('DoubleBuffered', [System.Reflection.BindingFlags]'Instance,NonPublic').SetValue($panel, $true, $null)
} catch { }

$panelStatus = New-Object System.Windows.Forms.Label
$panelStatus.SetBounds([int](16 * $dpiScale), [int](14 * $dpiScale), [int](260 * $dpiScale), [int](24 * $dpiScale))
$panelStatus.Font = [System.Drawing.Font]::new('Segoe UI', [single](12 * $dpiScale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$panelStatus.AutoEllipsis = $true

$panelClose = New-Object System.Windows.Forms.Button
$panelClose.Text = '×'
$panelClose.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$panelClose.FlatAppearance.BorderSize = 0
$panelClose.ForeColor = [System.Drawing.Color]::FromArgb(170, 176, 190)
$panelClose.BackColor = $panel.BackColor
$panelClose.SetBounds([int](292 * $dpiScale), [int](8 * $dpiScale), [int](28 * $dpiScale), [int](28 * $dpiScale))
$panelClose.Add_Click({ $panel.Hide() })

$panelTitle = New-Object System.Windows.Forms.Label
$panelTitle.SetBounds([int](16 * $dpiScale), [int](45 * $dpiScale), [int](296 * $dpiScale), [int](28 * $dpiScale))
$panelTitle.Font = [System.Drawing.Font]::new('Segoe UI', [single](11 * $dpiScale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$panelTitle.AutoEllipsis = $true

$panelSummary = New-Object System.Windows.Forms.Label
$panelSummary.SetBounds([int](16 * $dpiScale), [int](76 * $dpiScale), [int](296 * $dpiScale), [int](70 * $dpiScale))
$panelSummary.Font = [System.Drawing.Font]::new('Segoe UI', [single](10 * $dpiScale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$panelSummary.ForeColor = [System.Drawing.Color]::FromArgb(184, 190, 204)
$panelSummary.AutoEllipsis = $true

$panelMeta = New-Object System.Windows.Forms.Label
$panelMeta.SetBounds([int](16 * $dpiScale), [int](151 * $dpiScale), [int](296 * $dpiScale), [int](22 * $dpiScale))
$panelMeta.Font = [System.Drawing.Font]::new('Segoe UI', [single](9 * $dpiScale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$panelMeta.ForeColor = [System.Drawing.Color]::FromArgb(130, 138, 154)
$panelMeta.AutoEllipsis = $true

function New-CompanionButton([string]$text, [int]$x, [int]$width) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $text
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 77, 96)
  $button.BackColor = [System.Drawing.Color]::FromArgb(35, 38, 49)
  $button.ForeColor = [System.Drawing.Color]::FromArgb(232, 235, 244)
  $button.SetBounds([int]($x * $dpiScale), [int](188 * $dpiScale), [int]($width * $dpiScale), [int](34 * $dpiScale))
  return $button
}

$panelOpen = New-CompanionButton '打开 Harness' 16 112
$panelOpen.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(74, 108, 247)
$panelOpen.Add_Click({ try { Start-Process $HarnessUrl; $panel.Hide() } catch { } })
$panelRefresh = New-CompanionButton '立即刷新' 136 82
$panelRefresh.Add_Click({ PollOnce })
$panelLog = New-CompanionButton '查看日志' 226 86
$panelLog.Add_Click({ try { Start-Process -FilePath 'notepad.exe' -ArgumentList (ConvertTo-ArgLine @($logFile)) } catch { } })

$panel.Controls.AddRange(@($panelStatus, $panelClose, $panelTitle, $panelSummary, $panelMeta, $panelOpen, $panelRefresh, $panelLog))
$panel.Add_Paint({
  param($sender, $e)
  $c = $P_COLOR[$current.state]
  if (-not $c) { $c = $P_COLOR[$P_DISC] }
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, $c.R, $c.G, $c.B), [single](1.5 * $dpiScale))
  $e.Graphics.DrawRectangle($pen, 1, 1, $panel.ClientSize.Width - 3, $panel.ClientSize.Height - 3)
  $pen.Dispose()
})
function Update-CompanionPanel {
  $stateText = $P_TEXT[$current.state]
  if (-not $stateText) { $stateText = 'Unavailable' }
  $glyph = $P_GLYPH[$current.state]
  if (-not $glyph) { $glyph = '?' }
  $panelStatus.Text = ($glyph + '  ' + $stateText)
  $panelStatus.ForeColor = $P_COLOR[$current.state]
  $panelTitle.Text = if ($current.title) { $current.title } elseif ($current.state -eq $P_IDLE) { '暂无活动任务' } else { $stateText }
  if ($current.detail) { $panelSummary.Text = $current.detail }
  elseif ($current.summary) { $panelSummary.Text = $current.summary }
  elseif ($current.state -eq $P_IDLE) { $panelSummary.Text = 'Harness 已连接，目前没有需要处理的任务。' }
  else { $panelSummary.Text = '等待 Harness 返回任务详情。' }
  $panelMeta.Text = ('任务 ' + $current.count + $(if ($current.updated) { '  ·  更新 ' + $current.updated } else { '' }))
  $panel.Invalidate()
}

function Set-PanelLocation {
  $center = [System.Drawing.Point]::new([int]($form.Left + $CARD_W / 2), [int]($form.Top + $CARD_H / 2))
  $wa = [System.Windows.Forms.Screen]::FromPoint($center).WorkingArea
  $gap = [int](10 * $dpiScale)
  $px = $form.Left - $panel.Width - $gap
  if ($px -lt $wa.Left) { $px = $form.Right + $gap }
  $px = [Math]::Max($wa.Left, [Math]::Min($wa.Right - $panel.Width, $px))
  $py = [Math]::Max($wa.Top, [Math]::Min($wa.Bottom - $panel.Height, $form.Top + $CARD_H - $panel.Height))
  $panel.Location = [System.Drawing.Point]::new($px, $py)
}

function Show-CompanionPanel {
  Update-CompanionPanel
  Set-PanelLocation
  $panel.Show($form)
  $panel.Activate()
}

function Toggle-CompanionPanel {
  if ($panel.Visible) { $panel.Hide() } else { Show-CompanionPanel }
}

# ── brand whale (same SVG path as the web Orb) ──────────────────────────────
$WHALE_SVG = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

function New-WhalePath {
  param([string]$d)
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
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

# ── particles + layered renderer ────────────────────────────────────────────
function Spawn-Burst([int]$count) {
  $c = $P_COLOR[$current.state]
  if (-not $c) { $c = $P_COLOR[$P_DISC] }
  $cx = $BALL_X + $SIZE / 2
  $cy = $BALL_Y + $SIZE / 2
  for ($i = 0; $i -lt $count; $i++) {
    $ang = (Get-Random -Maximum 360) * [Math]::PI / 180
    $speed = (0.75 + (Get-Random -Maximum 170) / 100.0) * $dpiScale
    $r = $SIZE * (0.42 + (Get-Random -Maximum 20) / 100.0)
    $x = $cx + [Math]::Cos($ang) * $r
    $y = $cy + [Math]::Sin($ang) * $r
    $fx.particles += @{
      x = $x; y = $y; px = $x; py = $y
      vx = [Math]::Cos($ang) * $speed
      vy = [Math]::Sin($ang) * $speed
      life = 1.0
      decay = 0.012 + (Get-Random -Maximum 16) / 1000.0
      size = (1.2 + (Get-Random -Maximum 26) / 10.0) * $dpiScale
      color = $c
      white = ((Get-Random -Maximum 100) -lt 28)
    }
  }
}

function Update-Particles {
  $alive = @()
  foreach ($p in $fx.particles) {
    $p.px = $p.x; $p.py = $p.y
    $p.x += $p.vx; $p.y += $p.vy
    $p.vx *= 0.992; $p.vy *= 0.992
    $p.vy -= 0.004 * $dpiScale
    $p.life -= $p.decay
    if ($p.life -gt 0) { $alive += $p }
  }
  $fx.particles = $alive

  # Continuous state-aware sparks. Hovering wakes a quiet orb without turning
  # idle into a noisy permanent animation.
  $chance = 0
  if ($current.alert) { $chance = 20 }
  elseif ($current.state -eq $P_RUNNING) { $chance = 13 }
  elseif ($current.state -eq $P_STALE) { $chance = 8 }
  elseif ($fx.hover) { $chance = 10 }
  if ($chance -gt 0 -and (Get-Random -Maximum 100) -lt $chance) { Spawn-Burst 1 }
  if ($fx.particles.Count -gt 72) { $fx.particles = @($fx.particles | Select-Object -Last 56) }
}

$orbBitmap = [System.Drawing.Bitmap]::new(
  $CARD_W, $CARD_H,
  [System.Drawing.Imaging.PixelFormat]::Format32bppPArgb
)

function Render-Orb {
  if (-not $form.IsHandleCreated -or $form.IsDisposed) { return }
  $g = $null
  try {
    $g = [System.Drawing.Graphics]::FromImage($orbBitmap)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $c = $P_COLOR[$current.state]
    if (-not $c) { $c = $P_COLOR[$P_DISC] }
    $quiet = $P_QUIET[$current.state] -eq $true
    $animated = (-not $quiet -or $fx.hover)
    $breath = if ($animated) { 0.5 + 0.5 * [Math]::Sin($fx.time * ([Math]::PI * 2) / 1.75) } else { 0.42 }
    $cx = [single]($BALL_X + $SIZE / 2)
    $cy = [single]($BALL_Y + $SIZE / 2)

    # Soft alpha glow — this is light, not a rectangular/card background.
    for ($layer = 3; $layer -ge 1; $layer--) {
      $grow = [single](($SIZE * (0.12 + $layer * 0.105)) * (0.82 + 0.18 * $breath))
      $baseA = if ($current.alert) { 21 } elseif ($animated) { 14 } else { 8 }
      $alpha = [Math]::Min(80, $baseA + (4 - $layer) * 4)
      $halo = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B))
      $g.FillEllipse($halo, $cx - $SIZE / 2 - $grow, $cy - $SIZE / 2 - $grow, $SIZE + $grow * 2, $SIZE + $grow * 2)
      $halo.Dispose()
    }

    # Persistent orbital sparks and comet tails around active/hovered states.
    $orbitCount = if ($current.alert) { 14 } elseif ($current.state -eq $P_RUNNING) { 11 } elseif ($current.state -eq $P_STALE) { 8 } elseif ($fx.hover) { 7 } else { 0 }
    for ($i = 0; $i -lt $orbitCount; $i++) {
      $speed = 0.72 + ($i % 4) * 0.11
      $angle = $fx.time * $speed * ($(if (($i % 3) -eq 0) { -1 } else { 1 })) + $i * (6.283185 / [Math]::Max(1, $orbitCount))
      $radius = $SIZE * (0.59 + 0.055 * [Math]::Sin($fx.time * 1.4 + $i * 1.7))
      $x = $cx + [Math]::Cos($angle) * $radius
      $y = $cy + [Math]::Sin($angle) * $radius
      $tailAngle = $angle - 0.18 * $(if (($i % 3) -eq 0) { -1 } else { 1 })
      $tx = $cx + [Math]::Cos($tailAngle) * $radius
      $ty = $cy + [Math]::Sin($tailAngle) * $radius
      $oa = [int](65 + 85 * (0.5 + 0.5 * [Math]::Sin($fx.time * 2.2 + $i)))
      $tailPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb($oa, $c.R, $c.G, $c.B), [single](1.15 * $dpiScale))
      $tailPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $tailPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $g.DrawLine($tailPen, [single]$tx, [single]$ty, [single]$x, [single]$y)
      $tailPen.Dispose()
      $sparkR = [single]((1.25 + ($i % 3) * 0.45) * $dpiScale)
      $sparkGlow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb([Math]::Min(150, $oa), $c.R, $c.G, $c.B))
      $g.FillEllipse($sparkGlow, [single]($x - $sparkR * 2), [single]($y - $sparkR * 2), $sparkR * 4, $sparkR * 4)
      $sparkGlow.Dispose()
      $g.FillEllipse([System.Drawing.Brushes]::White, [single]($x - $sparkR / 2), [single]($y - $sparkR / 2), $sparkR, $sparkR)
    }

    # State-transition particles: colored glow, white core, velocity trail.
    foreach ($p in $fx.particles) {
      $pa = [int][Math]::Max(0, [Math]::Min(210, 190 * $p.life))
      $trail = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb([int]($pa * 0.55), $p.color.R, $p.color.G, $p.color.B), [single][Math]::Max(1, $p.size * 0.58))
      $trail.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $trail.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $g.DrawLine($trail, [single]$p.px, [single]$p.py, [single]$p.x, [single]$p.y)
      $trail.Dispose()
      $pr = [single]($p.size * (0.45 + 0.55 * $p.life))
      $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb([int]($pa * 0.55), $p.color.R, $p.color.G, $p.color.B))
      $g.FillEllipse($glow, [single]($p.x - $pr * 1.8), [single]($p.y - $pr * 1.8), $pr * 3.6, $pr * 3.6)
      $glow.Dispose()
      $coreColor = if ($p.white) { [System.Drawing.Color]::FromArgb($pa, 255, 255, 255) } else { [System.Drawing.Color]::FromArgb($pa, $p.color.R, $p.color.G, $p.color.B) }
      $core = [System.Drawing.SolidBrush]::new($coreColor)
      $g.FillEllipse($core, [single]($p.x - $pr / 2), [single]($p.y - $pr / 2), $pr, $pr)
      $core.Dispose()
    }

    # Three rotating energy arcs create a readable active silhouette.
    if ($animated) {
      $arcRect = [System.Drawing.RectangleF]::new([single]($BALL_X - 7 * $dpiScale), [single]($BALL_Y - 7 * $dpiScale), [single]($SIZE + 14 * $dpiScale), [single]($SIZE + 14 * $dpiScale))
      for ($a = 0; $a -lt 3; $a++) {
        $arcAlpha = [int](80 + 75 * $breath - $a * 13)
        $arcPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb([Math]::Max(30, $arcAlpha), $c.R, $c.G, $c.B), [single]((1.15 + $a * 0.25) * $dpiScale))
        $arcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $arcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $start = [single](($fx.time * 82 * $(if (($a % 2) -eq 0) { 1 } else { -1 }) + $a * 121) % 360)
        $g.DrawArc($arcPen, $arcRect, $start, [single](38 + $a * 9))
        $arcPen.Dispose()
      }
    }

    # Brand ball.
    $ballRect = [System.Drawing.Rectangle]::new($BALL_X, $BALL_Y, $SIZE, $SIZE)
    $alpha = if ($quiet -and -not $fx.hover) { 225 } else { 255 }
    $light = [System.Drawing.Color]::FromArgb($alpha, 131, 160, 255)
    $dark = [System.Drawing.Color]::FromArgb($alpha, 37, 65, 204)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($ballRect, $light, $dark, 62.0)
    $g.FillEllipse($brush, $ballRect)
    $brush.Dispose()
    $gloss = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(72, 255, 255, 255))
    $g.FillEllipse($gloss, $BALL_X + [int]($SIZE * 0.13), $BALL_Y + [int]($SIZE * 0.09), [int]($SIZE * 0.54), [int]($SIZE * 0.29))
    $gloss.Dispose()

    # White brand whale.
    $scale = (($SIZE - 14) / [Math]::Max($whaleBounds.Width, $whaleBounds.Height))
    $wx = ($BALL_X + (($SIZE - $whaleBounds.Width * $scale) / 2)) - $whaleBounds.X * $scale
    $wy = ($BALL_Y + (($SIZE - $whaleBounds.Height * $scale) / 2)) - $whaleBounds.Y * $scale
    $mat = [System.Drawing.Drawing2D.Matrix]::new()
    $mat.Translate([float]$wx, [float]$wy); $mat.Scale([float]$scale, [float]$scale)
    $g.Transform = $mat
    $g.FillPath([System.Drawing.Brushes]::White, $whalePath)
    $g.ResetTransform()
    $mat.Dispose()

    # State ring and rotating dashed runner ring.
    $ringW = if ($current.alert) { [single](3.0 * $dpiScale) } else { [single](2.15 * $dpiScale) }
    $ringA = [int]$(if ($animated) { 150 + 95 * $breath } else { 155 })
    $ring = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb([Math]::Min(255, $ringA), $c.R, $c.G, $c.B), $ringW)
    $g.DrawEllipse($ring, [single]($BALL_X + 1.5 * $dpiScale), [single]($BALL_Y + 1.5 * $dpiScale), [single]($SIZE - 3 * $dpiScale), [single]($SIZE - 3 * $dpiScale))
    $ring.Dispose()
    if ($current.state -eq $P_RUNNING -or $fx.hover) {
      $spin = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(175, 255, 255, 255), [single](1.55 * $dpiScale))
      $spin.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
      $spin.DashOffset = [single](-$fx.time * 5.5)
      $g.DrawEllipse($spin, [single]($BALL_X - 3.5 * $dpiScale), [single]($BALL_Y - 3.5 * $dpiScale), [single]($SIZE + 7 * $dpiScale), [single]($SIZE + 7 * $dpiScale))
      $spin.Dispose()
    }

    # Small state badge remains part of the ball, never a separate card.
    $glyph = $P_GLYPH[$current.state]
    if (-not $glyph) { $glyph = '?' }
    $bs = [int][Math]::Round(18 * $dpiScale)
    $bd = [System.Drawing.Rectangle]::new($BALL_X + $SIZE - $bs - 1, $BALL_Y - 1, $bs, $bs)
    $g.FillEllipse([System.Drawing.Brushes]::White, $bd)
    $badgePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(205, 53, 58, 76), [single](1 * $dpiScale))
    $g.DrawEllipse($badgePen, $bd); $badgePen.Dispose()
    $bfont = [System.Drawing.Font]::new('Segoe UI', [single](10 * $dpiScale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $bsf = New-Object System.Drawing.StringFormat
    $bsf.Alignment = [System.Drawing.StringAlignment]::Center
    $bsf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $bb = [System.Drawing.SolidBrush]::new($c)
    $g.DrawString($glyph, $bfont, $bb, [System.Drawing.RectangleF]::new([single]$bd.X, [single]$bd.Y, [single]$bd.Width, [single]$bd.Height), $bsf)
    $bfont.Dispose(); $bsf.Dispose(); $bb.Dispose()

    $g.Dispose(); $g = $null
    [LayeredOrbNative]::SetBitmap($form, $orbBitmap)
  } catch {
    if ($null -ne $g) { try { $g.Dispose() } catch { } }
    Log ('layered render error: ' + $_.Exception.Message)
    if ($SmokeTest) { throw }
  }
}


# ── animation timer (particles + breathing) ─────────────────────────────────
$anim = New-Object System.Windows.Forms.Timer
$anim.Interval = 16
$anim.Add_Tick({
  $fx.time += 0.016
  Update-Particles
  Complete-Poll # picks up the async presence response without blocking
  $quiet = $P_QUIET[$current.state] -eq $true
  if ($fx.particles.Count -gt 0 -or -not $quiet -or $fx.hover) {
    Render-Orb
    $fx.staticPainted = $false
  } elseif (-not $fx.staticPainted) {
    Render-Orb
    $fx.staticPainted = $true
  }
})
$anim.Start()

# ── native drag / click ─────────────────────────────────────────────────────
# WM_NCLBUTTONDOWN delegates movement to the Windows compositor. The layered
# bitmap moves as one surface, so dragging does not race a PowerShell repaint.
# Click = toggle the quick panel. The panel is hidden BEFORE the native drag
# loop starts (a compositor drag must not fight an owned form), so the click
# handler cannot rely on $panel.Visible afterwards: remember the pre-drag
# visibility and, on a plain click, reopen only when the panel was closed
# before (the old code re-showed the panel on every click, which made it
# impossible to dismiss the panel by clicking the orb again).
$form.Add_MouseDown({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $wasVisible = $panel.Visible
    if ($wasVisible) { $panel.Hide() }
    $before = [System.Drawing.Point]::new($form.Left, $form.Top)
    [LayeredOrbNative]::BeginDrag($form.Handle)
    $moved = ([Math]::Abs($form.Left - $before.X) -gt 3 -or [Math]::Abs($form.Top - $before.Y) -gt 3)
    if ($moved) {
      $center = [System.Drawing.Point]::new([int]($form.Left + $CARD_W / 2), [int]($form.Top + $CARD_H / 2))
      $wa = [System.Windows.Forms.Screen]::FromPoint($center).WorkingArea
      $nx = [Math]::Max($wa.Left, [Math]::Min($wa.Right - $CARD_W, $form.Left))
      $ny = [Math]::Max($wa.Top, [Math]::Min($wa.Bottom - $CARD_H, $form.Top))
      $form.Location = [System.Drawing.Point]::new($nx, $ny)
      try { @{ x = $form.Left; y = $form.Top } | ConvertTo-Json | Set-Content -Path $posFile -Encoding UTF8 } catch { }
    } elseif (-not $wasVisible) {
      # A drag was not needed and the panel was closed: this is a click that
      # opens the panel. When the panel WAS open, it stays hidden (click
      # again on the orb = dismiss).
      Show-CompanionPanel
    }
    $fx.staticPainted = $false
    Render-Orb
  }
})

$form.Add_MouseEnter({
  $fx.hover = $true
  Spawn-Burst 7
  $fx.staticPainted = $false
})
$form.Add_MouseLeave({
  $fx.hover = $false
  $fx.staticPainted = $false
})

# ── context menu (right-click) ──────────────────────────────────────────────
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$panelItem = New-Object System.Windows.Forms.ToolStripMenuItem('展开任务面板')
$panelItem.Add_Click({ Toggle-CompanionPanel })
# Open the LOCAL harness GUI (loopback). The widget runs on the same PC as the
# harness; the tailnet HTTPS name is a phone-access entry point (launcher-owned
# serve mapping) and is deliberately never used here. Both actions use the
# $HarnessUrl parameter, so a custom deployment can still point elsewhere.
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem('打开 Harness')
$openItem.Add_Click({ try { Start-Process $HarnessUrl } catch { } })
$refreshItem = New-Object System.Windows.Forms.ToolStripMenuItem('立即刷新')
$refreshItem.Add_Click({ PollOnce | Out-Null })
$logItem = New-Object System.Windows.Forms.ToolStripMenuItem('查看悬浮球日志')
$logItem.Add_Click({ try { Start-Process -FilePath 'notepad.exe' -ArgumentList (ConvertTo-ArgLine @($logFile)) } catch { } })
$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('退出')
$quitItem.Add_Click({ $form.Close() })
$menu.Items.Add($panelItem) | Out-Null
$menu.Items.Add($openItem) | Out-Null
$menu.Items.Add($refreshItem) | Out-Null
$menu.Items.Add($logItem) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($quitItem) | Out-Null
$form.ContextMenuStrip = $menu

# ── tooltip (hover) ─────────────────────────────────────────────────────────
$tip = New-Object System.Windows.Forms.ToolTip
$tip.AutomaticDelay = 180
$tip.AutoPopDelay = 8000
$tip.ReshowDelay = 80
$tip.ShowAlways = $true

# ── polling (decision plumbing) ────────────────────────────────────────────
# Every poll-to-display decision is PURE and lives in scripts/orb-state.ps1
# (Resolve-OrbPoll): task selection, stale snapshot cache detection (2.2),
# the 401/403 -> unauthorized and transport-error -> offline mapping (2.3),
# and the toast gate (only fresh transitions INTO NEEDS_USER/FAILED toast).
# Invoke-OrbDecision only translates a decision onto the UI and remembers it
# as the Previous record for the next poll.
$pollDecision = @{ state = $P_DISC; taskTitle = ''; markerMs = [long]0; markerSeenMs = [long]0 }
# Required tooltip/detail text for the two transport states (2.3). The
# unauthorized sentence is shown verbatim (em dash included).
$UNAUTHORIZED_NOTE = 'companion token invalid — re-run install or refresh the token'
$OFFLINE_NOTE = 'Harness 不可达 — 检查看门狗 / 端口 3080'

function Invoke-OrbDecision {
  param([hashtable]$Poll)
  $d = Resolve-OrbPoll -Poll $Poll -Previous $pollDecision -Config @{ pollIntervalSec = $IntervalSeconds }

  if ($d.cacheStale) {
    Log 'presence cache stale: dispatcher snapshot is not advancing'
  }

  $detail = [string]$d.detail
  $title = [string]$d.taskTitle
  $summary = [string]$d.taskSummary
  $count = [int]$d.taskCount
  if ($d.unauthorized) {
    # Never show the last-known task content while unauthorized, and never
    # treat redacted placeholders as live data.
    $detail = $UNAUTHORIZED_NOTE
    $title = ''
    $summary = ''
  } elseif ($d.offline) {
    $detail = $OFFLINE_NOTE
    $title = ''
    $summary = ''
  }

  Set-State ([string]$d.state) $title $summary $detail $count

  # Toast gating lives in the pure decision: no toast while unauthorized,
  # offline or cache-stale; a fresh transition into NEEDS_USER/FAILED toasts.
  if ($d.toastShouldFire) {
    Show-StateToast ([string]$d.state) $title
  }

  $pollDecision.state = [string]$d.state
  $pollDecision.taskTitle = $title
  $pollDecision.markerMs = [long]$d.markerMs
  $pollDecision.markerSeenMs = [long]$d.markerSeenMs
}

# ── Windows toast (native, zero-dependency via WinRT) ───────────────────────
# The topmost ball is invisible under an exclusive-fullscreen window, and a
# NEEDS_USER can otherwise sit unnoticed while the user is at the PC. A toast
# is the OS-native channel: it survives fullscreen, lands in the Action
# Center, and respects Focus Assist. Unpackaged processes need a registered
# AUMID - PowerShell's own is always present, so we borrow it. This map is the
# per-(state,title) second guard: Invoke-OrbDecision only calls this on a real
# transition into an alert state (the pure decision in orb-state.ps1 decides),
# and the map keeps the same alert from re-toasting later in the session.
$toastNotified = @{}
function Show-StateToast([string]$st, [string]$title) {
  try {
    $key = $st + ':' + $title
    if ($toastNotified[$key]) { return }
    $toastNotified[$key] = $true
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $head = if ($st -eq $P_FAILED) { 'DSH Agent 执行失败' } else { 'DeepSeek Harness 需要你' }
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $safeTitle = [System.Security.SecurityElement]::Escape($(if ($title) { $title } else { '' }))
    $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>' +
      [System.Security.SecurityElement]::Escape($head) + '</text><text>' + $safeTitle +
      '</text></binding></visual></toast>')
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
  } catch {
    Log ('toast failed: ' + $_.Exception.Message) # never break the widget
  }
}

function Set-State {
  param([string]$st, [string]$title, [string]$summary = '', [string]$detail = '', [int]$count = 0)
  if ($null -eq $P_PRIORITY[$st]) {
    $detail = if ($detail) { $detail } else { 'Presence 返回未知状态 · ' + $st }
    $st = $P_DISC
  }
  if ($current.state -ne $st) {
    if ($st -eq $P_NEEDS -or $st -eq $P_FAILED) { Spawn-Burst 10 }
    elseif ($st -eq $P_DONE) { Spawn-Burst 8 }
    elseif ($st -eq $P_RUNNING) { Spawn-Burst 4 }
  }
  $current.state = $st
  $current.title = $title
  $current.summary = $summary
  $current.detail = $detail
  $current.count = $count
  $current.updated = Get-Date -Format 'HH:mm:ss'
  # Emphasise exactly the states a human has to act on.
  $current.alert = ($st -eq $P_NEEDS -or $st -eq $P_FAILED)
  # Tooltip: task title when present; otherwise surface the diagnostic detail
  # (the unauthorized/offline/cache-stale notes are only visible through the
  # tooltip and the panel, so they must not be swallowed here).
  $label = $P_TEXT[$st]
  if (-not $label) { $label = 'Unavailable' }
  if ($title) { $tip.SetToolTip($form, ($label + ' · ' + $title)) }
  elseif ($detail) { $tip.SetToolTip($form, $detail) }
  else { $tip.SetToolTip($form, $label) }
  if ($panel.Visible) { Update-CompanionPanel }
  $fx.staticPainted = $false
}

# ── async polling ───────────────────────────────────────────────────────────
# Invoke-RestMethod ran on the UI thread: a dead harness froze the widget for
# the full 6s timeout every cycle - no animation, no dragging, no context menu,
# precisely when the user most wants to click it and find out what broke.
# HttpClient hands back a Task; the animation tick polls for completion, so the
# message loop is never blocked.
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromSeconds(6)
$poll = @{ task = $null }
$companionToken = ''

function Update-CompanionTokenHeader {
  try {
    if (-not (Test-Path $companionTokenFile)) { return }
    $token = ([string](Get-Content -LiteralPath $companionTokenFile -Raw -Encoding UTF8)).Trim().ToLowerInvariant()
    if ($token -notmatch '^[a-f0-9]{64}$' -or $token -eq $companionToken) { return }
    $http.DefaultRequestHeaders.Remove('X-Remfs-Companion-Token') | Out-Null
    $http.DefaultRequestHeaders.Add('X-Remfs-Companion-Token', $token)
    $script:companionToken = $token
  } catch {
    Log ('companion token unavailable: ' + $_.Exception.Message)
  }
}

function PollOnce {
  if ($null -ne $poll.task) { return } # one request in flight at a time
  try {
    Update-CompanionTokenHeader
    $poll.task = $http.GetAsync($PresenceUrl)
  } catch {
    $poll.task = $null
    Invoke-OrbDecision @{ kind = 'offline'; message = $_.Exception.Message }
  }
}

function Complete-Poll {
  $t = $poll.task
  if ($null -eq $t -or -not $t.IsCompleted) { return }
  $poll.task = $null
  if ($t.IsFaulted -or $t.IsCanceled) {
    # Transport failure (timeout / DNS / reset): the endpoint never answered.
    Invoke-OrbDecision @{ kind = 'offline'; message = 'HttpClient task faulted or canceled' }
    return
  }
  $resp = $null
  try {
    $resp = $t.Result
    $code = [int]$resp.StatusCode
    if ($code -eq 401 -or $code -eq 403) {
      # The harness is alive and answering - it is refusing our companion
      # token (missing, rotated or removed). Explicit unauthorized state, and
      # never a toast while it lasts.
      Invoke-OrbDecision @{ kind = 'unauthorized'; code = $code }
      return
    }
    if (-not $resp.IsSuccessStatusCode) {
      Invoke-OrbDecision @{ kind = 'http'; code = $code }
      return
    }
    # GetAsync buffers the body by default, so this completes immediately.
    $bodyText = $resp.Content.ReadAsStringAsync().Result
    $json = $null
    try { $json = $bodyText | ConvertFrom-Json } catch { }
    if ($null -eq $json) {
      Invoke-OrbDecision @{ kind = 'parse'; message = 'response body is not JSON' }
      return
    }
    $tokenSent = ($companionToken.Length -gt 0)
    Invoke-OrbDecision @{ kind = 'ok'; body = $json; authenticated = $tokenSent }
  } catch {
    Log ('poll error: ' + $_.Exception.Message)
    Invoke-OrbDecision @{ kind = 'offline'; message = $_.Exception.Message }
  } finally {
    if ($null -ne $resp) { try { $resp.Dispose() } catch { } }
  }
}

$pollTimer = New-Object System.Windows.Forms.Timer
$pollTimer.Interval = [Math]::Max(3, [Math]::Min(60, $IntervalSeconds)) * 1000
$pollTimer.Add_Tick({ PollOnce })
$pollTimer.Start()

$form.Add_Shown({ Render-Orb; PollOnce })
$form.Add_FormClosed({
  $pollTimer.Stop(); $anim.Stop()
  try { if (-not $panel.IsDisposed) { $panel.Close(); $panel.Dispose() } } catch { }
  try { $pollTimer.Dispose(); $anim.Dispose(); $http.Dispose(); $whalePath.Dispose(); $orbBitmap.Dispose() } catch { }
  try { $singleInstanceMutex.ReleaseMutex(); $singleInstanceMutex.Dispose() } catch { }
})

if ($SmokeTest) {
  # Smoke drives the SAME decision path the live poll uses (Resolve-OrbPoll ->
  # Invoke-OrbDecision), so the pure module, the virtual-state vocabulary and
  # the UI mapping are all exercised together.
  Invoke-OrbDecision @{
    kind = 'ok'
    authenticated = $true
    body = ([pscustomobject]@{
      ok = $true
      cachedAt = [datetime]::UtcNow.ToString('o')
      value = [pscustomobject]@{
        tasks = @([pscustomobject]@{ state = $P_RUNNING; title = 'Smoke task'; summary = 'Companion panel runtime check'; updatedAt = 1; staleReason = @() })
      }
    })
  }
  if ($current.state -ne $P_RUNNING -or $current.title -ne 'Smoke task') { throw 'valid presence snapshot did not select the running task' }
  Invoke-OrbDecision @{ kind = 'ok'; authenticated = $true; body = ([pscustomobject]@{ ok = $false; error = [pscustomobject]@{ code = 'sessions-unavailable' } }) }
  if ($current.state -ne $P_DISC -or $current.detail -notmatch 'sessions-unavailable') { throw 'host error was not surfaced as disconnected' }
  Invoke-OrbDecision @{ kind = 'unauthorized'; code = 403 }
  if ($current.state -ne $P_UNAUTH) { throw '401/403 was not surfaced as the explicit unauthorized state' }
  Invoke-OrbDecision @{ kind = 'offline' }
  if ($current.state -ne $P_OFFLINE) { throw 'transport failure was not surfaced as the offline state' }
  Set-State $P_RUNNING 'Smoke task' 'Companion panel runtime check' '' 1
  $fx.hover = $true
  Spawn-Burst 18
  for ($i = 0; $i -lt 5; $i++) { Update-Particles; $fx.time += 0.016 }
  $null = $form.Handle
  Render-Orb
  if ($SmokeScreenshotPath) {
    $orbBitmap.Save($SmokeScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $smokeClose = New-Object System.Windows.Forms.Timer
  $smokeClose.Interval = 120
  $smokeClose.Add_Tick({ $smokeClose.Stop(); $smokeClose.Dispose(); $form.Close() })
  $form.Add_Shown({ Toggle-CompanionPanel; $smokeClose.Start() })
  [System.Windows.Forms.Application]::Run($form)
  Write-Output 'orb smoke: OK'
  exit 0
}

if (-not $Quiet) { Log "orb widget started (poll ${IntervalSeconds}s)" }
[System.Windows.Forms.Application]::Run($form)
