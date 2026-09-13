using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace VoiceCaptureLite.Models;

public sealed record WindowInfo(nint Handle, uint ProcessId, string Title, string ProcessName)
{
    public string DisplayName => $"{Title}  ·  {ProcessName} ({ProcessId})";
    public override string ToString() => DisplayName;

    public static IReadOnlyList<WindowInfo> Enumerate()
    {
        var results = new List<WindowInfo>();
        Native.EnumWindows((handle, _) =>
        {
            if (!IsSelectableWindow(handle)) return true;
            int length = Native.GetWindowTextLength(handle);
            if (length <= 0) return true;

            var titleBuilder = new StringBuilder(length + 1);
            Native.GetWindowText(handle, titleBuilder, titleBuilder.Capacity);
            string title = titleBuilder.ToString().Trim();
            if (string.IsNullOrWhiteSpace(title)) return true;

            Native.GetWindowThreadProcessId(handle, out uint pid);
            string processName;
            try { processName = Process.GetProcessById((int)pid).ProcessName; }
            catch { processName = "未知程序"; }

            results.Add(new WindowInfo(handle, pid, title, processName));
            return true;
        }, 0);

        return results
            .OrderBy(x => x.Title, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(x => x.ProcessId)
            .ToList();
    }

    private static bool IsSelectableWindow(nint handle)
    {
        // This is an audio-source list: minimized windows can still render audio.
        // Screen-capture lists may exclude them, but that rule is not appropriate here.
        if (!Native.IsWindow(handle) || !Native.IsWindowVisible(handle)) return false;
        if (!Native.GetWindowRect(handle, out var bounds) || bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top)
            return false;

        long style = Native.GetWindowLongPtr(handle, Native.GWL_EXSTYLE).ToInt64();
        if ((style & Native.WS_EX_TOOLWINDOW) != 0 && (style & Native.WS_EX_APPWINDOW) == 0)
            return false;
        if (Native.GetWindow(handle, Native.GW_OWNER) != 0 && (style & Native.WS_EX_APPWINDOW) == 0)
            return false;

        int cloaked = 0;
        if (Native.DwmGetWindowAttribute(handle, Native.DWMWA_CLOAKED, ref cloaked, sizeof(int)) == 0 && cloaked != 0)
            return false;
        return true;
    }

    private static class Native
    {
        public delegate bool EnumWindowsProc(nint hWnd, nint lParam);

        public const int GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x00000080;
        public const long WS_EX_APPWINDOW = 0x00040000;
        public const uint GW_OWNER = 4;
        public const int DWMWA_CLOAKED = 14;

        [StructLayout(LayoutKind.Sequential)]
        public struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc callback, nint lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(nint hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(nint hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(nint hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(nint hWnd, out Rect rect);

        [DllImport("user32.dll")]
        public static extern nint GetWindow(nint hWnd, uint command);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        public static extern nint GetWindowLongPtr(nint hWnd, int index);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(nint hWnd, int attribute, ref int value, int valueSize);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(nint hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(nint hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);
    }
}
