# Shared helpers for testing our own Win32 applications in physical pixels.
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class CaptureUiNative {
    [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
    public static string DownloadsPath() {
        Guid id=new Guid("374DE290-123F-4565-9164-39C4925E467B"); IntPtr path;
        if(SHGetKnownFolderPath(ref id,0,IntPtr.Zero,out path)!=0) throw new Exception("Cannot resolve Downloads");
        try{return Marshal.PtrToStringUni(path);} finally{Marshal.FreeCoTaskMem(path);}
    }
    public delegate bool EnumCallback(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
        public uint Size, Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public RECT CaretRect;
    }
    [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    public static IntPtr FocusedWindow(IntPtr window) {
        uint process; uint thread=GetWindowThreadProcessId(window,out process);
        var info=new GUITHREADINFO { Size=(uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
        return GetGUIThreadInfo(thread,ref info)?info.Focus:IntPtr.Zero;
    }
    public static IntPtr CaretWindow(IntPtr window) {
        uint process; uint thread=GetWindowThreadProcessId(window,out process);
        var info=new GUITHREADINFO { Size=(uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
        return GetGUIThreadInfo(thread,ref info)?info.Caret:IntPtr.Zero;
    }
    [StructLayout(LayoutKind.Sequential)] public struct TRACKMOUSEEVENT { public uint Size, Flags; public IntPtr Window; public uint HoverTime; }
    [DllImport("user32.dll")] public static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT track);
    public static void CancelMouseTracking(IntPtr window) {
        var track = new TRACKMOUSEEVENT { Size=(uint)Marshal.SizeOf(typeof(TRACKMOUSEEVENT)), Flags=0x80000002, Window=window };
        TrackMouseEvent(ref track);
    }
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
    public static extern IntPtr SendText(IntPtr h, uint m, IntPtr w, string l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
    public static extern IntPtr SendBuffer(IntPtr h, uint m, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder b, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint affinity);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
    public static bool HotkeyAvailable(uint modifiers, uint key) {
        const int id=0x4c43;
        if (!RegisterHotKey(IntPtr.Zero,id,modifiers,key)) return false;
        UnregisterHotKey(IntPtr.Zero,id); return true;
    }
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT point);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpi);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr region, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    public static void Hotkey(byte key, byte[] modifiers) {
        foreach (var modifier in modifiers) keybd_event(modifier,0,0,UIntPtr.Zero);
        keybd_event(key,0,0,UIntPtr.Zero); keybd_event(key,0,2,UIntPtr.Zero);
        for (int i=modifiers.Length-1;i>=0;--i) keybd_event(modifiers[i],0,2,UIntPtr.Zero);
    }
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();
    public static IntPtr Point(int x, int y) { return (IntPtr)((y << 16) | (x & 0xffff)); }
    public static IntPtr FindChild(IntPtr parent, int id, string className) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (h,p) => {
            var name = new StringBuilder(128); GetClassName(h,name,128);
            if (GetDlgCtrlID(h) == id && name.ToString() == className) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static Color ScreenPixel(int x, int y) {
        DwmFlush();
        using (Bitmap bitmap = new Bitmap(1,1)) {
            using (Graphics g = Graphics.FromImage(bitmap)) g.CopyFromScreen(x,y,0,0,bitmap.Size);
            return bitmap.GetPixel(0,0);
        }
    }
    public static void Snapshot(IntPtr window, string path, bool desktop) {
        SnapshotCore(window,path,desktop,true);
    }
    public static void SnapshotUnrefreshed(IntPtr window, string path) {
        SnapshotCore(window,path,true,false);
    }
    static void SnapshotCore(IntPtr window, string path, bool desktop, bool repaint) {
        if (repaint) RedrawWindow(window, IntPtr.Zero, IntPtr.Zero, 0x181);
        RECT r; GetClientRect(window, out r);
        using (Bitmap bitmap = new Bitmap(r.Right, r.Bottom)) {
            using (Graphics g = Graphics.FromImage(bitmap)) {
                if (desktop) {
                    POINT p = new POINT(); ClientToScreen(window, ref p);
                    DwmFlush(); g.CopyFromScreen(p.X, p.Y, 0, 0, bitmap.Size);
                } else {
                    IntPtr dc = g.GetHdc();
                    try {
                        PrintWindow(window, dc, 3);
                    } finally { g.ReleaseHdc(dc); }
                }
            }
            bitmap.Save(path, ImageFormat.Png);
        }
    }
}
'@
[void][CaptureUiNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Find-TestWindow([string]$ClassName, [int]$ProcessId) {
    $script:foundWindow = [IntPtr]::Zero
    $callback = [CaptureUiNative+EnumCallback]{
        param([IntPtr]$window, [IntPtr]$parameter)
        $name = [Text.StringBuilder]::new(128)
        [uint32]$ownerProcess = 0
        [void][CaptureUiNative]::GetWindowThreadProcessId($window, [ref]$ownerProcess)
        [void][CaptureUiNative]::GetClassName($window, $name, $name.Capacity)
        if ($name.ToString() -eq $ClassName -and $ownerProcess -eq $ProcessId) {
            $script:foundWindow = $window
            return $false
        }
        return $true
    }
    [void][CaptureUiNative]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:foundWindow
}
function Wait-TestWindow([string]$ClassName, [int]$ProcessId, [bool]$Visible = $true) {
    for ($attempt = 0; $attempt -lt 100; ++$attempt) {
        $window = Find-TestWindow $ClassName $ProcessId
        if ($window -ne [IntPtr]::Zero -and (!$Visible -or [CaptureUiNative]::IsWindowVisible($window))) { return $window }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for $ClassName"
}
function Get-ControlText([IntPtr]$Parent, [int]$Id) {
    $text = [Text.StringBuilder]::new(32768)
    [void][CaptureUiNative]::SendBuffer([CaptureUiNative]::GetDlgItem($Parent, $Id), 0x000D, [IntPtr]$text.Capacity, $text)
    return $text.ToString()
}
function Set-ControlText([IntPtr]$Parent, [int]$Id, [string]$Value) {
    [void][CaptureUiNative]::SendText([CaptureUiNative]::GetDlgItem($Parent, $Id), 0x000C, [IntPtr]::Zero, $Value)
}
function Send-Command([IntPtr]$Window, [int]$Id) {
    [void][CaptureUiNative]::PostMessage($Window, 0x0111, [IntPtr]$Id, [IntPtr]::Zero)
}
function Wait-Control([IntPtr]$Parent, [int]$Id, [bool]$Visible = $true) {
    for ($attempt = 0; $attempt -lt 160; ++$attempt) {
        $control = [CaptureUiNative]::GetDlgItem($Parent, $Id)
        if ($control -ne [IntPtr]::Zero -and [CaptureUiNative]::IsWindowVisible($control) -eq $Visible) { return $control }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for control $Id visible=$Visible"
}
function Get-TestRect([IntPtr]$Window) {
    $rect = [CaptureUiNative+RECT]::new()
    [void][CaptureUiNative]::GetWindowRect($Window, [ref]$rect)
    return @($rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
}
function Stop-TestApp($Process, [IntPtr]$Main) {
    if (!$Process.HasExited) {
        [void][CaptureUiNative]::PostMessage($Main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        if (!$Process.WaitForExit(3000)) { Stop-Process -Id $Process.Id -Force }
    }
}
