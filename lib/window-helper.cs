// dsh-ui-tweaks window-state helper (host half, compiled at plugin load).
//
// lib/index.js compiles this to window-helper.dll (csc /target:library) and
// lib/window-helper.ps1 loads it via Assembly.Load(byte[]) - in-process, no
// security prompt. A locally built exe was tried first and abandoned: unsigned
// exes trigger the "unknown publisher" dialog on every launch (and security
// software silently blocks them).
//
// DshWin exposes the Win32 surface the PowerShell orchestrator calls:
//   WindowsOfPid / Alive / Visible / Placement / MoveTo / Maximize / Hide / Show /
//   IsForeground / MaximizedState / IntersectsMonitor / ParentPid
// lib/window-helper.ps1 is the ONLY orchestrator (host discovery + restore/save loop).
// A Program.Main duplicating that orchestration existed for the earlier standalone-exe
// approach; deleted in 0.1.6 - it had drifted out of date and nothing called it.
//
// Client process tree (all one exe name):
//   main -> --expose-internals -> spawn-bridge -> dsh runtime -> (helper)
// The host (Electron main, owns the window) is the TOPMOST "DeepSeek Harness"
// ancestor of the runtime, not the first match.
//
// NOTE: keep C# 5 compatible (OS-shipped legacy csc) and pure ASCII.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class DshWin
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT
    {
        public uint length, flags, showCmd;
        public POINT ptMinPosition, ptMaxPosition;
        public RECT rcNormalPosition;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor, rcWork;
        public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    public class WinInfo
    {
        public IntPtr Hwnd;
        public string Title = "";
        public string ClassName = "";
        public RECT Rect;
        public long Style;
        public bool Visible;
    }

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] private static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromRect(ref RECT r, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO info);
    [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr hProc, int pic, ref PROCESS_BASIC_INFORMATION pbi, int cb, out int pSize);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);

    public static WinInfo[] WindowsOfPid(uint pid)
    {
        var list = new List<WinInfo>();
        EnumWindows(delegate(IntPtr h, IntPtr lp)
        {
            uint p;
            GetWindowThreadProcessId(h, out p);
            if (p != pid) return true;
            var cn = new StringBuilder(256); GetClassName(h, cn, 256);
            var t = new StringBuilder(512); GetWindowText(h, t, 512);
            RECT r; GetWindowRect(h, out r);
            var info = new WinInfo();
            info.Hwnd = h;
            info.Title = t.ToString();
            info.ClassName = cn.ToString();
            info.Rect = r;
            info.Style = (long)GetWindowLong(h, -16);
            info.Visible = IsWindowVisible(h);
            list.Add(info);
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }

    public static bool Alive(IntPtr h) { return IsWindow(h); }
    public static bool Visible(IntPtr h) { return IsWindowVisible(h); }

    public static bool Placement(IntPtr h, out uint showCmd, out RECT normal)
    {
        WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
        wp.length = (uint)Marshal.SizeOf(typeof(WINDOWPLACEMENT));
        showCmd = 0;
        normal = new RECT();
        if (!GetWindowPlacement(h, ref wp)) return false;
        showCmd = wp.showCmd;
        normal = wp.rcNormalPosition;
        return true;
    }

    // SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10)
    public static bool MoveTo(IntPtr h, int x, int y, int w, int ht)
    {
        return SetWindowPos(h, IntPtr.Zero, x, y, w, ht, 0x14);
    }

    /// Maximized detection must accept both "currently maximized" and
    /// "maximized then minimized": the latter reports showCmd SW_SHOWMINIMIZED (2)
    /// but keeps WPF_RESTORETOMAXIMIZED (0x2) in flags. Checking showCmd == 3 alone
    /// loses the maximized flag after maximize -> minimize -> close.
    public static bool MaximizedState(IntPtr h)
    {
        WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
        wp.length = (uint)Marshal.SizeOf(typeof(WINDOWPLACEMENT));
        if (!GetWindowPlacement(h, ref wp)) return false;
        if (wp.showCmd == 3) return true;                    // SW_SHOWMAXIMIZED
        if (wp.showCmd == 2) return (wp.flags & 0x2) != 0;   // SW_SHOWMINIMIZED + WPF_RESTORETOMAXIMIZED
        return false;
    }


    public static bool Maximize(IntPtr h) { return ShowWindow(h, 3); } // SW_MAXIMIZE (also shows)
    public static bool Restore(IntPtr h) { return ShowWindow(h, 9); }  // SW_RESTORE (un-maximize)

    // For the hide -> move -> show sandwich: moving a visible window makes the user
    // watch it appear at the default spot and then jump; moving while hidden is
    // nearly invisible. activate=false uses SW_SHOWNA so focus is not stolen.
    public static bool Hide(IntPtr h) { return ShowWindow(h, 0); }            // SW_HIDE
    public static bool Show(IntPtr h, bool activate) { return ShowWindow(h, activate ? 5 : 8); }

    public static bool IsForeground(IntPtr h)
    {
        return GetForegroundWindow() == h;
    }

    public static bool IntersectsMonitor(int x, int y, int w, int ht)
    {
        RECT r = new RECT();
        r.Left = x; r.Top = y; r.Right = x + w; r.Bottom = y + ht;
        IntPtr m = MonitorFromRect(ref r, 0); // MONITOR_DEFAULTTONULL
        if (m == IntPtr.Zero) return false;
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO));
        return GetMonitorInfo(m, ref mi);
    }

    // Parent PID via ntdll; no WMI round-trip (discovery must stay fast).
    public static long ParentPid(long pid)
    {
        if (pid <= 0 || pid > uint.MaxValue) return -1;
        IntPtr h = OpenProcess(0x0400, false, (uint)pid);          // PROCESS_QUERY_INFORMATION
        if (h == IntPtr.Zero) h = OpenProcess(0x1000, false, (uint)pid); // ..._LIMITED_INFORMATION
        if (h == IntPtr.Zero) return -1;
        try
        {
            PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();
            int size;
            int st = NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out size);
            if (st != 0) return -1;
            return pbi.InheritedFromUniqueProcessId.ToInt64();
        }
        finally { CloseHandle(h); }
    }
}
