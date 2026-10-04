using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;

sealed partial class CursorHost {
    void Require(bool value,string error){if(!value)throw new Exception(error);}
    void AssertSafe(){
        Require(!controls.MaximizeBox&&(Native.GetWindowLongPtr(controls.Handle,-16).ToInt64()&0x40000L)==0,"Controls are resizable");
        Require(!Native.IsWindowEnabled(overlay.Handle),"Overlay enabled");Require(Native.GetCapture()!=overlay.Handle,"Overlay captured input");Require(Native.GetForegroundWindow()!=overlay.Handle,"Overlay took focus");
        Require((Native.GetWindowLongPtr(overlay.Handle,-20).ToInt64()&(0x20|0x08000000|0x00200000))==(0x20|0x08000000|0x00200000),"Input/composition styles missing");
        foreach(var bar in Native.Taskbars()){var p=new Point(bar.Left+bar.Width/2,bar.Top+bar.Height/2);Require(!Native.BelongsTo(Native.WindowFromPoint(p),overlay.Handle),"Taskbar blocked");}
        foreach(var screen in Screen.AllScreens)for(int x=1;x<5;x++)for(int y=1;y<5;y++){var b=screen.WorkingArea;Require(!Native.BelongsTo(Native.WindowFromPoint(new Point(b.Left+b.Width*x/5,b.Top+b.Height*y/5)),overlay.Handle),"Screen input blocked");}
    }
    static double Alpha(byte[] pixels){double sum=0;for(int i=3;i<pixels.Length;i+=4)sum+=pixels[i];return sum;}
    CursorEffects Sample(double strength){uint seed=1234;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,400)};fx.Configure(true,true,1,strength,1,1,60);fx.Input(200,200,true,true);for(int i=1;i<=12;i++)fx.Input(200+i*12,200+Math.Sin(i*.4)*50,false,true);fx.Draw(.08);return fx;}
    void TestHighSpeedTrails(){
        var line=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};
        line.Configure(true,false,1,1,0,1,60);line.Input(20,200,true,true);line.Input(620,200,false,true);line.Draw(.01);
        var pixels=renderer.Capture(line,640,400);
        for(int x=32;x<608;x++)Require(pixels[(200*640+x)*4+3]>0,"High-speed line has a transparent gap at "+x);
        D2DRenderer.Save(pixels,640,400,Path.Combine(profile,"high-speed-trail.png"));

        var path=new CursorEffects(()=>.5){Viewport=new Rectangle(-1920,-100,3840,1080)};
        path.Configure(true,true,1,1,1,1,60);path.SetTrailSpread(0);path.Input(-1880,100,true,true);path.Input(1840,100,false,true);path.Draw(0);
        Require(path.Commands.Any(c=>c.Kind==0&&c.X==40&&c.X2==3760),"Monitor-wide drag was discarded");
        Require(path.Commands.Any(c=>c.Kind==3&&c.X2>3700),"Monitor-wide halo was discarded");
        var fragments=path.Particles.Where(p=>!p.Burst).ToArray();
        Require(fragments.Length>0&&fragments.All(p=>p.X>40&&p.X<3760&&p.Y==200)&&fragments.Select(p=>(int)(p.X/640)).Distinct().Count()>=5,"Drag fragments are not spread over the line");
        path.Input(1840,100,false,false);path.Input(-1600,300,true,true);path.Input(-1000,300,false,true);path.Draw(0);
        Require(path.Commands.Count(c=>c.Kind==0)==2,"Separate button presses were joined");
        path.Input(-900,300,false,true,true);path.Input(-300,300,false,true);path.Draw(0);
        Require(path.Commands.Count(c=>c.Kind==0)==2,"Blocked area was bridged");

        var release=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};
        release.Input(20,100,true,true);release.Input(620,100,false,false);release.Draw(0);
        Require(release.Commands.Any(c=>c.Kind==0&&c.X==20&&c.X2==620),"Fast mouse-up endpoint was lost");
        release.Input(400,300,true,true);release.Draw(0);
        Require(release.Commands.Count(c=>c.Kind==0)==1,"Mouse-up left a stale connection");

        var stress=new CursorEffects(()=>.5){Viewport=new Rectangle(-3840,0,7680,2160)};
        stress.Configure(true,true,3,3,3,1,60);stress.Customize(3,3,3,3,1,1);stress.SetTrailSpread(3);
        for(int i=0;i<1000;i++){
            stress.Input(i%2==0?-3800:3800,200+(i%8)*200,i==0,true);stress.Draw(1.0/120);
            Require(stress.Points.Count<=CursorEffects.MaxTrailPoints&&stress.Particles.Count<=192&&stress.Rings.Count<=16&&stress.Commands.Count<=2048,"High-speed path exceeds renderer/memory limits");
        }
        for(int i=0;i<20;i++)stress.Draw(.1);Require(stress.Alive==0,"High-speed effects fail to expire");
    }
    CursorEffects SpreadSample(double spread,bool vertical=false){
        uint seed=2468;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,640)};
        fx.Configure(true,false,1,1,2,1,60);fx.SetTrailSpread(spread);
        fx.Input(vertical?200:40,vertical?40:200,true,true);fx.Input(vertical?200:600,vertical?600:200,false,true);return fx;
    }
    void TestTrailSpread(){
        var narrow=SpreadSample(0);var normal=SpreadSample(1);var wide=SpreadSample(2);var vertical=SpreadSample(1,true);
        Require(normal.Particles.Count==narrow.Particles.Count&&normal.Particles.Count==wide.Particles.Count,"Spread changes particle density");
        Require(narrow.Particles.All(p=>p.Y==200&&p.Vy==0),"Zero spread leaves the path");
        Require(normal.Particles.Count(p=>p.Y<200)>=3&&normal.Particles.Count(p=>p.Y>200)>=3,"Fragments do not occupy both sides of the path");
        Require(normal.Particles.Average(p=>Math.Abs(p.Y-200))>12,"Default fragments still hug the path");
        for(int i=0;i<normal.Particles.Count;i++){
            var a=normal.Particles[i];var b=wide.Particles[i];var v=vertical.Particles[i];
            Require(Math.Abs((b.Y-200)-2*(a.Y-200))<.00001&&Math.Abs(b.Vy-2*a.Vy)<.00001,"Spread does not scale distance independently");
            Require(a.X==b.X&&a.Life==b.Life&&a.Size==b.Size,"Spread changes speed lifetime, density or size");
            Require(Math.Abs(v.X-200+a.Y-200)<.00001&&Math.Abs(v.Y-a.X)<.00001,"Scatter is not perpendicular to a vertical path");
            Require((a.Y-200)*a.Vy>0,"Fragments drift back toward the path");
        }
        var clickA=SpreadSample(0);var clickB=SpreadSample(3);clickA.Clear();clickB.Clear();clickA.Click=clickB.Click=true;clickA.Input(200,200,true,true);clickB.Input(200,200,true,true);
        Require(clickA.Particles.SelectMany(p=>new[]{p.X,p.Y,p.Vx,p.Vy,p.Life,p.Size}).SequenceEqual(clickB.Particles.SelectMany(p=>new[]{p.X,p.Y,p.Vx,p.Vy,p.Life,p.Size})),"Trail spread changes click bursts");
        renderer.Appearance(Color.FromArgb(239,131,173),Color.FromArgb(219,90,145),Color.FromArgb(255,225,236));
        using(var sheet=new Bitmap(640,540))using(var g=Graphics.FromImage(sheet))using(var title=new Font("Microsoft JhengHei UI",13)){
            g.Clear(Color.FromArgb(16,19,23));
            for(int row=0;row<3;row++){
                var fx=SpreadSample(row);fx.Viewport=new Rectangle(0,0,640,400);fx.Draw(.08);
                string path=Path.Combine(profile,"trail-spread-"+row+".png");SaveBackground(renderer.Capture(fx,640,400),Color.FromArgb(16,19,23),path);
                g.DrawString("拖曳分散 "+(row*100)+"%"+(row==1?"（預設）":""),title,Brushes.White,20,row*180+10);
                using(var rendered=new Bitmap(path))g.DrawImage(rendered,new Rectangle(0,row*180+36,640,140),new Rectangle(0,130,640,140),GraphicsUnit.Pixel);
            }
            sheet.Save(Path.Combine(profile,"trail-spread-comparison.png"));
        }
    }
    void TestTrailDefaultsAndFade(){
        var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};
        fx.Configure(true,true,1,1,1,1,60);fx.Customize(1,1,1,1,1,1);
        Require(Math.Abs(fx.TrailWidth-.8)<.000001,"100 percent width must equal previous 80 percent");
        fx.Input(100,100,true,true);Require(fx.Particles.Count==6,"Default click density must be halved");
        for(int i=1;i<=10;i++)fx.Input(100+i*10,100,false,true);
        Require(fx.Particles.Count(p=>!p.Burst)==5,"Slow drag rounds half-density back up at every sample");
        fx.Clear();fx.Configure(true,false,1,1,0,1,60);fx.Input(50,200,true,true);fx.Input(550,200,false,true);fx.Draw(0);
        double initial=fx.Commands.Single(c=>c.Kind==0).Alpha;fx.Draw(.09);
        Require(Math.Abs(fx.Commands.Single(c=>c.Kind==0).Alpha/initial-.5)<.00001,"Default fade is not 180ms");
        fx.Draw(.091);Require(fx.Points.Count==0,"Default trail outlives 180ms");
        fx.Clear();fx.SetTrailLifetime(.4);fx.Input(50,200,true,true);fx.Input(550,200,false,true);fx.Draw(.1);
        initial=fx.Commands.Single(c=>c.Kind==0).Alpha;fx.SetTrailLifetime(.8);fx.Draw(0);
        Require(Math.Abs(fx.Commands.Single(c=>c.Kind==0).Alpha-initial)<.00001,"Live fade change flashes existing trail");
        for(int i=0;i<5;i++)fx.Draw(.1);Require(fx.Points.Count>0,"Configured fade expires too soon");fx.Draw(.1);fx.Draw(.001);Require(fx.Points.Count==0,"Configured fade never expires");
        fx.Clear();fx.SetTrailLifetime(1);fx.Input(50,200,true,true);
        for(int i=1;i<=200;i++){fx.Draw(.008);fx.Input(50+i*2,200,false,true);}
        Require(fx.Points.Count>=124&&fx.Points.Count<=CursorEffects.MaxTrailPoints&&fx.Points[0].Age>.98,"Point budget truncates 1s fade at 125Hz");
        fx.SetTrailLifetime(.04);for(int i=0;i<5;i++)fx.Draw(.01);Require(fx.Points.Count==0,"Minimum fade does not expire");
    }
    void TestTrailJoints(){
        renderer.Appearance(Color.FromArgb(248,135,178),Color.FromArgb(248,135,178),Color.White);
        foreach(int kind in new[]{0,3}){
            var fx=new CursorEffects();var command=kind==0?new DrawCommand(0,100,200,500,200,2.4,0,.4):new DrawCommand(3,100,200,400,0,.8,0,.4);
            fx.Commands.Add(command);var once=renderer.Capture(fx,640,400);fx.Commands.Add(command);var twice=renderer.Capture(fx,640,400);
            Require(once.SequenceEqual(twice),"Overlapping trail coverage accumulates for kind "+kind);
            fx.Commands.Clear();fx.Commands.Add(kind==0?new DrawCommand(0,100,200,300,200,2.4,0,.4):new DrawCommand(3,100,200,200,0,.8,0,.4));fx.Commands.Add(kind==0?new DrawCommand(0,300,200,500,200,2.4,0,.4):new DrawCommand(3,300,200,200,0,.8,0,.4));
            var split=renderer.Capture(fx,640,400);
            for(int y=170;y<230;y++)for(int x=292;x<308;x++)Require(split[(y*640+x)*4+3]<=once[(y*640+x)*4+3]+3,"Bright sample node remains at "+x+","+y+" kind "+kind);
            if(kind==0)for(int x=100;x<500;x++)Require(split[(200*640+x)*4+3]>80,"Segment join has a gap");
        }
        // Ring blending remains independent, even though trail overlap is capped.
        var ring=new CursorEffects();var r=new DrawCommand(1,200,200,40,0,3,0,.4);ring.Commands.Add(r);double a=Alpha(renderer.Capture(ring,640,400));ring.Commands.Add(r);Require(Alpha(renderer.Capture(ring,640,400))>a,"Trail blend leaked into click rings");
        var curves=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};curves.Configure(true,false,1,1,0,1,60);
        curves.Input(40,100,true,true);for(int i=1;i<=36;i++)curves.Input(40+i*15,100+30*Math.Sin(i*.25),false,true);curves.Input(580,100,false,false);
        for(int i=0;i<=32;i++){double angle=i*Math.PI/16;curves.Input(160+28*Math.Cos(angle),260+28*Math.Sin(angle),i==0,true);}curves.Input(188,260,false,false);
        foreach(var p in new[]{new Point(320,300),new Point(430,220),new Point(390,300),new Point(500,240)})curves.Input(p.X,p.Y,p.X==320,true);
        curves.Draw(.02);SaveBackground(renderer.Capture(curves,640,400),Color.FromArgb(16,19,23),Path.Combine(profile,"trail-joints.png"));
    }
    async void RunTest(){
        string report=Path.Combine(profile,"test.json");var checks=new List<string>();var shell=Native.ShellInputHandles().ToDictionary(h=>h,h=>Native.IsWindowEnabled(h));
        try{
            await Task.Delay(150);Require(ready&&!failed,"Native renderer failed");Require(renderer.Hardware,"Hardware rendering unavailable on test computer");Require(Marshal.SizeOf(typeof(DrawCommand))==32,"Interop command layout");
            Require(cursorFps==60&&effects.Fps==60,"Fixed 60 FPS");Require(overlay.Bounds==SystemInformation.VirtualScreen,"All-screen bounds");ResetControls();
            for(int page=0;page<3;page++){controls.SelectPage(page);controls.PerformLayout();}
            foreach(var n in controls.Numbers){Require(n.Controls.Count==0,"Spin controls");n.Text="73";n.Commit();Require(n.Value==73,"Typed value");n.Text=(n.Maximum+100).ToString();n.Commit();Require(n.Value==n.Maximum,"Clamp value");}
            var sliders=new List<PositionSlider>();Action<Control> collect=null;collect=c=>{foreach(Control child in c.Controls){if(child is PositionSlider)sliders.Add((PositionSlider)child);collect(child);}};collect(controls);Require(sliders.Count==11,"Eleven independent sliders");
            foreach(var s in sliders){var type=typeof(PositionSlider);var down=type.GetMethod("OnMouseDown",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);var up=type.GetMethod("OnMouseUp",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);down.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width/2,16,0)});Require(Math.Abs(s.Value-(s.Minimum+s.Maximum)/2)<=Math.Ceiling((double)(s.Maximum-s.Minimum)/Math.Max(1,s.Width-18)),"Direct slider jump");up.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width+50,16,0)});Require(s.Value==s.Maximum&&!s.Capture,"Fast upper endpoint");down.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width/2,16,0)});up.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,-50,16,0)});Require(s.Value==s.Minimum&&!s.Capture,"Fast lower endpoint");}
            ResetControls();Require(controls.Numbers.Select(n=>n.Parent.Size).Distinct().Count()==1,"Numeric frames differ, including opacity");foreach(var n in controls.Numbers)Require(n.Parent.ClientSize.Height-n.Parent.Padding.Vertical>=n.Font.Height,"Numeric input text clipped: "+n.AccessibleName);var panelSize=controls.ClientSize;for(int page=0;page<3;page++){controls.SelectPage(page);Require(controls.ClientSize==panelSize,"Tab changes panel size");}checks.Add("three fixed pages, eleven direct sliders/plain inputs, identical numeric frames including opacity, fixed 60 FPS / all screens");
            var buttons=new List<Button>();Action<Control> gatherButtons=null;gatherButtons=c=>{foreach(Control child in c.Controls){if(child is Button)buttons.Add((Button)child);gatherButtons(child);}};gatherButtons(controls);Require(buttons.All(b=>!b.Text.Contains("更多外觀")),"Collapsible settings remain");var reset=buttons.Single(b=>b.Text=="重設");var hide=buttons.Single(b=>b.Text=="收起面板");Require(reset.Parent==hide.Parent&&reset.Left<hide.Left,"Footer button order");hide.PerformClick();Require(!controls.Visible&&overlay.Visible,"Hide button changes effects");controls.ShowPanel();controls.SelectPage(0);
            Require(trayMenu.Items.Count==4,"Tray structure");visibilityItem.PerformClick();Require(!overlay.Visible&&!controls.VisibleValue.Checked&&visibilityItem.Text=="開啟效果"&&!inputTimer.Enabled&&!animating,"OFF toggle");ResetControls();Require(!controls.VisibleValue.Checked&&!overlay.Visible,"Reset changed master switch");visibilityItem.PerformClick();Configure();Require(overlay.Visible&&visibilityItem.Text=="關閉效果"&&(Native.GetWindowLongPtr(overlay.Handle,-20).ToInt64()&8)!=0,"ON didn't show topmost");checks.Add("single ON/OFF, synchronized tray, reset preserves master state, always topmost");
            AssertSafe();var foreground=Native.GetForegroundWindow();overlay.Display(false,true);overlay.Display(true,true);await Task.Delay(100);AssertSafe();Require(Native.GetForegroundWindow()==foreground,"Show steals focus");checks.Add("taskbar/screen click through, no focus/capture or shell modification");
            inputTimer.Stop();
            using(var competitor=new Overlay(this)){Native.DecorationPriority(competitor.Handle,0);competitor.Bounds=new Rectangle(Screen.PrimaryScreen.WorkingArea.Location,new Size(100,60));competitor.Display(true,true);await Task.Delay(300);Require(Native.WindowAboveDecoration(overlay.Handle,100)!=competitor.Handle,"Topmost repair");int stable=layerRepairs;for(int i=0;i<100;i++)RepairLayer(Native.GetDesktopWindow());Require(layerRepairs-stable<=1,"Layer retry loop");}
            checks.Add("event-driven topmost repair with bounded retries");
            StopAnimation(true);long before=Frames;await Task.Delay(1100);Require(Frames==before&&!animating&&renderer.Surface.Size==new Size(1,1),"Idle drawing continues");
            var origin=effects.Viewport.Location;Pointer(origin.X+150,origin.Y+100,false,false);Require(effects.Alive==0&&!animating,"Hover emits effects");Pointer(origin.X+150,origin.Y+100,true,true);await Task.Delay(80);Require(Frames>before,"Click doesn't wake");Pointer(origin.X+180,origin.Y+110,false,true);Pointer(origin.X+180,origin.Y+110,false,false);await Task.Delay(900);Require(effects.Alive==0&&!animating&&renderer.Surface.Size==new Size(1,1),"Effects don't sleep");checks.Add("hover silent, click/held trail wake, expiration returns to 1px and stops timer");
            Pointer(origin.X+100,origin.Y+100,true,true);await Task.Delay(900);Require(effects.Alive==0&&!animating,"Stationary hold does not sleep");Pointer(origin.X+650,origin.Y+100,false,true);effects.Draw(0);Require(effects.Commands.Any(c=>c.Kind==0&&c.X==100&&c.X2==650),"Drag after a stationary hold lost its anchor");StopAnimation(true);checks.Add("stationary held cursor sleeps and resumes with a connected trail");
            Pointer(origin.X+150,origin.Y+100,true,true);lastFrame=clock.Elapsed.TotalMilliseconds-1000;Frame();Require(!animating&&effects.Alive==0,"Suspend/stall replays old effects");RecoverDevice();Require(!failed&&renderer.Hardware,"Device rebuild failed");checks.Add("stalled frames clear effects, graphics device recreation succeeds");
            before=Frames;Pointer(origin.X+150,origin.Y+100,true,true);await Task.Delay(150);Require(Frames-before>=7&&Frames-before<=12,"60 FPS scheduler");StopAnimation(true);ResetControls();inputTimer.Stop();checks.Add("fixed 60 FPS scheduler");
            var test=new CursorEffects(()=>.5){Viewport=new Rectangle(-1920,-100,3840,1080)};test.Input(-1820,0,true,true);Require(test.Points.Single().X==100&&test.Points.Single().Y==100,"Negative monitor origin");test.Input(-1800,20,true,true,true);Require(test.Points.Count==1,"Blocked input emits");test.Clear();test.Configure(true,true,1,1,3,1,60);test.Input(-1820,0,true,true);Require(test.Particles.Count==18,"Density multiplier");test.Configure(true,true,2,1,3,1,60);Require(test.Particles[0].Size==10,"Size multiplier");for(int i=0;i<1000;i++)test.Input(-1820+(i*4)%1500,100,true,true);Require(test.Points.Count==CursorEffects.MaxTrailPoints&&test.Particles.Count==192&&test.Rings.Count==16,"Unbounded particles");for(int i=0;i<20;i++)test.Draw(.1);Require(test.Alive==0,"Expiration");checks.Add("negative origin, blocked controls, multipliers, bounded memory, finite lifetimes");
            TestHighSpeedTrails();checks.Add("600px real GPU line without gaps, 3720px multi-monitor stroke with distributed fragments, release/blocked boundaries, 1000 rapid 7600px samples within fixed budgets");
            TestTrailDefaultsAndFade();checks.Add("halved click and slow/fast drag density, 80 percent baseline width, 40-1000ms fade, continuous live edits, 1s trail at 125Hz");TestTrailJoints();checks.Add("GPU trail overlap invariant, no sample-node brightening or gaps, tight loops and acute turns, independent ring blend");TestTrailSpread();checks.Add("perpendicular two-sided scatter, independent range/count/click effects, 0/100/200 percent GPU previews");
            var visual=new List<object>();double prev=0;
            renderer.Appearance(Color.FromArgb(69,237,255),Color.FromArgb(69,237,255),Color.FromArgb(196,252,255));
            foreach(int glow in new[]{0,1,3}){
                var fx=Sample(glow);byte[] pixels=renderer.Capture(fx,640,400);double alpha=Alpha(pixels);Require(glow==0||alpha>prev,"Glow isn't monotonic");prev=alpha;D2DRenderer.Save(pixels,640,400,Path.Combine(profile,"native-glow-"+glow+".png"));visual.Add(new{glow,alpha});
            }
            var invisible=Sample(3);invisible.Opacity=0;invisible.Draw(0);Require(Alpha(renderer.Capture(invisible,640,400))==0,"Opacity zero not transparent");checks.Add("real Direct2D captures, glow monotonic, opacity zero transparent");
            var custom=Sample(0);var beforeTrail=custom.Commands.First(c=>c.Kind==0);var beforeRing=custom.Commands.First(c=>c.Kind==1);var beforeBurst=custom.Particles.First(p=>p.Burst).Size;var beforeFragment=custom.Particles.First(p=>!p.Burst).Size;
            custom.Customize(2,3,1.5,2.5,.4,.7);custom.Draw(0);var afterTrail=custom.Commands.First(c=>c.Kind==0);var afterRing=custom.Commands.First(c=>c.Kind==1);
            Require(Math.Abs(afterTrail.Width/beforeTrail.Width-2)<.001&&Math.Abs(afterTrail.Alpha/beforeTrail.Alpha-.4)<.001,"Trail width/opacity not independent");Require(Math.Abs(afterRing.X2/beforeRing.X2-3)<.001&&Math.Abs(afterRing.Alpha/beforeRing.Alpha-.7)<.001,"Ripple size/opacity not independent");Require(Math.Abs(custom.Particles.First(p=>p.Burst).Size/beforeBurst-2.5)<.001&&Math.Abs(custom.Particles.First(p=>!p.Burst).Size/beforeFragment-1.5)<.001,"Fragment sizes not independent");
            var clearTrail=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};clearTrail.Customize(1,1,1,1,0,1);clearTrail.Input(100,100,true,true);clearTrail.Input(150,100,false,true);Require(clearTrail.Points.Count==0&&clearTrail.Particles.All(p=>p.Burst)&&clearTrail.Rings.Count==1,"Transparent trail still emits");
            renderer.Appearance(Color.Red,Color.Red,Color.Red);var red=renderer.Capture(Sample(1),640,400);long redSum=0,otherSum=0;for(int i=0;i<red.Length;i+=4){redSum+=red[i+2];otherSum+=red[i]+red[i+1];}Require(redSum>10000&&otherSum==0,"Native geometry/glow recoloring failed");
            var stationary=Sample(0);var particle=stationary.Particles.First();double initialX=particle.X,initialY=particle.Y,initialAngle=particle.Angle,initialAge=particle.Age;stationary.SetParticleSpeed(0);stationary.Draw(.1);Require(particle.X==initialX&&particle.Y==initialY&&particle.Angle==initialAngle&&particle.Age>initialAge,"Zero speed should freeze motion, not lifetime");stationary.SetParticleSpeed(2);stationary.Draw(.1);Require(Math.Abs(particle.X-initialX-particle.Vx*.2)<.001&&Math.Abs(particle.Y-initialY-particle.Vy*.2)<.001&&Math.Abs(particle.Angle-initialAngle-particle.Spin*.2)<.001,"Live speed multiplier doesn't apply");stationary.SetParticleSpeed(0);for(int i=0;i<10;i++)stationary.Draw(.1);Require(stationary.Alive==0,"Zero-speed particles never expire");
            var speeds=new[]{.5,1,2,3};var endpoints=new List<double[]>();var lifetimes=new List<double>();
            foreach(double speed in speeds){var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};fx.SetParticleSpeed(speed);fx.Input(200,200,true,true);fx.Input(230,220,false,true);var references=fx.Particles.ToArray();int steps=0;while(fx.Particles.Count>0&&steps<150){fx.Draw(.01);steps++;}Require(fx.Particles.Count==0,"Speed-scaled particles fail to expire");lifetimes.Add(steps*.01);endpoints.Add(references.SelectMany(p=>new[]{p.X,p.Y,p.Angle}).ToArray());}
            foreach(var end in endpoints)for(int i=0;i<end.Length;i++)Require(Math.Abs(end[i]-endpoints[0][i])<.00001,"Speed changes final scatter range or rotation");for(int i=0;i<speeds.Length;i++)Require(Math.Abs(lifetimes[i]*speeds[i]-lifetimes[1])<.035,"Speed does not scale fade duration");
            var slow=Sample(0);var fast=Sample(0);slow.SetParticleSpeed(.5);fast.SetParticleSpeed(3);slow.Draw(.06);fast.Draw(.01);for(int i=0;i<slow.Particles.Count;i++)Require(Math.Abs(slow.Particles[i].X-fast.Particles[i].X)<.00001&&Math.Abs(slow.Particles[i].Age/slow.Particles[i].Life-fast.Particles[i].Age/fast.Particles[i].Life)<.00001,"Same progress changes path/fade");
            var variable=Sample(0);var variableReferences=variable.Particles.ToArray();for(int i=0;i<100&&variable.Particles.Count>0;i++){variable.SetParticleSpeed(i%2==0?.5:3);variable.Draw(.01);}var constantFx=Sample(0);var constantReferences=constantFx.Particles.ToArray();for(int i=0;i<100&&constantFx.Particles.Count>0;i++)constantFx.Draw(.01);for(int i=0;i<constantReferences.Length;i++)Require(Math.Abs(variableReferences[i].X-constantReferences[i].X)<.00001&&Math.Abs(variableReferences[i].Y-constantReferences[i].Y)<.00001,"Live speed changes range");checks.Add("50/100/200/300 percent speed preserves drag/click endpoints and fade progress, changes duration only, live edits preserve range");
            controls.Updating=true;controls.EffectSize.Value=143;controls.ParticleSpeed.Value=185;controls.OpacityValue.Value=72;controls.Updating=false;Configure();var kept=controls.Numbers.Select(n=>n.Value).ToArray();bool keptMaster=controls.VisibleValue.Checked;
            using(var preview=new Bitmap(1280,1296))using(var g=Graphics.FromImage(preview))using(var title=new Font("Microsoft JhengHei UI",14)){
                g.Clear(Color.FromArgb(16,19,23));
                for(int i=0;i<ColorPalette.All.Length;i++){controls.Palette.SelectedIndex=i+1;var p=ColorPalette.All[i];Require(controls.TrailColor.Value==p.Trail&&controls.RippleColor.Value==p.Ripple&&controls.FragmentColor.Value==p.Fragment,"Palette doesn't apply all colors");Require(controls.Numbers.Select(n=>n.Value).SequenceEqual(kept)&&controls.VisibleValue.Checked==keptMaster,"Palette changed effect parameters or master state");renderer.Appearance(p.Trail,p.Ripple,p.Fragment);var pixels=renderer.Capture(Sample(1),640,400);string path=Path.Combine(profile,"palette-"+i+".png");SaveBackground(pixels,Color.FromArgb(16,19,23),path);int x=(i%2)*640,y=(i/2)*432;g.DrawString(p.Name,title,Brushes.White,x+24,y+7);using(var rendered=new Bitmap(path))g.DrawImageUnscaled(rendered,x,y+32);}
                preview.Save(Path.Combine(profile,"palettes.png"));
            }
            controls.FragmentColor.Value=Color.Red;Require(controls.Palette.SelectedIndex==0,"Manual colors not marked custom");SaveControls(true);ResetControls();RestoreControls(true);Require(controls.Palette.SelectedIndex==0&&controls.FragmentColor.Value.ToArgb()==Color.Red.ToArgb(),"Custom palette didn't persist");ApplyPalette(ColorPalette.All[2]);SaveControls(true);ResetControls();RestoreControls(true);Require(controls.Palette.SelectedIndex==3,"Named palette didn't restore");ResetControls();checks.Add("six palette previews, switching changes colors only, custom/named palette recognition and persistence");
            renderer.Appearance(Color.FromArgb(69,237,255),Color.FromArgb(69,237,255),Color.FromArgb(196,252,255));var plain=renderer.Capture(Sample(1),640,400);SaveBackground(plain,Color.White,Path.Combine(profile,"effects-white.png"));SaveBackground(plain,Color.FromArgb(16,19,23),Path.Combine(profile,"effects-dark.png"));checks.Add("independent sizes/opacity, cached GPU recoloring, live particle speed and zero-speed expiration, original appearance without outlines");
            // Validate actual composition, not just offscreen drawing. The
            // screenshot is restricted to our own temporary black test window.
            controls.HidePanel();StopAnimation(true);
            {
                var area=Screen.PrimaryScreen.WorkingArea;var rect=new Rectangle(area.Left+Math.Max(0,(area.Width-640)/2),area.Top+Math.Max(0,(area.Height-400)/2),640,400);
                // Overlay suppresses GDI painting; a normal owned form below
                // provides a known opaque background for this capture instead.
                using(var backing=new TestBackground()){
                    backing.Bounds=rect;backing.Show();backing.Bounds=rect;Native.SetWindowPos(backing.Handle,new IntPtr(-1),rect.X,rect.Y,rect.Width,rect.Height,0x10|0x40);overlay.Bounds=rect;overlay.Display(true,true);var fx=Sample(1);renderer.Draw(fx);await Task.Delay(250);
                    using(var shot=new Bitmap(640,400)){using(var g=Graphics.FromImage(shot))g.CopyFromScreen(rect.Location,Point.Empty,shot.Size);foreach(var p in new[]{new Point(5,5),new Point(634,5),new Point(5,394),new Point(634,394)})Require(shot.GetPixel(p.X,p.Y).ToArgb()==Color.Black.ToArgb(),"Own test background occluded; capture discarded");shot.Save(Path.Combine(profile,"composed.png"));int cyan=0;for(int x=202;x<335;x++)for(int y=145;y<255;y++){var c=shot.GetPixel(x,y);if(c.G>c.R+30&&c.B>c.R+30)cyan++;}Require(cyan>100,"DirectComposition pixels not visible");}
                    AssertSafe();
                }
            }
            overlay.Bounds=SystemInformation.VirtualScreen;effects.Viewport=overlay.Bounds;StopAnimation(true);checks.Add("DirectComposition pixels visible on desktop-owned test surface");
            controls.ShowPanel();controls.PerformLayout();using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls.png"));}
            controls.SelectPage(1);using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-click.png"));}controls.SelectPage(2);controls.PerformLayout();using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-fragments.png"));}controls.SelectPage(0);
            controls.VisibleValue.Checked=false;using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-off.png"));}controls.VisibleValue.Checked=true;Configure();
            controls.WindowState=FormWindowState.Minimized;Require(controls.Visible&&controls.WindowState==FormWindowState.Minimized&&controls.ShowInTaskbar&&overlay.Visible,"Normal minimize changes effects/taskbar");ShowControls();Require(controls.Visible&&controls.WindowState==FormWindowState.Normal,"Restore");controls.HidePanel();Require(!controls.Visible&&overlay.Visible,"Hide differs from minimize");
            controls.Updating=true;controls.EffectSize.Value=173;controls.ParticleStrength.Value=142;controls.ParticleSpeed.Value=225;controls.TrailSpread.Value=175;controls.TrailFade.Value=320;controls.OpacityValue.Value=68;controls.RippleSize.Value=230;controls.TrailFragmentSize.Value=51;controls.ClickFragmentSize.Value=182;controls.ClickOpacity.Value=29;controls.TrailColor.Value=Color.Red;controls.RippleColor.Value=Color.Blue;controls.FragmentColor.Value=Color.Green;controls.VisibleValue.Checked=false;controls.Updating=false;SaveControls(true);Require(!File.ReadAllText(ControlsPath).Contains("contrast"),"Removed outline persisted");controls.VisibleValue.Checked=true;ResetControls();Require(controls.ParticleSpeed.Value==100&&controls.TrailSpread.Value==100&&controls.TrailFade.Value==180,"Speed/spread/fade reset");RestoreControls(true);Require(controls.EffectSize.Value==173&&controls.ParticleStrength.Value==142&&controls.ParticleSpeed.Value==225&&controls.TrailSpread.Value==175&&controls.TrailFade.Value==320&&controls.OpacityValue.Value==68&&controls.RippleSize.Value==230&&controls.TrailFragmentSize.Value==51&&controls.ClickFragmentSize.Value==182&&controls.ClickOpacity.Value==29&&controls.TrailColor.Value.ToArgb()==Color.Red.ToArgb()&&controls.RippleColor.Value.ToArgb()==Color.Blue.ToArgb()&&controls.FragmentColor.Value.ToArgb()==Color.Green.ToArgb()&&!controls.VisibleValue.Checked,"Settings persistence");Configure();Require(!overlay.Visible,"Restored OFF ignored");
            File.WriteAllText(ControlsPath,"{\"version\":1,\"visible\":true,\"top\":false,\"monitor\":\"removed\",\"fps\":7,\"size\":125}");RestoreControls(true);Configure();Require(controls.VisibleValue.Checked&&overlay.Visible&&overlay.Bounds==SystemInformation.VirtualScreen&&effects.Fps==60&&(Native.GetWindowLongPtr(overlay.Handle,-20).ToInt64()&8)!=0,"Legacy settings override fixed behavior");checks.Add("actual settings save/restore, legacy visibility migration ignores removed options");
            Require(controls.TrailSpread.Value==100&&controls.TrailFade.Value==180&&controls.RippleSize.Value==125&&controls.TrailFragmentSize.Value==125&&controls.ClickFragmentSize.Value==125,"Legacy global size migration");foreach(var entry in shell)Require(!entry.Value||!Native.IsWindow(entry.Key)||Native.IsWindowEnabled(entry.Key),"Shell disabled");checks.Add("normal taskbar minimize, explicit hide keeps effects, restore works, X exits");
            var result=new{passed=true,hardware=renderer.Hardware,checks,visual,frames=Frames,layerRepairs};controls.Close();Require(quitting&&controls.IsDisposed,"X didn't exit");File.WriteAllText(report,Json.Serialize(result));
        }catch(Exception e){File.WriteAllText(report,Json.Serialize(new{passed=false,error=e.ToString(),checks,trace=layerTrace.ToArray()}));Quit(1);}
    }
    static void SaveBackground(byte[] pixels,Color background,string path){var result=(byte[])pixels.Clone();for(int i=0;i<result.Length;i+=4){int a=pixels[i+3];result[i]=(byte)Math.Min(255,pixels[i]+background.B*(255-a)/255);result[i+1]=(byte)Math.Min(255,pixels[i+1]+background.G*(255-a)/255);result[i+2]=(byte)Math.Min(255,pixels[i+2]+background.R*(255-a)/255);result[i+3]=255;}D2DRenderer.Save(result,640,400,path);}
}
sealed class TestBackground : Form {
    public TestBackground(){FormBorderStyle=FormBorderStyle.None;AutoScaleMode=AutoScaleMode.None;ShowInTaskbar=false;BackColor=Color.Black;Enabled=false;TopMost=true;}
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80|0x20;return p;}}
}
