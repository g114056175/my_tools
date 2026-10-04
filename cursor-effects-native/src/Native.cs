using System;
using System.Drawing;
using System.Runtime.InteropServices;

static class Native {
    delegate bool EnumWindowsProc(IntPtr hwnd,IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback,IntPtr state);
    public static void MarkNativeHost(IntPtr hwnd){if(!SetProp(hwnd,"BlueArchiveCursor.Native.Compact.Host",new IntPtr(1)))throw new System.ComponentModel.Win32Exception();}
    public static IntPtr NativeHost(){IntPtr result=IntPtr.Zero;EnumWindowsProc callback=(hwnd,state)=>{if(GetProp(hwnd,"BlueArchiveCursor.Native.Compact.Host").ToInt64()!=1)return true;result=hwnd;return false;};EnumWindows(callback,IntPtr.Zero);return result;}
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int RegisterWindowMessage(string value);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,int message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern void NotifyWinEvent(uint eventId,IntPtr hwnd,int objectId,int childId);
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
    public static IntPtr[] TaskbarHandles(){var result=new System.Collections.Generic.List<IntPtr>();foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero)if(IsWindowVisible(h))result.Add(h);}return result.ToArray();}
    public static IntPtr[] ShellInputHandles(){var result=new System.Collections.Generic.List<IntPtr>(TaskbarHandles());foreach(var name in new[]{"Progman","WorkerW"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero){result.Add(h);var icons=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);if(icons!=IntPtr.Zero){result.Add(icons);var list=FindWindowEx(icons,IntPtr.Zero,"SysListView32",null);if(list!=IntPtr.Zero)result.Add(list);}}}return result.ToArray();}
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
    public static Rectangle[] Taskbars(){var result=new System.Collections.Generic.List<Rectangle>();foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr h=IntPtr.Zero;while((h=FindWindowEx(IntPtr.Zero,h,name,null))!=IntPtr.Zero){WinRect r;if(IsWindowVisible(h)&&GetWindowRect(h,out r))result.Add(Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom));}}return result.ToArray();}
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
    public static bool IsAboveTaskbars(IntPtr hwnd){foreach(var name in new[]{"Shell_TrayWnd","Shell_SecondaryTrayWnd"}){IntPtr bar=IntPtr.Zero;while((bar=FindWindowEx(IntPtr.Zero,bar,name,null))!=IntPtr.Zero){if(!IsWindowVisible(bar))continue;var h=hwnd;for(int i=0;i<10000&&(h=GetWindow(h,3))!=IntPtr.Zero;i++)if(h==bar)return false;}}return true;}
    public static void DecorationPriority(IntPtr hwnd,int priority){if(!SetProp(hwnd,"SpineDecorationPriority",new IntPtr(priority)))throw new System.ComponentModel.Win32Exception();}
    public static IntPtr WindowAboveDecoration(IntPtr hwnd,int priority){var h=hwnd;for(int i=0;i<10000&&(h=GetWindow(h,3))!=IntPtr.Zero;i++){
        WinRect rect;if(!IsWindowVisible(h)||!GetWindowRect(h,out rect)||rect.Right<=rect.Left||rect.Bottom<=rect.Top)continue;
        if(GetProp(h,"SpineDecorationPriority").ToInt64()>=priority||GetProp(GetAncestor(h,3),"SpineDecorationPriority").ToInt64()>=priority)continue;
        // Software cursor overlays belong above decorative trails, just like
        // the hardware pointer. Never fight a small, inert cursor window.
        if(rect.Right-rect.Left<=256&&rect.Bottom-rect.Top<=256&&(GetWindowLongPtr(h,-20).ToInt64()&0x08080020L)==0x08080020L){var name=new System.Text.StringBuilder(128);GetClassName(h,name,name.Capacity);if(name.ToString().IndexOf("CursorOverlay",StringComparison.OrdinalIgnoreCase)>=0)continue;}
        return h;
    }return IntPtr.Zero;}
    [DllImport("user32.dll")] public static extern IntPtr GetCapture();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct DisplayMode {
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Device;
        public ushort Spec,Driver,Size,Extra;public uint Fields;
        public int X,Y;public uint Orientation,FixedOutput;public short Color,Duplex,YResolution,TTOption,Collate;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Form;
        public ushort LogPixels;public uint BitsPerPixel,Width,Height,Flags,Frequency,ICMMethod,ICMIntent,Media,Dither,Reserved1,Reserved2,PanningWidth,PanningHeight;
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettings(string device,int mode,ref DisplayMode settings);
    public static int RefreshRate(string device){var mode=new DisplayMode();mode.Size=(ushort)Marshal.SizeOf(mode);return EnumDisplaySettings(device,-1,ref mode)&&mode.Frequency>1?Math.Max(30,Math.Min(360,(int)mode.Frequency)):60;}
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
    public static bool BelongsTo(IntPtr window,IntPtr root){return window==root||IsChild(root,window);}
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder text,int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint process);
    public static string DescribeWindow(IntPtr hwnd){var name=new System.Text.StringBuilder(128);GetClassName(hwnd,name,name.Capacity);uint process;GetWindowThreadProcessId(hwnd,out process);return hwnd+":"+name+":pid="+process+":priority="+GetProp(hwnd,"SpineDecorationPriority")+":ownerPriority="+GetProp(GetAncestor(hwnd,3),"SpineDecorationPriority")+":ex="+GetWindowLongPtr(hwnd,-20);}
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
    [DllImport("dcomp.dll")] static extern int DCompositionCreateDevice(IntPtr dxgi,ref Guid iid,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CommitFn(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TargetFn(IntPtr self,IntPtr hwnd,[MarshalAs(UnmanagedType.Bool)] bool top,out IntPtr target);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int VisualFn(IntPtr self,out IntPtr visual);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RootFn(IntPtr self,IntPtr visual);
    static T Slot<T>(IntPtr self,int slot){return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(self),slot*IntPtr.Size),typeof(T));}
    public sealed class Composition : IDisposable {
        IntPtr device,target,visual; public object Visual;
        public Composition(IntPtr hwnd){
            Guid iid=new Guid("C37EA93A-E7AA-450D-B16F-9746CB0407F3");
            Marshal.ThrowExceptionForHR(DCompositionCreateDevice(IntPtr.Zero,ref iid,out device));
            Marshal.ThrowExceptionForHR(Slot<TargetFn>(device,6)(device,hwnd,true,out target));
            Marshal.ThrowExceptionForHR(Slot<VisualFn>(device,7)(device,out visual));
            Marshal.ThrowExceptionForHR(Slot<RootFn>(target,3)(target,visual));Visual=Marshal.GetObjectForIUnknown(visual);Commit();
        }
        public void Commit(){Marshal.ThrowExceptionForHR(Slot<CommitFn>(device,3)(device));}
        public void Dispose(){if(Visual!=null){Marshal.ReleaseComObject(Visual);Visual=null;}foreach(var p in new[]{visual,target,device})if(p!=IntPtr.Zero)Marshal.Release(p);}
    }
}
