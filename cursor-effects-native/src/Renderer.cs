using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

sealed class D2DRenderer : IDisposable {
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CreateFn(IntPtr hwnd,out IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int RenderFn(IntPtr value,int x,int y,int w,int h,[In]DrawCommand[] list,int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CaptureFn(IntPtr value,int w,int h,[In]DrawCommand[] list,int count,[Out]byte[] pixels);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int HardwareFn(IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void DestroyFn(IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int AppearanceFn(IntPtr value,uint trail,uint ripple,uint particle);
    static readonly CreateFn CursorCreate=EmbeddedRuntime.Function<CreateFn>("CursorCreate");
    static readonly RenderFn CursorRender=EmbeddedRuntime.Function<RenderFn>("CursorRender");
    static readonly CaptureFn CursorCapture=EmbeddedRuntime.Function<CaptureFn>("CursorCapture");
    static readonly HardwareFn CursorHardware=EmbeddedRuntime.Function<HardwareFn>("CursorHardware");
    static readonly DestroyFn CursorDestroy=EmbeddedRuntime.Function<DestroyFn>("CursorDestroy");
    static readonly AppearanceFn CursorAppearance=EmbeddedRuntime.Function<AppearanceFn>("CursorAppearance");
    IntPtr handle;readonly DrawCommand[] commands=new DrawCommand[2048];public bool Hardware{get{return CursorHardware(handle)!=0;}}public Rectangle Surface=new Rectangle(0,0,1,1);
    public D2DRenderer(IntPtr hwnd){Marshal.ThrowExceptionForHR(CursorCreate(hwnd,out handle));Clear();}
    public void Appearance(Color trail,Color ripple,Color particle){Marshal.ThrowExceptionForHR(CursorAppearance(handle,unchecked((uint)trail.ToArgb()),unchecked((uint)ripple.ToArgb()),unchecked((uint)particle.ToArgb())));}
    public void Draw(CursorEffects effects){effects.Commands.CopyTo(commands);Surface=effects.Surface();Marshal.ThrowExceptionForHR(CursorRender(handle,Surface.X,Surface.Y,Surface.Width,Surface.Height,commands,effects.Commands.Count));}
    public void Clear(){if(handle!=IntPtr.Zero){Surface=new Rectangle(0,0,1,1);Marshal.ThrowExceptionForHR(CursorRender(handle,0,0,1,1,commands,0));}}
    public byte[] Capture(CursorEffects effects,int width,int height){effects.Commands.CopyTo(commands);var pixels=new byte[width*height*4];Marshal.ThrowExceptionForHR(CursorCapture(handle,width,height,commands,effects.Commands.Count,pixels));return pixels;}
    public static void Save(byte[] pixels,int width,int height,string path){using(var image=new Bitmap(width,height,PixelFormat.Format32bppPArgb)){var data=image.LockBits(new Rectangle(0,0,width,height),ImageLockMode.WriteOnly,PixelFormat.Format32bppPArgb);try{for(int y=0;y<height;y++)Marshal.Copy(pixels,y*width*4,data.Scan0+y*data.Stride,width*4);}finally{image.UnlockBits(data);}image.Save(path,ImageFormat.Png);}}
    public void Dispose(){if(handle!=IntPtr.Zero){CursorDestroy(handle);handle=IntPtr.Zero;}}
}
