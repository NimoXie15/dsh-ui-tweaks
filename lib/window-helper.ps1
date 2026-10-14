# ui-tweaks.window-helper.ps1
# Host-side helper for the dsh-ui-tweaks "remember window size/position" feature.
#
# Spawned by lib/index.js inside the dsh runtime of the official DeepSeek
# Harness desktop client (ELECTRON_RUN_AS_NODE=1). Loads the Win32 interop
# from window-helper.dll (precompiled by lib/index.js with the OS-shipped
# csc; in-process assembly load, unlike a locally built exe, never triggers
# the "unknown publisher" security dialog).
#
# Host discovery: the client process tree shares one exe name and looks like
#   main -> --expose-internals -> spawn-bridge -> dsh runtime -> (this helper)
# so the host is the TOPMOST ancestor still named "DeepSeek Harness" (it owns
# the main window; first-match would pick a windowless middle node). Walked
# via ntdll ParentPid + .NET Process (no WMI latency).
#
# Window identification: top-level windows of the host PID filtered by class
# Chrome_WidgetWin_1 + WS_THICKFRAME (resizable) + >=400x300, largest wins.
#
# Restore: the main window is created hidden (show:false) and shown after the
# page loads; a 100ms poll applies the saved bounds while still hidden (no
# visible jump). Safety net: within 15s of start, an already-visible window
# still gets a catch-up restore. Maximized state is restored on the hidden
# window so rcNormalPosition (the windowed rect) is preserved.
#
# Save: 1s poll of GetWindowPlacement; JSON written atomically on change only.
#
# Exit: runtime or host PID dies. Single instance via lock file next to this
# script (newest helper kills the previous one).
#
# NOTE: keep this file pure ASCII. It is written with a UTF-8 BOM by
# lib/index.js, but PS 5.1 + ANSI + non-ASCII has bitten three times already.

param(
    [int]$DshPid = 0,
    [Parameter(Mandatory = $true)][string]$StateFile,
    [string]$LogPath = ''
)

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $PSCommandPath

# ---------------------------------------------------------------- logging ---
function Write-Log([string]$Message) {
    if (-not $LogPath) { return }
    try {
        $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message)
        $item = Get-Item -LiteralPath $LogPath -EA SilentlyContinue
        if ($item -and $item.Length -gt 96KB) {
            $tail = Get-Content -LiteralPath $LogPath -Tail 400 -EA SilentlyContinue
            Set-Content -LiteralPath $LogPath -Value $tail -EA SilentlyContinue
        }
        Add-Content -LiteralPath $LogPath -Value $line -EA SilentlyContinue
    } catch { }
}

# --------------------------------------------------------- win32 (from dll) ---
$dll = Join-Path $ScriptDir 'window-helper.dll'
try {
    # Assembly.Load(byte[]) instead of Add-Type -Path / LoadFrom: the profile
    # may live on a cloud-synced/virtual drive, which .NET treats as remote
    # and blocks with 0x80131515; byte-loading has no zone check and no
    # security prompt either.
    [void][System.Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))
} catch {
    Write-Log ('exit: window-helper.dll load failed: ' + $_.Exception.Message)
    exit 1
}

# --------------------------------------------------------- single instance ---
# Lock file holds the current helper PID; the next helper validates and kills it.
$LockPath = Join-Path $ScriptDir 'window-helper.lock'
function Stop-OtherHelpers {
    try {
        if (Test-Path -LiteralPath $LockPath) {
            $old = Get-Content -LiteralPath $LockPath -EA SilentlyContinue | Select-Object -First 1
            if ($old -match '^\d+$') {
                $oldProc = Get-Process -Id ([int]$old) -EA SilentlyContinue
                if ($oldProc -and $oldProc.ProcessName -eq 'powershell') {
                    Write-Log ('takeover: killing stale helper PID=' + $old)
                    try { Stop-Process -Id $oldProc.Id -Force -EA SilentlyContinue } catch { }
                    Start-Sleep -Milliseconds 400
                }
            }
        }
        Set-Content -LiteralPath $LockPath -Value $PID -Encoding ASCII
    } catch { }
}

# --------------------------------------------------------- host discovery ---
$reHost = 'deepseek[ _-]?harness(\.exe)?$'

function Find-HostPid([int]$FromPid) {
    # Walk up while ancestors keep the client exe name; host = topmost match.
    $cur = $FromPid
    $hostPid = 0
    $chain = @()
    for ($i = 0; $i -lt 10; $i++) {
        $pp = [DshWin]::ParentPid([long]$cur)
        if ($pp -le 0) { break }
        $proc = Get-Process -Id $pp -EA SilentlyContinue
        if (-not $proc) { break }
        # PID-reuse guard: a real parent cannot be younger than its child.
        try {
            $childProc = Get-Process -Id $cur -EA SilentlyContinue
            if ($childProc -and $proc.StartTime -gt $childProc.StartTime.AddSeconds(1)) {
                Write-Log ('parent walk stopped: PID ' + $pp + ' looks reused')
                break
            }
        } catch { break }
        $chain += ('PID=' + $pp + ' ' + $proc.ProcessName)
        if ($proc.ProcessName -match $reHost) { $hostPid = $pp } else { break }
        $cur = $pp
    }
    if ($hostPid) { Write-Log ('host found: ' + ($chain -join ' <- ')) }
    else { Write-Log ('host NOT found. chain: ' + ($chain -join ' <- ')) }
    return $hostPid
}

# ------------------------------------------------------ window discovery ----
function Find-PrimaryWindow([uint32]$HostPid) {
    $best = $null
    $bestArea = 0
    foreach ($w in [DshWin]::WindowsOfPid($HostPid)) {
        if ($w.ClassName -ne 'Chrome_WidgetWin_1') { continue }
        if (($w.Style -band 0x00040000) -eq 0) { continue } # WS_THICKFRAME: resizable only
        # Size check uses GetWindowPlacement's normal rect, not GetWindowRect:
        # a minimized window reports (-32000,-32000) 160x28, which the size gate
        # would filter out - the helper then believes the window vanished and stops
        # recording (measured: minimizing once broke tracking until the next launch).
        $cmd = [uint32]0
        $norm = New-Object 'DshWin+RECT'
        if (-not [DshWin]::Placement($w.Hwnd, [ref]$cmd, [ref]$norm)) { continue }
        $wd = $norm.Right - $norm.Left
        $ht = $norm.Bottom - $norm.Top
        if ($wd -lt 400 -or $ht -lt 300) { continue }
        if (($wd * $ht) -gt $bestArea) { $best = $w; $bestArea = $wd * $ht }
    }
    return $best
}

function Read-State {
    try {
        $raw = [IO.File]::ReadAllText($StateFile)
        $s = $raw | ConvertFrom-Json
        if ($s.version -ne 1) { return $null }
        foreach ($k in @('x', 'y', 'w', 'h')) { if (($s.$k -isnot [int]) -and ($s.$k -isnot [long]) -and ($s.$k -isnot [double])) { return $null } }
        return $s
    } catch { return $null }
}

# ------------------------------------------------------------------ main ----
if ($DshPid -le 0) { Write-Log 'exit: no DshPid'; exit 1 }
$rootPid = $DshPid
$hostPid = Find-HostPid $DshPid
if (-not $hostPid) { Write-Log 'exit: host (DeepSeek Harness.exe) not found'; exit 0 }
Stop-OtherHelpers
Write-Log ('helper start PID=' + $PID + ' mode=desktop dshPid=' + $DshPid + ' hostPid=' + $hostPid)

$bootGraceEnd = (Get-Date).AddSeconds(15) # catch-up restore allowed while boot is still settling
$restoredFor = [IntPtr]::Zero
$lastSig = ''
$saveCount = 0

# Phase A: wait for the primary window; restore into it while still hidden.
$deadline = (Get-Date).AddSeconds(180)
while ($true) {
    if (-not (Get-Process -Id $rootPid -EA SilentlyContinue)) { Write-Log 'exit: root dsh process gone'; exit 0 }
    if (-not (Get-Process -Id $hostPid -EA SilentlyContinue)) { Write-Log 'exit: host process gone'; exit 0 }

    $win = Find-PrimaryWindow $hostPid
    if ($win) {
        Write-Log ('window found: hwnd=' + $win.Hwnd + ' rect=' + $win.Rect.Left + ',' + $win.Rect.Top + ' ' + ($win.Rect.Right - $win.Rect.Left) + 'x' + ($win.Rect.Bottom - $win.Rect.Top) + ' visible=' + $win.Visible)
        break
    }
    if ((Get-Date) -gt $deadline) {
        Write-Log 'no window in 180s, slowing down (5s cadence)'
        break
    }
    Start-Sleep -Milliseconds 100
}

# Main loop: restore once per new hwnd, then keep saving (1s cadence).
$slow = $false
$tick = 0
while ($true) {
    if (-not (Get-Process -Id $rootPid -EA SilentlyContinue)) { Write-Log 'exit: root dsh process gone'; exit 0 }
    if (-not (Get-Process -Id $hostPid -EA SilentlyContinue)) { Write-Log 'exit: host process gone'; exit 0 }

    $win = Find-PrimaryWindow $hostPid
    if ($win -and [DshWin]::Alive($win.Hwnd)) {
        if ($win.Hwnd -ne $restoredFor) {
            $state = Read-State
            if ($state) {
                $okBounds = [DshWin]::IntersectsMonitor([int]$state.x, [int]$state.y, [int]$state.w, [int]$state.h)
                $hidden = -not [DshWin]::Visible($win.Hwnd)
                if (-not $okBounds) {
                    Write-Log 'restore skipped: saved bounds off every monitor'
                } elseif ($hidden) {
                    [void][DshWin]::MoveTo($win.Hwnd, [int]$state.x, [int]$state.y, [int]$state.w, [int]$state.h)
                    if ($state.maximized) { [void][DshWin]::Maximize($win.Hwnd) }
                    Write-Log ('restore applied (pre-show): ' + $state.x + ',' + $state.y + ' ' + $state.w + 'x' + $state.h + ' maximized=' + $state.maximized)
                } elseif ((Get-Date) -lt $bootGraceEnd) {
                    # Safety net for boots where the hidden phase was missed.
                    $curCmd = [uint32]0
                    $curRect = New-Object 'DshWin+RECT'
                    [void][DshWin]::Placement($win.Hwnd, [ref]$curCmd, [ref]$curRect)
                    $differs = ([Math]::Abs($curRect.Left - $state.x) -gt 5) -or ([Math]::Abs($curRect.Top - $state.y) -gt 5) -or
                        ([Math]::Abs(($curRect.Right - $curRect.Left) - $state.w) -gt 5) -or ([Math]::Abs(($curRect.Bottom - $curRect.Top) - $state.h) -gt 5)
                    $maxDiffers = ($state.maximized -and $curCmd -ne 3)
                    if ($differs -or $maxDiffers) {
                        # Hide -> move -> show. Moving an already-visible window makes
                        # the user watch it appear at the default spot and then jump -
                        # the main reason it felt like nothing changed. Moving while
                        # hidden leaves at most one frame at the default position; the
                        # original foreground state is preserved so focus is not stolen.
                        $wasFg = [DshWin]::IsForeground($win.Hwnd)
                        # A maximized window ignores SetWindowPos (its placement is owned by
                        # the monitor), so restore to windowed first when the saved state is
                        # not maximized. Safe here: the window is already visible.
                        if ($curCmd -eq 3 -and -not $state.maximized) { [void][DshWin]::Restore($win.Hwnd); Start-Sleep -Milliseconds 60 }
                        [void][DshWin]::Hide($win.Hwnd)
                        [void][DshWin]::MoveTo($win.Hwnd, [int]$state.x, [int]$state.y, [int]$state.w, [int]$state.h)
                        if ($state.maximized) { [void][DshWin]::Maximize($win.Hwnd) }
                        else { [void][DshWin]::Show($win.Hwnd, $wasFg) }
                        Write-Log ('restore applied (catch-up, window already shown): ' + $state.x + ',' + $state.y + ' ' + $state.w + 'x' + $state.h + ' maximized=' + $state.maximized)
                    } else {
                        Write-Log 'restore skipped: window already at saved bounds'
                    }
                } else {
                    Write-Log 'restore skipped: window already visible (late adoption)'
                }
            } else {
                Write-Log 'no usable state file yet (first run)'
            }
            $restoredFor = $win.Hwnd
        }

        $showCmd = [uint32]0
        $norm = New-Object 'DshWin+RECT'
        if ([DshWin]::Placement($win.Hwnd, [ref]$showCmd, [ref]$norm)) {
            # Maximized-then-minimized still counts as maximized
            # (WPF_RESTORETOMAXIMIZED); without it, maximize -> minimize -> close
            # degrades into a windowed restore on the next launch.
            $maximized = [DshWin]::MaximizedState($win.Hwnd)
            # Compare by value signature without a timestamp, otherwise every
            # poll would rewrite the file even when nothing changed.
            $sig = '{0},{1},{2},{3},{4}' -f $norm.Left, $norm.Top, ($norm.Right - $norm.Left), ($norm.Bottom - $norm.Top), $maximized
            if ($sig -ne $lastSig) {
                $lastSig = $sig
                $json = '{{"version":1,"x":{0},"y":{1},"w":{2},"h":{3},"maximized":{4},"updatedAt":"{5}"}}' -f `
                    $norm.Left, $norm.Top, ($norm.Right - $norm.Left), ($norm.Bottom - $norm.Top),
                    $(if ($maximized) { 'true' } else { 'false' }), (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
                try {
                    $tmp = $StateFile + '.tmp'
                    [IO.File]::WriteAllText($tmp, $json)
                    Move-Item -LiteralPath $tmp -Destination $StateFile -Force
                    $saveCount++
                    Write-Log ('state saved #' + $saveCount + ': ' + $json)
                } catch {
                    Write-Log ('state write failed: ' + $_.Exception.Message)
                }
            }
        }
        $slow = $false
        $tick++
        if (($tick % 60) -eq 0) {
            Write-Log ('tick ' + $tick + ': hwnd=' + $win.Hwnd + ' sig=' + $sig)
        }
        Start-Sleep -Milliseconds 1000
    } else {
        # Window gone (destroyed or not yet created): retry. 5s cadence once
        # past the initial 180s catch-up window, 1s before that.
        if (-not $slow) { $slow = $true; Write-Log 'window gone, polling for it' }
        Start-Sleep -Seconds $(if ((Get-Date) -gt $deadline) { 5 } else { 1 })
    }
}
