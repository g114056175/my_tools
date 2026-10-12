using System;
using System.Drawing;
using System.Runtime.InteropServices;

static class Native {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool MoveFileEx(string existing,string destination,uint flags);
    delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback,IntPtr state);
    public static void MarkNativeHost(IntPtr hwnd){if(!SetProp(hwnd,"BlueArchiveCursor.Native.Compact.Host",new IntPtr(1)))throw new System.ComponentModel.Win32Exception();}
    public static IntPtr NativeHost(){IntPtr result=IntPtr.Zero;EnumWindowsProc callback=(hwnd,state)=>{if(GetProp(hwnd,"BlueArchiveCursor.Native.Compact.Host").ToInt64()!=1)return true;result=hwnd;return false;};EnumWindows(callback,IntPtr.Zero);return result;}
#if SELF_TEST
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
#endif
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int RegisterWindowMessage(string value);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,int message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
#if SELF_TEST
    [DllImport("user32.dll")] public static extern void NotifyWinEvent(uint eventId,IntPtr hwnd,int objectId,int childId);
#endif
    delegate void WinEventProc(IntPtr hook,uint eventId,IntPtr hwnd,int objectId,int childId,uint thread,uint time);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEventProc callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    // Out-of-context notifications only: never consumes keyboard or mouse input.
    public sealed class ZOrderObserver : IDisposable {
        readonly WinEventProc callback;IntPtr foreground,reorder;
        public ZOrderObserver(Action<IntPtr> changed){
            callback=(hook,kind,hwnd,obj,child,thread,time)=>{
                // Desktop Z-order uses OBJID_CLIENT (-4); ignore app accessibility-tree reorders.
                if(kind==3||(kind==0x8004&&child==0&&hwnd!=IntPtr.Zero&&((hwnd==GetDesktopWindow()&&(obj==0||obj==-4))||(obj==0&&GetAncestor(hwnd,2)==hwnd))))changed(hwnd);
            };
            foreground=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0);
            reorder=SetWinEventHook(0x8004,0x8004,IntPtr.Zero,callback,0,0,0);
            if(foreground==IntPtr.Zero||reorder==IntPtr.Zero){Dispose();throw new System.ComponentModel.Win32Exception();}
        }
        public void Dispose(){if(foreground!=IntPtr.Zero){UnhookWinEvent(foreground);foreground=IntPtr.Zero;}if(reorder!=IntPtr.Zero){UnhookWinEvent(reorder);reorder=IntPtr.Zero;}}
    }
#if SELF_TEST
    public static IntPtr[] TaskbarHandles(){var result=new System.Collections.Generic.List<IntPtr>();foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero)if(IsWindowVisible(h))result.Add(h);}return result.ToArray();}
#endif
#if SELF_TEST
    public static IntPtr[] ShellInputHandles(){var result=new System.Collections.Generic.List<IntPtr>(TaskbarHandles());foreach(var name in new[]{"Progman","WorkerW"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero){result.Add(h);var icons=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);if(icons!=IntPtr.Zero){result.Add(icons);var list=FindWindowEx(icons,IntPtr.Zero,"SysListView32",null);if(list!=IntPtr.Zero)result.Add(list);}}}return result.ToArray();}
#endif
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetProp(IntPtr hwnd,string name,IntPtr value);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr hwnd,string name);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool EnableWindow(IntPtr hwnd,bool enabled);
    // The Shell must not classify a screen-sized decoration as a fullscreen app.
    public static void MarkNonFullscreen(IntPtr hwnd){if(!SetProp(hwnd,"NonRudeHWND",new IntPtr(1)))throw new System.ComponentModel.Win32Exception();}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string className,string title);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out WinRect rect);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [StructLayout(LayoutKind.Sequential)] struct WinRect {public int Left,Top,Right,Bottom;}
#if SELF_TEST
    public static Rectangle[] Taskbars(){var result=new System.Collections.Generic.List<Rectangle>();foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero){WinRect r;if(IsWindowVisible(h)&&GetWindowRect(h,out r))result.Add(Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom));}}return result.ToArray();}
#endif
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
#if SELF_TEST
    public static bool IsAboveTaskbars(IntPtr hwnd){foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr bar=IntPtr.Zero;while((bar=FindWindowEx(IntPtr.Zero,bar,name,null))!=IntPtr.Zero){if(!IsWindowVisible(bar))continue;var h=hwnd;for(int i=0;i<10000&&(h=GetWindow(h,3))!=IntPtr.Zero;i++)if(h==bar)return false;}}return true;}
#endif
    public static void DecorationPriority(IntPtr hwnd,int priority){if(!SetProp(hwnd,"SpineDecorationPriority",new IntPtr(priority)))throw new System.ComponentModel.Win32Exception();}
    public static IntPtr WindowAboveDecoration(IntPtr hwnd,int priority){var h=hwnd;for(int i=0;i<10000&&(h=GetWindow(h,3))!=IntPtr.Zero;i++){
        WinRect rect;if(!IsWindowVisible(h)||!GetWindowRect(h,out rect)||rect.Right<=rect.Left||rect.Bottom<=rect.Top)continue;
        if(GetProp(h,"SpineDecorationPriority").ToInt64()>=priority||GetProp(GetAncestor(h,3),"SpineDecorationPriority").ToInt64()>=priority)continue;
        // Software cursor overlays belong above decorative trails, just like
        // the hardware pointer. Never fight a small, inert cursor window.
        if(rect.Right-rect.Left<=256&&rect.Bottom-rect.Top<=256&&(GetWindowLongPtr(h,-20).ToInt64()&0x08080020L)==0x08080020L){var name=new System.Text.StringBuilder(128);GetClassName(h,name,name.Capacity);if(name.ToString().IndexOf("CursorOverlay",StringComparison.OrdinalIgnoreCase)>=0)continue;}
        return h;
    }return IntPtr.Zero;}
#if SELF_TEST
    [DllImport("user32.dll")] public static extern IntPtr GetCapture();
#endif

#if SELF_TEST
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window,IntPtr region);
#endif
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
#if SELF_TEST
    [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
#endif
#if SELF_TEST
    public static bool BelongsTo(IntPtr window,IntPtr root){return window==root||IsChild(root,window);}
#endif
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
#if SELF_TEST
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
#endif
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder text,int count);
#if SELF_TEST
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint process);
#endif
#if SELF_TEST
    public static string DescribeWindow(IntPtr hwnd){var name=new System.Text.StringBuilder(128);GetClassName(hwnd,name,name.Capacity);uint process;GetWindowThreadProcessId(hwnd,out process);return hwnd+":"+name+":pid="+process+":priority="+GetProp(hwnd,"SpineDecorationPriority")+":ownerPriority="+GetProp(GetAncestor(hwnd,3),"SpineDecorationPriority")+":ex="+GetWindowLongPtr(hwnd,-20);}
#endif
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
}
