using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.Threading;

sealed class Overlay : Form {
    readonly CursorHost host;
    public Overlay(CursorHost value){host=value;Text="Native cursor decoration";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;AutoScaleMode=AutoScaleMode.None;Enabled=false;Bounds=SystemInformation.VirtualScreen;}
    protected override bool ShowWithoutActivation{get{return true;}}
    // DirectComposition owns the pixels. There is no full-screen GDI bitmap or
    // browser HWND, and the disabled non-activating overlay cannot consume input.
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80|0x20|0x00200000|0x80000;return p;}}
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);Native.MarkNonFullscreen(Handle);Native.DecorationPriority(Handle,100);if(!host.Test)Native.MarkNativeHost(Handle);if(!Native.SetLayeredWindowAttributes(Handle,0,255,2))throw new System.ComponentModel.Win32Exception();Native.EnableWindow(Handle,false);}
    protected override void OnPaintBackground(PaintEventArgs e){}
    protected override void OnPaint(PaintEventArgs e){}
    public void Display(bool visible,bool top){if(!visible){Hide();return;}if(!Visible)Show();Enabled=false;Native.EnableWindow(Handle,false);Native.SetWindowPos(Handle,new IntPtr(top?-1:-2),0,0,0,0,0x1|0x2|0x10|0x40|0x200);}
    protected override void WndProc(ref Message m){
        if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}
        if(m.Msg==Program.ShowMessage){host.ShowControls();return;}
        if(m.Msg==Program.FrameMessage){host.Frame();return;}
        if(m.Msg==0x7E||m.Msg==0x2E0)BeginInvoke((Action)(()=>host.DisplayChanged()));base.WndProc(ref m);
    }
}

sealed partial class CursorHost : ApplicationContext {
    public readonly bool Test=false;
#if SELF_TEST
    readonly bool performanceTest;
#endif
    public readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    readonly Overlay overlay;readonly ControlsWindow controls;D2DRenderer renderer;
    readonly CursorEffects effects=new CursorEffects();readonly Stopwatch clock=Stopwatch.StartNew();readonly string profile;
    readonly System.Windows.Forms.Timer inputTimer=new System.Windows.Forms.Timer{Interval=8},healthTimer=new System.Windows.Forms.Timer{Interval=1000},configureTimer=new System.Windows.Forms.Timer{Interval=16},saveTimer=new System.Windows.Forms.Timer{Interval=350};
    readonly FrameClock frameTimer;
    NotifyIcon tray;ContextMenuStrip trayMenu;ToolStripMenuItem visibilityItem;Native.ZOrderObserver orderObserver;
    bool ready,failed,quitting,mouse,hasPoint,repairingLayer,suppressedPress,animating;Point previous;
    long inputMessages,lastHealth;const int cursorFps=60;int layerRepairs,frameQueued;IntPtr blockedAbove;
    double lastFrame,nextFrame;int recoveryAttempts;long recoveryWindow;
    public long Frames;
#if SELF_TEST
    public readonly List<double> Intervals=new List<double>(),DrawTimes=new List<double>();bool measuring;
#endif
    readonly Dictionary<IntPtr,long> repairTimes=new Dictionary<IntPtr,long>();readonly Queue<string> layerTrace=new Queue<string>();
    public CursorHost(string[] args){
#if SELF_TEST
        performanceTest=args.Contains("--performance-test");Test=args.Contains("--self-test")||performanceTest;
#endif
        profile=Test?Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"test-profile-"+Process.GetCurrentProcess().Id):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BlueArchiveCursor.Native");Directory.CreateDirectory(profile);
        configureTimer.Tick+=(s,e)=>{configureTimer.Stop();Configure();};saveTimer.Tick+=(s,e)=>{saveTimer.Stop();SaveControls();};inputTimer.Tick+=(s,e)=>Tick();healthTimer.Tick+=(s,e)=>HealthCheck();
        overlay=new Overlay(this);var hwnd=overlay.Handle;frameTimer=new FrameClock(()=>{if(Interlocked.Exchange(ref frameQueued,1)==0&&!Native.PostMessage(hwnd,Program.FrameMessage,IntPtr.Zero,IntPtr.Zero))Interlocked.Exchange(ref frameQueued,0);});controls=new ControlsWindow(this);RestoreControls();if(!Test||args.Contains("--controls-test"))controls.Show();overlay.BeginInvoke((Action)Start);
    }
    void Start(){try{
        EmbeddedRuntime.Initialize(profile);renderer=new D2DRenderer(overlay.Handle);ready=true;
        trayMenu=new ContextMenuStrip{BackColor=AppTheme.Card,ForeColor=AppTheme.Text,Renderer=new DarkMenuRenderer(),ShowImageMargin=false,Font=controls.Font};trayMenu.Items.Add("開啟控制面板",null,(s,e)=>ShowControls());
        visibilityItem=new ToolStripMenuItem();visibilityItem.Click+=(s,e)=>controls.VisibleValue.Checked=!controls.VisibleValue.Checked;trayMenu.Items.Add(visibilityItem);trayMenu.Items.Add(new ToolStripSeparator());trayMenu.Items.Add("退出",null,(s,e)=>Quit(0));trayMenu.Opening+=(s,e)=>UpdateVisibilityMenu();
        tray=new NotifyIcon{Icon=AppTheme.Icon,Text="滑鼠光跡",Visible=!Test,ContextMenuStrip=trayMenu};tray.DoubleClick+=(s,e)=>ShowControls();UpdateVisibilityMenu();
        orderObserver=new Native.ZOrderObserver(source=>{if(source!=overlay.Handle&&Native.GetAncestor(source,3)!=controls.Handle)RepairLayer(source);});healthTimer.Start();Configure();
        if(!renderer.Hardware){controls.Status.Text="目前使用軟體繪圖";controls.Status.Visible=true;}
#if SELF_TEST
        if(performanceTest)RunPerformance();else if(Test)RunTest();
#endif
    }catch(Exception e){Fail(e.Message);
#if SELF_TEST
        if(Test){File.WriteAllText(Path.Combine(profile,performanceTest?"performance.json":"test.json"),Json.Serialize(new{passed=false,error=e.ToString()}));Quit(1);}
#endif
    }}
    public void ShowControls(){if(!quitting)controls.ShowPanel();}
    public void UpdateVisibilityMenu(){if(visibilityItem!=null)visibilityItem.Text=controls.VisibleValue.Checked?"關閉效果":"開啟效果";}
    public void Fail(string message){if(quitting)return;failed=true;inputTimer.Stop();StopAnimation(false);overlay.Display(false,false);controls.Status.Visible=true;controls.Status.Text="已停止："+message;Log(message);}
    void Log(string message){try{File.AppendAllText(Path.Combine(profile,"host.log"),DateTime.Now.ToString("s")+" "+message+Environment.NewLine);}catch{}}
    public void ScheduleConfigure(){if(!configureTimer.Enabled)configureTimer.Start();}
    public void Configure(){
        configureTimer.Stop();UpdateVisibilityMenu();if(!Test&&!controls.Updating){saveTimer.Stop();saveTimer.Start();}if(!ready||failed||quitting)return;
        try{
            var bounds=SystemInformation.VirtualScreen;
            if(overlay.Bounds!=bounds){StopAnimation(true);overlay.Bounds=bounds;effects.Viewport=bounds;hasPoint=false;}
            effects.Configure(controls.Trail.Checked,controls.ClickValue.Checked,1,1,(double)controls.OpacityValue.Value/100,cursorFps);
            effects.Customize((double)controls.EffectSize.Value/100,(double)controls.RippleSize.Value/100,(double)controls.FragmentSize.Value/100,(double)controls.FragmentSize.Value/100,1,1);
            effects.SetParticleSpeed((double)controls.ParticleSpeed.Value/100);effects.SetClickSpeed((double)controls.ParticleSpeed.Value/100);
            effects.SetTrailSpread(1);effects.SetTrailLifetime((double)controls.TrailFade.Value/1000);
            effects.SetTrailEmission((double)controls.TrailSpacing.Value,.35);effects.SetTrailGap(8);
            effects.SetClickParticles(4,50);effects.SetClickScatter(.35);effects.SetClickCountRange((int)controls.ClickMin.Value,(int)controls.ClickMax.Value);
            renderer.Appearance(controls.TrailColor.Value,controls.RippleColor.Value,controls.FragmentColor.Value);
            bool visible=controls.VisibleValue.Checked&&controls.OpacityValue.Value>0&&(controls.Trail.Checked||controls.ClickValue.Checked);blockedAbove=IntPtr.Zero;
            bool wasTop=(Native.GetWindowLongPtr(overlay.Handle,-20).ToInt64()&8)!=0;
            if(overlay.Visible!=visible||visible&&!wasTop)overlay.Display(visible,true);
            if(visible){inputTimer.Start();if(effects.Alive>0)Wake();else StopAnimation(true);}else{inputTimer.Stop();mouse=false;hasPoint=false;StopAnimation(true);}
            controls.Status.Visible=!renderer.Hardware;if(!renderer.Hardware)controls.Status.Text="目前使用軟體繪圖";
        }catch(Exception e){Fail(e.Message);}
    }
    public void DisplayChanged(){if(quitting)return;StopAnimation(true);hasPoint=false;Configure();}
    void HealthCheck(){long now=clock.ElapsedMilliseconds,gap=now-lastHealth;lastHealth=now;if(!ready||quitting||failed||!overlay.Visible)return;if(gap>4000)StopAnimation(true);if(Native.IsWindowEnabled(overlay.Handle)){Native.EnableWindow(overlay.Handle,false);if(Native.IsWindowEnabled(overlay.Handle))Fail("裝飾視窗輸入模式檢查失敗");}}
    void Tick(){
        if(!ready||quitting||failed||!overlay.Visible)return;bool pressed=(Native.GetAsyncKeyState(1)&0x8000)!=0;
#if SELF_TEST
        if(performanceTest)return;
#endif
        if(!pressed&&!mouse)return;Point p;if(!Native.GetCursorPos(out p))return;if(pressed==mouse&&hasPoint&&p==previous)return;bool down=pressed&&!mouse;
        var under=Native.GetAncestor(Native.WindowFromPoint(p),2);bool blocked=trayMenu!=null&&trayMenu.Visible||controls.Visible&&(under==controls.Handle||Native.GetAncestor(under,3)==controls.Handle);
        if(down)suppressedPress=blocked;Pointer(p.X,p.Y,down,pressed,blocked||suppressedPress);inputMessages++;previous=p;hasPoint=true;mouse=pressed;if(!pressed)suppressedPress=false;
    }
    void Pointer(double x,double y,bool down,bool pressed,bool blocked=false){effects.Input(x,y,down,pressed,blocked);Wake();}
    void Wake(){if(animating||failed||quitting||effects.Alive==0&&!effects.Dirty)return;animating=true;lastFrame=clock.Elapsed.TotalMilliseconds;nextFrame=lastFrame;frameTimer.Arm(0);}
    void ScheduleFrame(){if(animating&&!quitting)frameTimer.Arm(Math.Max(0,nextFrame-clock.Elapsed.TotalMilliseconds));}
    public void Frame(){
        Interlocked.Exchange(ref frameQueued,0);if(!animating||quitting||failed)return;
        double now=clock.Elapsed.TotalMilliseconds;if(now-lastFrame>250){StopAnimation(true);return;}
        if(now+.5<nextFrame){ScheduleFrame();return;}
        try{
            double start=clock.Elapsed.TotalMilliseconds;bool draw=effects.Draw((now-lastFrame)/1000);
            if(draw){renderer.Draw(effects);Frames++;
#if SELF_TEST
                if(measuring){Intervals.Add(now-lastFrame);DrawTimes.Add(clock.Elapsed.TotalMilliseconds-start);}
#endif
            }
            lastFrame=now;double period=1000.0/effects.Fps;nextFrame=Math.Max(nextFrame+period,now-period/2);
            if(effects.Alive==0&&!effects.Dirty){StopAnimation(false,false);return;}ScheduleFrame();
        }catch(COMException e){if(e.ErrorCode==unchecked((int)0x8899000C)||e.ErrorCode==unchecked((int)0x887A0005)||e.ErrorCode==unchecked((int)0x887A0007)){RecoverDevice();}else Fail(e.Message);}catch(Exception e){Fail(e.Message);}
    }
    void StopAnimation(bool clear,bool resetPointer=true){animating=false;frameTimer.Cancel();effects.Clear(resetPointer);if(clear&&renderer!=null)renderer.Clear();}
    void RecoverDevice(){
        StopAnimation(false);long now=clock.ElapsedMilliseconds;if(now-recoveryWindow>10000){recoveryAttempts=0;recoveryWindow=now;}if(++recoveryAttempts>2){Fail("繪圖裝置持續失敗");return;}
        try{renderer.Dispose();renderer=new D2DRenderer(overlay.Handle);Configure();Log("繪圖裝置已重建");}catch(Exception e){Fail(e.Message);}
    }
    void RepairLayer(IntPtr source){
        if(repairingLayer||quitting||failed||!ready||!overlay.Visible)return;var above=Native.WindowAboveDecoration(overlay.Handle,100);if(above==IntPtr.Zero){blockedAbove=IntPtr.Zero;return;}if(above==blockedAbove&&(source==blockedAbove||source==Native.GetDesktopWindow()))return;
        long now=clock.ElapsedMilliseconds,lastRepair;if(repairTimes.TryGetValue(above,out lastRepair)&&now-lastRepair<1000)return;repairTimes[above]=now;if(repairTimes.Count>32)repairTimes.Remove(repairTimes.OrderBy(pair=>pair.Value).First().Key);
        repairingLayer=true;try{Native.SetWindowPos(overlay.Handle,new IntPtr(-1),0,0,0,0,0x213);layerRepairs++;blockedAbove=Native.WindowAboveDecoration(overlay.Handle,100);if(Test){layerTrace.Enqueue("source="+Native.DescribeWindow(source)+" above="+Native.DescribeWindow(above)+" remains="+Native.DescribeWindow(blockedAbove));while(layerTrace.Count>12)layerTrace.Dequeue();}}finally{repairingLayer=false;}
    }
    string ControlsPath{get{return Path.Combine(profile,"settings.json");}}
    void RestoreControls(bool force=false){
        if(Test&&!force||!File.Exists(ControlsPath))return;controls.Updating=true;
        try{var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(ControlsPath));object value;ResetFields();
            Action<string,NumberField> number=(key,input)=>{if(data.TryGetValue(key,out value))input.Value=Convert.ToDecimal(value);};
            Action<string,CheckBox> check=(key,input)=>{if(data.TryGetValue(key,out value)&&value is bool)input.Checked=(bool)value;};
            number("size",controls.EffectSize);number("size",controls.RippleSize);number("size",controls.FragmentSize);
            number("trailWidth",controls.EffectSize);number("rippleSize",controls.RippleSize);
            number("clickFragmentSize",controls.FragmentSize);number("trailFragmentSize",controls.FragmentSize);number("fragmentSize",controls.FragmentSize);
            number("trailOpacity",controls.OpacityValue);number("opacity",controls.OpacityValue);
            number("particleSpeed",controls.ParticleSpeed);number("trailFadeMs",controls.TrailFade);
            if(data.TryGetValue("particles",out value)){double density=Math.Max(0,Math.Min(300,Convert.ToDouble(value)))/100;controls.TrailSpacing.Value=density>0?(decimal)(80/density):0;SetLegacyCount((int)Math.Round(4*density),1);}
            if(data.TryGetValue("clickCount",out value)){int count=Convert.ToInt32(value),jitter=1;object spread;if(data.TryGetValue("clickCountJitter",out spread))jitter=Convert.ToInt32(spread);SetLegacyCount(count,jitter);}
            number("trailSpacing",controls.TrailSpacing);number("clickMin",controls.ClickMin);number("clickMax",controls.ClickMax);
            if(controls.ClickMin.Value>controls.ClickMax.Value){decimal low=controls.ClickMax.Value;controls.ClickMax.Value=controls.ClickMin.Value;controls.ClickMin.Value=low;}
            check("trail",controls.Trail);check("click",controls.ClickValue);
            Action<string,ColorField> color=(key,input)=>{if(data.TryGetValue(key,out value)&&value is string){string hex=((string)value).TrimStart('#');int rgb;if(hex.Length==6&&int.TryParse(hex,System.Globalization.NumberStyles.HexNumber,System.Globalization.CultureInfo.InvariantCulture,out rgb))input.Value=Color.FromArgb(255,(rgb>>16)&255,(rgb>>8)&255,rgb&255);}};
            color("trailColor",controls.TrailColor);color("rippleColor",controls.RippleColor);color("fragmentColor",controls.FragmentColor);
            int version=data.TryGetValue("version",out value)?Convert.ToInt32(value):0;
            if(version<9&&controls.TrailColor.Text=="#45EDFF"&&controls.RippleColor.Text=="#45EDFF"&&controls.FragmentColor.Text=="#C4FCFF")controls.FragmentColor.Value=ColorPalette.All[0].Fragment;
            if(version<7&&controls.TrailColor.Text=="#EF83AD"&&controls.RippleColor.Text=="#DB5A91"&&controls.FragmentColor.Text=="#FFE1EC"){var p=ColorPalette.All[2];controls.TrailColor.Value=p.Trail;controls.RippleColor.Value=p.Ripple;controls.FragmentColor.Value=p.Fragment;}
            if(data.ContainsKey("enabled"))check("enabled",controls.VisibleValue);else check("visible",controls.VisibleValue);
        }catch(Exception e){Log("設定載入失敗："+e.Message);}finally{controls.Updating=false;controls.SyncPalette();}
    }
    void SetLegacyCount(int count,int jitter){controls.ClickMin.Value=count<=0?0:count-Math.Max(0,jitter);controls.ClickMax.Value=count<=0?0:count+Math.Max(0,jitter);}
    void SaveControls(bool force=false){if(Test&&!force||controls.Updating)return;try{
        var data=new{version=13,trailWidth=controls.EffectSize.Value,rippleSize=controls.RippleSize.Value,fragmentSize=controls.FragmentSize.Value,opacity=controls.OpacityValue.Value,particleSpeed=controls.ParticleSpeed.Value,trailFadeMs=controls.TrailFade.Value,trailSpacing=controls.TrailSpacing.Value,clickMin=controls.ClickMin.Value,clickMax=controls.ClickMax.Value,trail=controls.Trail.Checked,click=controls.ClickValue.Checked,enabled=controls.VisibleValue.Checked,trailColor=controls.TrailColor.Text,rippleColor=controls.RippleColor.Text,fragmentColor=controls.FragmentColor.Text};
        var temp=ControlsPath+".tmp";File.WriteAllText(temp,Json.Serialize(data),Encoding.UTF8);if(File.Exists(ControlsPath))File.Replace(temp,ControlsPath,null);else File.Move(temp,ControlsPath);
    }catch(Exception e){Log("設定儲存失敗："+e.Message);}}
    public void ApplyPalette(ColorPalette palette){controls.Updating=true;try{controls.TrailColor.Value=palette.Trail;controls.RippleColor.Value=palette.Ripple;controls.FragmentColor.Value=palette.Fragment;}finally{controls.Updating=false;}controls.SyncPalette();Configure();}
    void ResetFields(){foreach(var n in controls.Numbers)n.Value=100;controls.TrailSpacing.Value=100;controls.TrailFade.Value=180;controls.ClickMin.Value=3;controls.ClickMax.Value=5;controls.Trail.Checked=true;controls.ClickValue.Checked=true;var p=ColorPalette.All[0];controls.TrailColor.Value=p.Trail;controls.RippleColor.Value=p.Ripple;controls.FragmentColor.Value=p.Fragment;}
    public void ResetControls(){controls.Updating=true;try{ResetFields();}finally{controls.Updating=false;}controls.SyncPalette();Configure();}
    public void Quit(int code){if(quitting)return;configureTimer.Stop();saveTimer.Stop();SaveControls();quitting=true;Environment.ExitCode=code;inputTimer.Dispose();healthTimer.Dispose();configureTimer.Dispose();saveTimer.Dispose();StopAnimation(false);frameTimer.Dispose();if(orderObserver!=null)orderObserver.Dispose();if(tray!=null){tray.Visible=false;tray.Dispose();}if(trayMenu!=null)trayMenu.Dispose();overlay.Display(false,false);if(renderer!=null)renderer.Dispose();overlay.Dispose();controls.Dispose();ExitThread();}
}

static class Program {
    public const int FrameMessage=0x8001;
    public static readonly int ShowMessage=Native.RegisterWindowMessage("BlueArchiveCursor.Native.Compact.ShowControls.v2");
    [STAThread] static void Main(string[] args){bool test=false;
#if SELF_TEST
        test=args.Contains("--self-test")||args.Contains("--performance-test");
#endif
        bool created;using(var single=new Mutex(true,"Local\\BlueArchiveCursor.Native.Compact"+(test?"-test-"+Process.GetCurrentProcess().Id:""),out created)){
            if(!created){var existing=Native.NativeHost();if(existing!=IntPtr.Zero)Native.PostMessage(existing,ShowMessage,IntPtr.Zero,IntPtr.Zero);return;}
            try{Native.SetProcessDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new CursorHost(args));}finally{single.ReleaseMutex();}
        }
    }
}
