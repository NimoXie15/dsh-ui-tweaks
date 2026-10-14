// dsh-ui-tweaks window-state helper (host half, compiled at plugin load).
//
// lib/index.js compiles this to window-helper.dll (csc /target:library) and
// lib/window-helper.ps1 loads it via Assembly.Load(byte[]) - in-process, no
// security prompt. A locally built exe was tried first and abandoned: unsigned
// exes trigger the "unknown publisher" dialog on every launch (and security
// software silently blocks them).
//
// DshWin exposes the Win32 surface the PowerShell orchestrator calls:
//   WindowsOfPid / Alive / Visible / Placement / MoveTo / Maximize /
//   IntersectsMonitor / ParentPid
// Program.Main is a manual diagnostic entry (not used in production):
//   window-helper.exe --dshpid <pid> --state <json> --log <file> [--testpid <pid>]
//
// Client process tree (all one exe name):
//   main -> --expose-internals -> spawn-bridge -> dsh runtime -> (helper)
// The host (Electron main, owns the window) is the TOPMOST "DeepSeek Harness"
// ancestor of the runtime, not the first match.
//
// NOTE: keep C# 5 compatible (OS-shipped legacy csc) and pure ASCII.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

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

    public static bool Maximize(IntPtr h) { return ShowWindow(h, 3); } // SW_MAXIMIZE

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

static class Program
{
    private static string stateFile = "";
    private static string logPath = "";
    private static long rootPid;
    private static long hostPid;
    private static bool testMode;
    private static DateTime bootGraceEnd;
    private static IntPtr restoredFor = IntPtr.Zero;
    private static string lastSig = "";
    private static int saveCount;
    private static readonly object LogLock = new object();

    private static void Log(string msg)
    {
        if (string.IsNullOrEmpty(logPath)) return;
        try
        {
            lock (LogLock)
            {
                var fi = new FileInfo(logPath);
                if (fi.Exists && fi.Length > 96 * 1024)
                {
                    string all = File.ReadAllText(logPath);
                    File.WriteAllText(logPath, all.Substring(all.Length / 2));
                }
                File.AppendAllText(logPath,
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "] " + msg + Environment.NewLine);
            }
        }
        catch { }
    }

    private static bool ProcAlive(long pid)
    {
        if (pid <= 0) return false;
        try { Process.GetProcessById((int)pid); return true; }
        catch { return false; }
    }

    private static string ProcName(long pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName; }
        catch { return null; }
    }

    private static int JNum(string json, string key)
    {
        Match m = Regex.Match(json, "\"" + key + "\":\\s*(-?\\d+)");
        int v;
        return (m.Success && int.TryParse(m.Groups[1].Value, out v)) ? v : 0;
    }

    private static bool JBool(string json, string key)
    {
        return Regex.Match(json, "\"" + key + "\":\\s*true").Success;
    }

    private class SavedState
    {
        public int X, Y, W, H;
        public bool Maximized;
    }

    private static SavedState ReadState()
    {
        try
        {
            string raw = File.ReadAllText(stateFile);
            if (!Regex.Match(raw, "\"version\":\\s*1").Success) return null;
            var s = new SavedState();
            s.X = JNum(raw, "x");
            s.Y = JNum(raw, "y");
            s.W = JNum(raw, "w");
            s.H = JNum(raw, "h");
            s.Maximized = JBool(raw, "maximized");
            if (s.W <= 0 || s.H <= 0) return null;
            return s;
        }
        catch { return null; }
    }

    private static void SaveState(DshWin.RECT norm, bool maximized)
    {
        string json = "{\"version\":1,\"x\":" + norm.Left + ",\"y\":" + norm.Top +
            ",\"w\":" + (norm.Right - norm.Left) + ",\"h\":" + (norm.Bottom - norm.Top) +
            ",\"maximized\":" + (maximized ? "true" : "false") +
            ",\"updatedAt\":\"" + DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss") + "\"}";
        try
        {
            string tmp = stateFile + ".tmp";
            File.WriteAllText(tmp, json);
            MoveFileEx(tmp, stateFile, 0x1); // MOVEFILE_REPLACE_EXISTING
            saveCount++;
            Log("state saved #" + saveCount + ": " + json);
        }
        catch (Exception e) { Log("state write failed: " + e.Message); }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool MoveFileEx(string src, string dst, int flags);

    private static readonly Regex ReHost = new Regex("deepseek[ _-]?harness(\\.exe)?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Manual diagnostic entry, not used in production (the PS orchestrator
    // drives DshWin directly). Kept for standalone testing of this file.
    static int Main(string[] args)
    {
        try { return RunMain(args); }
        catch (Exception e)
        {
            try { File.AppendAllText(logPath, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "] FATAL: " + e + Environment.NewLine); } catch { }
            return 3;
        }
    }

    static int RunMain(string[] args)
    {
        long dshPid = 0, testPid = 0;
        for (int i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "--dshpid") { long.TryParse(args[i + 1], out dshPid); }
            else if (args[i] == "--testpid") { long.TryParse(args[i + 1], out testPid); }
            else if (args[i] == "--state") { stateFile = args[i + 1]; }
            else if (args[i] == "--log") { logPath = args[i + 1]; }
        }
        if (string.IsNullOrEmpty(stateFile)) return 2;

        testMode = testPid > 0;
        if (testMode) { rootPid = testPid; hostPid = testPid; }
        else
        {
            if (dshPid <= 0) { Log("exit: no dshpid"); return 1; }
            rootPid = dshPid;
            DateTime t0 = DateTime.UtcNow;
            long p = DshWin.ParentPid(dshPid);
            if (p > 0)
            {
                string name = ProcName(p);
                if (name != null && ReHost.IsMatch(name)) { hostPid = p; }
            }
            Log("host resolved to PID=" + hostPid + " in " + (int)(DateTime.UtcNow - t0).TotalMilliseconds + "ms (topmost-match walk lives in the PS orchestrator)");
            if (hostPid <= 0) { Log("exit: host not found"); return 0; }
        }
        Log("helper start pid=" + Process.GetCurrentProcess().Id +
            " mode=" + (testMode ? "test" : "desktop") +
            " dshPid=" + dshPid + " hostPid=" + hostPid);
        bootGraceEnd = DateTime.UtcNow.AddSeconds(15);

        DshWin.WinInfo win = null;
        while (true)
        {
            if (!ProcAlive(rootPid)) { Log("exit: root dsh process gone"); return 0; }
            if (!testMode && !ProcAlive(hostPid)) { Log("exit: host process gone"); return 0; }
            win = FindPrimaryWindow(hostPid);
            if (win != null) break;
            Thread.Sleep(100);
        }
        while (true)
        {
            if (!ProcAlive(rootPid)) { Log("exit: root dsh process gone"); return 0; }
            if (!testMode && !ProcAlive(hostPid)) { Log("exit: host process gone"); return 0; }
            if (win != null && DshWin.Alive(win.Hwnd))
            {
                if (win.Hwnd != restoredFor) { restoredFor = win.Hwnd; }
                uint showCmd; DshWin.RECT norm;
                if (DshWin.Placement(win.Hwnd, out showCmd, out norm))
                {
                    bool maximized = (showCmd == 3);
                    string sig = norm.Left + "," + norm.Top + "," + (norm.Right - norm.Left) + "," +
                        (norm.Bottom - norm.Top) + "," + maximized;
                    if (sig != lastSig) { lastSig = sig; SaveState(norm, maximized); }
                }
                Thread.Sleep(1000);
            }
            else
            {
                Thread.Sleep(1000);
            }
        }
    }

    static DshWin.WinInfo FindPrimaryWindow(long hostPid)
    {
        if (hostPid <= 0) return null;
        DshWin.WinInfo[] wins = DshWin.WindowsOfPid((uint)hostPid);
        DshWin.WinInfo best = null;
        long bestArea = 0;
        foreach (DshWin.WinInfo w in wins)
        {
            if (w.ClassName != "Chrome_WidgetWin_1") continue;
            if ((w.Style & 0x00040000) == 0) continue; // WS_THICKFRAME
            int wd = w.Rect.Right - w.Rect.Left;
            int ht = w.Rect.Bottom - w.Rect.Top;
            if (wd < 400 || ht < 300) continue;
            if ((long)wd * ht > bestArea) { best = w; bestArea = (long)wd * ht; }
        }
        return best;
    }
}
