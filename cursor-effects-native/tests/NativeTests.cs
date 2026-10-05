using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;

sealed partial class CursorHost {
    object whiteProfileSummary;
    void Require(bool value,string error){if(!value)throw new Exception(error);}
    async Task TestPaletteMenu(){
        var field=controls.Palette;var values=controls.Numbers.Select(n=>n.Value).ToArray();bool enabled=controls.VisibleValue.Checked;
        var key=typeof(PaletteField).GetMethod("OnKeyDown",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);
        field.SelectedIndex=1;field.Focus();key.Invoke(field,new object[]{new KeyEventArgs(Keys.Down)});Require(field.SelectedIndex==2&&controls.TrailColor.Value==ColorPalette.All[1].Trail,"Keyboard palette selection failed");
        key.Invoke(field,new object[]{new KeyEventArgs(Keys.End)});Require(field.SelectedIndex==ColorPalette.All.Length,"Palette End key failed");key.Invoke(field,new object[]{new KeyEventArgs(Keys.Home)});Require(field.SelectedIndex==0,"Palette Home key failed");field.SelectedIndex=1;
        using(var closed=new Bitmap(field.Width,field.Height)){field.DrawToBitmap(closed,new Rectangle(Point.Empty,closed.Size));int white=0;for(int x=closed.Width-24;x<closed.Width-2;x++)for(int y=2;y<closed.Height-2;y++){var c=closed.GetPixel(x,y);if(c.R>240&&c.G>240&&c.B>240)white++;}Require(white==0,"Palette arrow contains a native white button");}
        key.Invoke(field,new object[]{new KeyEventArgs(Keys.Alt|Keys.Down)});await Task.Delay(80);Require(field.DropDown.Visible,"Keyboard cannot open palette menu");File.WriteAllText(Path.Combine(profile,"palette-menu-layout.json"),Json.Serialize(new{field.DropDown.Size,field.DropDown.DisplayRectangle,field.DropDown.Padding,items=field.DropDown.Items.Cast<ToolStripItem>().Select(item=>new{item.Text,item.Bounds}).ToArray()}));
        using(var shot=new Bitmap(controls.Width,controls.Height)){using(var g=Graphics.FromImage(shot))g.CopyFromScreen(controls.Location,Point.Empty,shot.Size);shot.Save(Path.Combine(profile,"ui-palette-open.png"));}
        Require(field.DropDown.Items.Cast<ToolStripItem>().All(item=>item.Bounds.Top>=field.DropDown.DisplayRectangle.Top&&item.Bounds.Bottom<=field.DropDown.DisplayRectangle.Bottom),"Palette menu clips or scrolls the available templates");
        field.DropDown.Items[3].PerformClick();Require(field.SelectedIndex==3&&!field.DropDown.Visible&&controls.TrailColor.Value==ColorPalette.All[2].Trail,"Menu selection did not apply and close");
        Require(controls.Numbers.Select(n=>n.Value).SequenceEqual(values)&&controls.VisibleValue.Checked==enabled,"Palette menu changed effect settings");
        field.OpenMenu();Require(field.DropDown.Visible,"Palette menu cannot reopen");key.Invoke(field,new object[]{new KeyEventArgs(Keys.Escape)});Require(!field.DropDown.Visible,"Escape did not close palette menu");
        ResetControls();for(int page=0;page<3;page++){controls.SelectPage(page);controls.PerformLayout();await Task.Delay(60);using(var shot=new Bitmap(controls.Width,controls.Height)){using(var g=Graphics.FromImage(shot))g.CopyFromScreen(controls.Location,Point.Empty,shot.Size);shot.Save(Path.Combine(profile,"ui-page-"+page+".png"));}}controls.SelectPage(0);
    }
    void AssertSafe(){
        Require(!controls.MaximizeBox&&(Native.GetWindowLongPtr(controls.Handle,-16).ToInt64()&0x40000L)==0,"Controls are resizable");
        Require(!Native.IsWindowEnabled(overlay.Handle),"Overlay enabled");Require(Native.GetCapture()!=overlay.Handle,"Overlay captured input");Require(Native.GetForegroundWindow()!=overlay.Handle,"Overlay took focus");
        Require((Native.GetWindowLongPtr(overlay.Handle,-20).ToInt64()&(0x20|0x08000000|0x00200000))==(0x20|0x08000000|0x00200000),"Input/composition styles missing");
        foreach(var bar in Native.Taskbars()){var p=new Point(bar.Left+bar.Width/2,bar.Top+bar.Height/2);Require(!Native.BelongsTo(Native.WindowFromPoint(p),overlay.Handle),"Taskbar blocked");}
        foreach(var screen in Screen.AllScreens)for(int x=1;x<5;x++)for(int y=1;y<5;y++){var b=screen.WorkingArea;Require(!Native.BelongsTo(Native.WindowFromPoint(new Point(b.Left+b.Width*x/5,b.Top+b.Height*y/5)),overlay.Handle),"Screen input blocked");}
    }
    static double Alpha(byte[] pixels){double sum=0;for(int i=3;i<pixels.Length;i+=4)sum+=pixels[i];return sum;}
    CursorEffects Sample(){uint seed=1234;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,400)};fx.Configure(true,true,1,1,1,60);fx.Input(200,200,true,true);for(int i=1;i<=12;i++)fx.Input(200+i*12,200+Math.Sin(i*.4)*50,false,true);fx.Draw(.08);return fx;}
    void TestHighSpeedTrails(){
        var line=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};
        line.Configure(true,false,1,0,1,60);line.Input(20,200,true,true);line.Input(620,200,false,true);line.Draw(.01);
        var pixels=renderer.Capture(line,640,400);
        for(int x=32;x<608;x++)Require(pixels[(200*640+x)*4+3]>0,"High-speed line has a transparent gap at "+x);
        D2DRenderer.Save(pixels,640,400,Path.Combine(profile,"high-speed-trail.png"));

        var path=new CursorEffects(()=>.5){Viewport=new Rectangle(-1920,-100,3840,1080)};
        path.Configure(true,true,1,1,1,60);path.SetTrailSpread(0);path.Input(-1880,100,true,true);path.Input(1840,100,false,true);path.Draw(0);
        Require(path.Commands.Any(c=>c.Kind==0&&c.X==40&&c.X2==3760),"Monitor-wide drag was discarded");
        Require(path.Commands.All(c=>c.Kind==0||c.Kind==2||c.Kind==6),"Disabled soft effects still produce commands");
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
        stress.Configure(true,true,3,3,1,60);stress.Customize(3,3,3,3,1,1);stress.SetTrailSpread(3);
        for(int i=0;i<1000;i++){
            stress.Input(i%2==0?-3800:3800,200+(i%8)*200,i==0,true);stress.Draw(1.0/120);
            Require(stress.Points.Count<=CursorEffects.MaxTrailPoints&&stress.Particles.Count<=192&&stress.Rings.Count<=16&&stress.Commands.Count<=2048,"High-speed path exceeds renderer/memory limits");
        }
        for(int i=0;i<20;i++)stress.Draw(.1);Require(stress.Alive==0,"High-speed effects fail to expire");
    }
    CursorEffects SpreadSample(double spread,bool vertical=false){
        uint seed=2468;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,640)};
        fx.Configure(true,false,1,2,1,60);fx.SetTrailEmission(80,.35);fx.SetTrailSpread(spread);
        fx.Input(vertical?200:40,vertical?40:200,true,true);fx.Input(vertical?200:600,vertical?600:200,false,true);return fx;
    }
    CursorEffects DistanceSample(int samples){
        uint seed=7654;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,1400,400)};fx.Configure(true,false,1,1,1,60);
        fx.Input(100,200,true,true);for(int i=1;i<=samples;i++)fx.Input(100+1000.0*i/samples,200,false,true);return fx;
    }
    void TestParticleRules(){
        var coarse=DistanceSample(10);var fine=DistanceSample(100);var dense=DistanceSample(500);
        foreach(var fx in new[]{fine,dense}){
            Require(fx.Particles.Count==coarse.Particles.Count,"Input frequency changes distance emission count");
            for(int i=0;i<fx.Particles.Count;i++)Require(Math.Abs(fx.Particles[i].X-coarse.Particles[i].X)<.00001&&Math.Abs(fx.Particles[i].Y-coarse.Particles[i].Y)<.00001,"Subdivided stroke changes particle birth positions");
        }
        double last=100;foreach(var p in coarse.Particles){Require(p.X-last>=65-.0001&&p.X-last<=135+.0001,"Spacing jitter exceeds +/-35 percent");last=p.X;}
        int born=coarse.Particles.Count;for(int i=0;i<1000;i++)coarse.Input(1100,200,false,true);Require(coarse.Particles.Count==born,"Stationary hold generates fragments");
        coarse.SetTrailEmission(0,.35);coarse.Input(1300,200,false,true);Require(coarse.Particles.Count==born,"Zero spacing does not disable drag fragments");
        var partial=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};partial.Configure(true,false,1,1,1,60);partial.Input(100,200,true,true);partial.Input(140,200,false,true);for(int i=0;i<20;i++)partial.Draw(.1);partial.Clear(false);partial.Input(200,200,false,true);Require(partial.Particles.Count==1,"Stationary sleep loses accumulated emission distance");
        var click=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};click.Configure(false,true,1,1,1,60);click.Input(200,200,true,true);
        Require(click.Particles.Count==4,"Default click is not four fragments");
        foreach(var p in click.Particles){double dx=p.X-200,dy=p.Y-200;Require(Math.Sqrt(dx*dx+dy*dy)>=30&&Math.Sqrt(dx*dx+dy*dy)<=40.5,"Click fragment born at center instead of peripheral annulus");Require(Math.Sqrt(p.Vx*p.Vx+p.Vy*p.Vy)>=16.5&&Math.Sqrt(p.Vx*p.Vx+p.Vy*p.Vy)<35.25,"Click drift exceeds the intended local range");}
        Require(coarse.Particles.Concat(click.Particles).All(p=>(p.Angle==0||p.Angle==Math.PI)&&p.Spin==0),"Fragments tilt/spin instead of up/down triangles");
        var independent=Sample();var burst=independent.Particles.First(p=>p.Burst);var drag=independent.Particles.First(p=>!p.Burst);independent.SetParticleSpeed(3);independent.SetClickSpeed(.5);double ba=burst.Age,da=drag.Age;independent.Draw(.02);Require(Math.Abs(burst.Age-ba-.01)<.00001&&Math.Abs(drag.Age-da-.06)<.00001,"Click/drag speeds are not independent");
        foreach(var p in click.Particles){p.WhiteHold=.12;p.WhiteFade=.16;}
        renderer.Appearance(Color.Red,Color.Red,Color.Red);click.Draw(.08);var birth=click.Commands.First(c=>c.Kind==2);var only=new CursorEffects();only.Commands.Add(birth);var fresh=renderer.Capture(only,640,400);int at=((int)birth.Y*640+(int)birth.X)*4;
        Require(fresh[at+1]>150&&birth.X2>.85&&birth.Y2>=.65&&birth.Y2<=1,"Fresh fragment lacks real white core");
        click.Draw(.05);Require(click.Commands.First(c=>c.Kind==2).X2>0&&click.Commands.First(c=>c.Kind==2).X2<birth.X2,"White transition does not decay after initial hold");click.Draw(.08);var colored=click.Commands.First(c=>c.Kind==2);only.Commands.Clear();only.Commands.Add(colored);var tinted=renderer.Capture(only,640,400);at=((int)colored.Y*640+(int)colored.X)*4;
        Require(colored.X2==0&&tinted[at+1]==0&&tinted[at+2]>80,"Fragment does not transition to selected tint within the reference time window");
        click.Clear();click.Input(200,200,true,true);click.Draw(0);Require(click.Commands.All(c=>c.Kind==2||c.Kind==6),"Click creates disabled soft effects");
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        using(var sheet=new Bitmap(1280,624))using(var g=Graphics.FromImage(sheet))using(var font=new Font("Microsoft JhengHei UI",13)){
            g.Clear(Color.FromArgb(16,19,23));
            uint visualSeed=146;Func<double> visualRandom=()=>{visualSeed=unchecked(visualSeed*1664525+1013904223);return visualSeed/4294967296.0;};
            var dragFx=new CursorEffects(visualRandom){Viewport=new Rectangle(0,0,640,400)};dragFx.Configure(true,false,1,1,1,60);dragFx.Input(40,200,true,true);for(int i=1;i<=36;i++){dragFx.Draw(.006);dragFx.Input(40+i*15,200+30*Math.Sin(i*.2),false,true);}dragFx.Draw(0);
            for(int row=0;row<3;row++){
                uint seed=773;var burstFx=new CursorEffects(()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};burstFx.Input(320,200,true,true);for(int i=0;i<row;i++)burstFx.Draw(.1);burstFx.Draw(0);
                string a=Path.Combine(profile,"particle-drag-"+row+".png"),b=Path.Combine(profile,"particle-click-"+row+".png");SaveBackground(renderer.Capture(dragFx,640,400),Color.FromArgb(16,19,23),a);SaveBackground(renderer.Capture(burstFx,640,400),Color.FromArgb(16,19,23),b);
                g.DrawString(row==0?"拖曳：距離生成、兩側留白":"拖曳：放開後 "+(row*100)+" ms",font,Brushes.White,16,row*208+8);g.DrawString("點擊：波紋周邊 · "+(row*100)+" ms",font,Brushes.White,656,row*208+8);
                using(var image=new Bitmap(a))g.DrawImage(image,new Rectangle(0,row*208+36,640,172),new Rectangle(0,114,640,172),GraphicsUnit.Pixel);using(var image=new Bitmap(b))g.DrawImage(image,new Rectangle(640,row*208+36,640,172),new Rectangle(0,114,640,172),GraphicsUnit.Pixel);dragFx.Draw(.1);
            }
            sheet.Save(Path.Combine(profile,"particle-rules.png"));
        }
    }
    void TestWhiteProfile(){
        uint seed=1987;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,400)};var cohorts=new List<CursorEffects.Item[]>();var shares=new List<double>();
        foreach(bool click in new[]{true,false}){
            var pool=new List<CursorEffects.Item>();fx.Configure(!click,click,1,1,1,60);
            for(int i=0;i<250;i++){fx.Clear();fx.Input(100,200,true,true);if(!click)fx.Input(500,200,false,true);pool.AddRange(fx.Particles);}
            Require(pool.Count>=500,"Too few birth samples");double share=pool.Count(p=>p.Flash>=.96)/(double)pool.Count;Require(share>.86&&share<.97,"Bright white birth share outside calibrated range");shares.Add(share);
            Require(pool.All(p=>p.WhiteHold>=.2&&p.WhiteHold<=.6&&p.WhiteFade>=.12&&p.WhiteFade<=.3&&p.WhiteHold+p.WhiteFade<=.9),"Random white timings outside limits");
            Require(pool.Max(p=>p.WhiteHold)-pool.Min(p=>p.WhiteHold)>.35&&pool.Max(p=>p.WhiteFade)-pool.Min(p=>p.WhiteFade)>.15,"White timings lack per-particle variation");cohorts.Add(pool.Take(48).ToArray());
        }
        var selected=cohorts.SelectMany(p=>p).ToArray();fx.Clear();fx.Particles.AddRange(selected);
        for(int i=0;i<selected.Length;i++){selected[i].X=56+(i%12)*48;selected[i].Y=46+(i/12)*40;selected[i].Vx=selected[i].Vy=0;}
        renderer.Appearance(Color.Red,Color.Red,Color.Red);
        foreach(double fraction in new[]{.12,.45,.72}){
            foreach(var p in selected)p.Age=fraction*p.Life;fx.Draw(0);var body=fx.Commands.Where(c=>c.Kind==2).ToArray();var pixels=renderer.Capture(fx,640,400);
            if(fraction==.12)Require(body.Count(c=>c.X2>=.95)>=80,"Visible young particles rarely have white cores");
            if(fraction==.45){
                Require(body.Count(c=>c.X2>=.9)>=12&&body.Count(c=>c.X2<.25)>=12,"Same-age particles share a fixed white decay");
                Require(body.Any(c=>c.X<300&&c.X2>=.9)&&body.Any(c=>c.X>300&&c.X2<.25),"Older/far highlights are driven by cursor proximity");
                foreach(var c in body.Where(c=>c.X2>=.9)){int at=((int)c.Y*640+(int)c.X)*4;Require(pixels[at+3]>40&&pixels[at+1]/(double)pixels[at+3]>.88,"White command lacks a real GPU white core");}
            }
            var unchanged=body.ToArray();fx.Draw(0);Require(unchanged.SequenceEqual(fx.Commands.Where(c=>c.Kind==2)),"Zero-time rendering redraws particle randomness");
            SaveBackground(pixels,Color.FromArgb(16,19,23),Path.Combine(profile,"white-profile-"+(int)(fraction*100)+".png"));
        }
        foreach(var p in selected){double previous=2;foreach(double part in new[]{-.01,.25,.5,.75,1.01}){fx.Clear();fx.Particles.Add(p);p.Age=(p.WhiteHold+p.WhiteFade*part)*p.Life;fx.Draw(0);double value=fx.Commands.Single(c=>c.Kind==2).X2;Require(value<=previous+.000001,"White fade is not monotonic");previous=value;}}
        whiteProfileSummary=new{clickBirthWhiteShare=shares[0],dragBirthWhiteShare=shares[1],holdLifeFraction=new[]{.2,.6},fadeLifeFraction=new[]{.12,.3}};
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
    }
    void TestNoSoftEffects(){
        var resources=GetType().Assembly.GetManifestResourceNames();Require(resources.Length==1&&resources[0]=="Cursor.Renderer.gz","Soft sprites are still embedded");
        var retired=new CursorEffects();foreach(int kind in new[]{3,4,5,7})retired.Commands.Add(new DrawCommand(kind,320,200,100,0,10,0,1));Require(Alpha(renderer.Capture(retired,640,400))==0,"Retired soft command still draws");
        var triangle=new CursorEffects();triangle.Commands.Add(new DrawCommand(2,320,200,1,1,12,0,1));var pixels=renderer.Capture(triangle,640,400);
        Require(pixels[(200*640+320)*4+3]>200,"Bright fragment body missing");for(int y=160;y<240;y++)for(int x=280;x<360;x++)if(Math.Abs(x-320)>13||Math.Abs(y-200)>13)Require(pixels[(y*640+x)*4+3]==0,"Fragment draws a halo/square outside its geometry");
        var fx=Sample();Require(fx.Commands.All(c=>c.Kind==0||c.Kind==2||c.Kind==6),"Soft commands produced");var region=fx.Surface();pixels=renderer.Capture(fx,640,400);for(int y=0;y<400;y++)for(int x=0;x<640;x++)if(pixels[(y*640+x)*4+3]>0)Require(region.Contains(x,y),"Tight surface clips live geometry");
    }
    void TestReferenceClick(){
        // Source: FX_Touch MeshTri/PS1867 and Ring(3)/PS1870, resources.assets.
        // Compare extracted curve keys and the actual GPU silhouette, rather
        // than treating a changing array count as a visual-equivalence test.
        Require(Math.Abs(CursorEffects.WaveGrowth(.00720978)-.42050898)<.000001&&Math.Abs(CursorEffects.WaveGrowth(.21392822)-.71597731)<.000001&&Math.Abs(CursorEffects.WaveGrowth(1)-1)<.000001,"Reference wave-growth keys differ");
        Require(CursorEffects.FragmentGrowth(0)==0&&Math.Abs(CursorEffects.FragmentGrowth(.15445095)-1)<.000001&&CursorEffects.FragmentGrowth(1)<.000001,"Reference fragment does not grow then shrink");
        uint seed=3281;Func<double> rng=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var fx=new CursorEffects(rng){Viewport=new Rectangle(0,0,640,400)};fx.Configure(false,true,1,1,1,60);fx.Input(320,200,true,true);fx.Draw(0);
        Require(fx.Rings.Count==2&&fx.Rings.All(r=>r.Life==.6&&r.Size>=.12/.13&&r.Size<=.14/.13)&&fx.Commands.Count(c=>c.Kind==6)==2,"Click lacks two independent reference ring meshes");
        Require(fx.Rings[0].Size!=fx.Rings[1].Size&&fx.Rings[0].Angle!=fx.Rings[1].Angle,"Double rings share a size/phase");
        var initial=fx.Commands.Where(c=>c.Kind==6).ToArray();fx.Draw(.1);Require(fx.Commands.Where(c=>c.Kind==6).Zip(initial,(a,b)=>a.X2>b.X2+9&&a.Angle!=b.Angle).All(x=>x),"Wave fails to expand/rotate from its independent phases");
        fx.Draw(.1);fx.Draw(.1);Require(fx.Commands.Where(c=>c.Kind==6).All(c=>c.X2>45&&c.Y2==0),"Wave remains too small or white beyond the reference color window");
        renderer.Appearance(Color.Cyan,Color.Cyan,ColorPalette.All[0].Fragment);var mesh=new CursorEffects();mesh.Commands.Add(new DrawCommand(6,320,200,60,0,0,0,1));var pixels=renderer.Capture(mesh,640,400);
        Require(pixels[(200*640+320)*4+3]==0&&pixels[(200*640+360)*4+3]==0,"Ring becomes a filled disc");
        Require(pixels[(139*640+326)*4+3]>100&&pixels[(261*640+314)*4+3]<20,"Reference UV alpha profile is not mapped around the thin ring");
        var gaps=new List<double>();for(int round=0;round<64;round++){fx.Clear();fx.Input(320,200,true,true);var angles=fx.Particles.Select(p=>{double x=p.X-320,y=p.Y-200;Require(Math.Sqrt(x*x+y*y)>=30&&Math.Sqrt(x*x+y*y)<=40.5,"Peripheral emission falls outside its annulus");return Math.Atan2(y,x);}).OrderBy(a=>a).ToArray();for(int i=0;i<angles.Length;i++)gaps.Add(i+1<angles.Length?angles[i+1]-angles[i]:angles[0]+2*Math.PI-angles[i]);}
        Require(gaps.Min()<.15&&gaps.Max()>3.5,"Click particles still form equally spaced spokes");fx.SetClickScatter(0);fx.Clear();fx.Input(320,200,true,true);Require(fx.Particles.All(p=>Math.Abs(Math.Sqrt((p.X-320)*(p.X-320)+(p.Y-200)*(p.Y-200))-37.5)<.00001),"Zero scatter does not retain the nominal peripheral radius");
        renderer.Appearance(ColorPalette.All[0].Trail,ColorPalette.All[0].Ripple,ColorPalette.All[0].Fragment);
        using(var sheet=new Bitmap(960,608))using(var g=Graphics.FromImage(sheet))using(var font=new Font("Microsoft JhengHei UI",12)){
            g.Clear(Color.FromArgb(16,19,23));var ages=new[]{.04,.10,.18,.28,.40,.55};
            for(int frame=0;frame<6;frame++){
                uint pictureSeed=1931;var click=new CursorEffects(()=>{pictureSeed=unchecked(pictureSeed*1664525+1013904223);return pictureSeed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};click.Input(320,200,true,true);double remaining=ages[frame];while(remaining>0){double step=Math.Min(.05,remaining);click.Draw(step);remaining-=step;}click.Draw(0);
                string path=Path.Combine(profile,"click-reference-"+frame+".png");SaveBackground(renderer.Capture(click,640,400),Color.FromArgb(16,19,23),path);int x=(frame%3)*320,y=(frame/3)*304;g.DrawString((ages[frame]*1000).ToString("F0")+" ms",font,Brushes.White,x+14,y+8);using(var image=new Bitmap(path))g.DrawImage(image,new Rectangle(x,y+32,320,272),new Rectangle(160,64,320,272),GraphicsUnit.Pixel);
            }
            sheet.Save(Path.Combine(profile,"click-reference-timeline.png"));
        }
        uint animationSeed=5824;var animation=new CursorEffects(()=>{animationSeed=unchecked(animationSeed*1664525+1013904223);return animationSeed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};
        for(int frame=0;frame<64;frame++){if(frame==0||frame==32)animation.Input(320,200,true,true);animation.Draw(frame==0?0:1.0/30);SaveBackground(renderer.Capture(animation,640,400),Color.FromArgb(16,19,23),Path.Combine(profile,"click-animation-"+frame.ToString("D2")+".png"));}
    }
    void TestSegmentDissolve(){
        Require(Math.Abs(CursorEffects.WaveThreshold(0)-1)<.000001&&CursorEffects.WaveThreshold(.2)==0&&Math.Abs(CursorEffects.WaveThreshold(1)-1)<.000001,"Compiled shader custom-data keys differ");
        renderer.Appearance(Color.Cyan,Color.Cyan,ColorPalette.All[0].Fragment);
        var ring=new CursorEffects();ring.Commands.Add(new DrawCommand(6,320,200,70,0,0,0,1));var full=renderer.Capture(ring,640,400);double previous=Alpha(full);
        for(int level=1;level<=8;level++){
            ring.Commands[0]=new DrawCommand(6,320,200,70,0,level/8.0,0,1);var clipped=renderer.Capture(ring,640,400);double sum=Alpha(clipped);Require(sum<=previous+3,"Increasing shader threshold adds ring pixels");previous=sum;
            Require(clipped.SequenceEqual(renderer.Capture(ring,640,400)),"Shader clip changes at fixed inputs");
        }
        ring.Commands[0]=new DrawCommand(6,320,200,70,0,1.01,0,1);Require(Alpha(renderer.Capture(ring,640,400))==0,"Threshold above texture maximum leaves pixels");
        // A source alpha threshold leaves one connected arc per ring, rather
        // than inventing three small holes or changing each sector's opacity.
        ring.Commands[0]=new DrawCommand(6,320,200,70,0,.5,0,1);var middle=renderer.Capture(ring,640,400);var rim=new List<int>();
        for(int i=0;i<96;i++){double angle=(i+.5)*Math.PI/48;int peak=0;for(int radius=69;radius<=74;radius++){int x=(int)Math.Round(320+radius*Math.Cos(angle)),y=(int)Math.Round(200+radius*Math.Sin(angle));peak=Math.Max(peak,middle[(y*640+x)*4+3]);}rim.Add(peak);}
        int transitions=0;for(int i=0;i<rim.Count;i++)if((rim[i]>25)!=(rim[(i+1)%rim.Count]>25))transitions++;
        SaveBackground(middle,Color.FromArgb(76,111,159),Path.Combine(profile,"debug-shader-clip.png"));
        Require(rim.Count(v=>v<8)>24&&rim.Count(v=>v>90)>16&&transitions<=4,"Clip does not leave a long arc with a single expanding gap: zero="+rim.Count(v=>v<8)+" bright="+rim.Count(v=>v>90)+" transitions="+transitions);
        int radialPixels=0;for(int radius=60;radius<85;radius++){double angle=275.625*Math.PI/180;int x=(int)Math.Round(320+radius*Math.Cos(angle)),y=(int)Math.Round(200+radius*Math.Sin(angle));if(full[(y*640+x)*4+3]>50)radialPixels++;}Require(radialPixels<=4,"Wave stroke remains too thick");
        ring.Commands[0]=new DrawCommand(6,320,200,70,0,.5,Math.PI,1);var rotated=renderer.Capture(ring,640,400);Require(!rotated.SequenceEqual(middle),"Independent ring rotation does not move the retained arc");
        uint seed=7921;var click=new CursorEffects(()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};click.Configure(false,true,1,1,1,60);
        var counts=new HashSet<int>();for(int i=0;i<128;i++){click.Clear();click.Input(320,200,true,true);counts.Add(click.Particles.Count);Require(click.Particles.Count>=3&&click.Particles.Count<=5,"Default count leaves 3–5 range");var born=click.Particles.ToArray();click.Draw(0);click.Draw(0);Require(born.SequenceEqual(click.Particles),"Count changes after birth");}Require(counts.SetEquals(new[]{3,4,5}),"Repeated clicks lack bounded count variation");
        click.SetClickCountRange(2,7);click.Clear();click.Input(320,200,true,true);Require(click.Particles.Count>=2&&click.Particles.Count<=7,"Explicit count range ignored");click.SetClickCountRange(4,4);click.Clear();click.Input(320,200,true,true);Require(click.Particles.Count==4,"Equal bounds are not fixed");click.SetClickCountRange(0,0);click.Clear();click.Input(320,200,true,true);Require(click.Particles.Count==0&&click.Rings.Count==2,"Disabled fragments are enabled");
        var live=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};live.Input(320,200,true,true);live.Draw(.2);var commands=live.Commands.Where(c=>c.Kind==6).ToArray();live.Opacity=.3;live.Draw(0);var dim=live.Commands.Where(c=>c.Kind==6).ToArray();Require(commands.Zip(dim,(a,b)=>a.Width==b.Width&&Math.Abs(b.Alpha/a.Alpha-.3)<.0001).All(v=>v),"Opacity changes dissolve threshold");
        renderer.Appearance(ColorPalette.All[0].Trail,ColorPalette.All[0].Ripple,ColorPalette.All[0].Fragment);
        using(var sheet=new Bitmap(960,608))using(var g=Graphics.FromImage(sheet))using(var font=new Font("Microsoft JhengHei UI",12)){
            g.Clear(Color.FromArgb(76,111,159));var ages=new[]{.04,.10,.18,.24,.30,.38};
            for(int frame=0;frame<6;frame++){
                uint pictureSeed=8137;var sample=new CursorEffects(()=>{pictureSeed=unchecked(pictureSeed*1664525+1013904223);return pictureSeed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};sample.Input(320,200,true,true);double remaining=ages[frame];while(remaining>0){double step=Math.Min(.05,remaining);sample.Draw(step);remaining-=step;}sample.Draw(0);
                string path=Path.Combine(profile,"shader-clip-"+frame+".png");SaveBackground(renderer.Capture(sample,640,400),Color.FromArgb(76,111,159),path);int x=(frame%3)*320,y=(frame/3)*304;g.DrawString((ages[frame]*1000).ToString("F0")+" ms",font,Brushes.White,x+14,y+8);using(var image=new Bitmap(path))g.DrawImage(image,new Rectangle(x,y+32,320,272),new Rectangle(160,64,320,272),GraphicsUnit.Pixel);
            }sheet.Save(Path.Combine(profile,"click-shader-timeline.png"));
        }
        uint animSeed=10251;var animation=new CursorEffects(()=>{animSeed=unchecked(animSeed*1664525+1013904223);return animSeed/4294967296.0;}){Viewport=new Rectangle(0,0,640,400)};
        for(int frame=0;frame<96;frame++){if(frame%32==0)animation.Input(320,200,true,true);animation.Draw(frame%32==0?0:1.0/30);SaveBackground(renderer.Capture(animation,640,400),Color.FromArgb(76,111,159),Path.Combine(profile,"shader-animation-"+frame.ToString("D2")+".png"));}
    }
    void TestTrailSpread(){
        var narrow=SpreadSample(0);var normal=SpreadSample(1);var wide=SpreadSample(2);var vertical=SpreadSample(1,true);
        Require(normal.Particles.Count==narrow.Particles.Count&&normal.Particles.Count==wide.Particles.Count,"Spread changes particle density");
        Require(narrow.Particles.All(p=>p.Y==200&&p.Vy==0),"Zero spread leaves the path");
        Require(normal.Particles.Count(p=>p.Y<200)>=3&&normal.Particles.Count(p=>p.Y>200)>=3,"Fragments do not occupy both sides of the path");
        Require(normal.Particles.All(p=>Math.Abs(p.Y-200)-p.Size>=6-.00001&&Math.Abs(p.Y-200)-p.Size<=10+.00001),"Fragments have no controlled gap from the trail");
        Require(normal.Particles.Count(p=>p.Vx<0)>=2&&normal.Particles.Count(p=>p.Vx>0)>=2,"Scatter lacks random tangential directions");
        Require(normal.Particles.All(p=>(p.Y-200)*p.Vy>0),"Fragments drift back across the trail");
        for(int i=0;i<normal.Particles.Count;i++){
            var a=normal.Particles[i];var b=wide.Particles[i];var v=vertical.Particles[i];
            Require(Math.Abs((b.Y-200)-2*(a.Y-200))<.00001&&Math.Abs(b.Vy-2*a.Vy)<.00001,"Spread does not scale distance independently");
            Require(Math.Abs((b.X-narrow.Particles[i].X)-2*(a.X-narrow.Particles[i].X))<.00001&&Math.Abs(b.Vx-2*a.Vx)<.00001&&a.Life==b.Life&&a.Size==b.Size&&a.Light==b.Light,"Spread changes lifetime, brightness, density or size");
            Require(Math.Abs(v.X-200+a.Y-200)<.00001&&Math.Abs(v.Y-a.X)<.00001,"Scatter is not perpendicular to a vertical path");
        }
        normal.Draw(.1);normal.Draw(.1);Require(normal.Particles.Average(p=>Math.Abs(p.Y-200))>5,"Random trajectories do not visibly disperse over time");
        var clickA=SpreadSample(0);var clickB=SpreadSample(3);clickA.Clear();clickB.Clear();clickA.Click=clickB.Click=true;clickA.Input(200,200,true,true);clickB.Input(200,200,true,true);
        Require(clickA.Particles.SelectMany(p=>new[]{p.X,p.Y,p.Vx,p.Vy,p.Life,p.Size}).SequenceEqual(clickB.Particles.SelectMany(p=>new[]{p.X,p.Y,p.Vx,p.Vy,p.Life,p.Size})),"Trail spread changes click bursts");
        var sakura=ColorPalette.All[2];renderer.Appearance(sakura.Trail,sakura.Ripple,sakura.Fragment);
        using(var sheet=new Bitmap(640,540))using(var g=Graphics.FromImage(sheet))using(var title=new Font("Microsoft JhengHei UI",13)){
            g.Clear(Color.FromArgb(16,19,23));
            for(int row=0;row<3;row++){
                var fx=SpreadSample(row);fx.Viewport=new Rectangle(0,0,640,400);fx.Draw(.1);fx.Draw(.02);
                string path=Path.Combine(profile,"trail-spread-"+row+".png");SaveBackground(renderer.Capture(fx,640,400),Color.FromArgb(16,19,23),path);
                g.DrawString("拖曳分散 "+(row*100)+"%"+(row==1?"（預設）":""),title,Brushes.White,20,row*180+10);
                using(var rendered=new Bitmap(path))g.DrawImage(rendered,new Rectangle(0,row*180+36,640,140),new Rectangle(0,130,640,140),GraphicsUnit.Pixel);
            }
            sheet.Save(Path.Combine(profile,"trail-spread-comparison.png"));
        }
    }
    void TestTrailDefaultsAndFade(){
        var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};
        fx.Configure(true,true,1,1,1,60);fx.Customize(1,1,1,1,1,1);
        Require(Math.Abs(fx.TrailWidth-1.6)<.000001&&fx.TrailFragmentSize==2&&fx.ClickFragmentSize==2&&fx.RippleSize==.75,"Rebased 100 percent sizes differ");
        fx.Input(100,100,true,true);Require(fx.Particles.Count==4,"Default click density must be halved");
        for(int i=1;i<=10;i++)fx.Input(100+i*10,100,false,true);
        Require(fx.Particles.Count(p=>!p.Burst)==1,"Slow drag rounds half-density back up at every sample");
        fx.Clear();fx.Configure(true,false,1,0,1,60);fx.Input(50,200,true,true);fx.Input(550,200,false,true);fx.Draw(0);
        double initial=fx.Commands.Single(c=>c.Kind==0).Alpha;fx.Draw(.09);
        Require(Math.Abs(fx.Commands.Single(c=>c.Kind==0).EndAge-.5)<.00001,"Default fade is not 180ms");
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
    void TestTrailRadiance(){
        Require(CursorEffects.TrailLight(0)==1&&Math.Abs(CursorEffects.TrailLight(27563.0/65535)-.28235295)<.000001&&CursorEffects.TrailLight(1)==0,"Reference RGB light curve keys differ");
        using(var sheet=new Bitmap(1280,1296))using(var g=Graphics.FromImage(sheet))using(var title=new Font("Microsoft JhengHei UI",13)){
            g.Clear(Color.FromArgb(16,19,23));
            for(int n=0;n<ColorPalette.All.Length;n++){
                var p=ColorPalette.All[n];renderer.Appearance(p.Trail,p.Ripple,p.Fragment);
                var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};fx.Configure(true,false,1,0,1,60);fx.Input(80,200,true,true);fx.Input(560,200,false,true);fx.Draw(0);
                int previous=int.MaxValue,peak=0;
                foreach(double step in new[]{0,.09,.045}){
                    fx.Draw(step);var pixels=renderer.Capture(fx,640,400);int at=(200*640+320)*4,light=pixels[at]+pixels[at+1]+pixels[at+2];
                    Require(light<previous,"Trail does not darken monotonically in "+p.Name);previous=light;if(step==0)peak=Math.Max(pixels[at],Math.Max(pixels[at+1],pixels[at+2]));
                }
                Require(peak>=235,"New trail core is too dim in "+p.Name);
                fx.Opacity=0;fx.Draw(0);Require(Alpha(renderer.Capture(fx,640,400))==0,"Trail gradient ignores global opacity");
                fx.Clear();fx.Opacity=1;fx.Input(80,200,true,true);fx.Input(560,200,false,true);fx.Points[0].Age=.179;fx.Draw(0);
                var spatial=renderer.Capture(fx,640,400);int tail=(200*640+96)*4,head=(200*640+540)*4;Require(spatial[head]+spatial[head+1]+spatial[head+2]>3*(spatial[tail]+spatial[tail+1]+spatial[tail+2]),"Gradient does not keep the newest end brighter");
                fx.Draw(0);var plain=renderer.Capture(fx,640,400);fx.Opacity=.4;fx.Draw(0);var faded=renderer.Capture(fx,640,400);Require(Math.Abs(faded[head+3]/(double)plain[head+3]-.4)<.02,"Trail applies opacity twice");
                fx.Opacity=1;fx.Draw(0);string path=Path.Combine(profile,"trail-radiance-"+n+".png");SaveBackground(renderer.Capture(fx,640,400),Color.FromArgb(16,19,23),path);int x=(n%2)*640,y=(n/2)*432;g.DrawString(p.Name+" · 舊 → 新",title,Brushes.White,x+24,y+8);using(var rendered=new Bitmap(path))g.DrawImageUnscaled(rendered,x,y+32);
                fx.Draw(0);var stroke=fx.Commands.Single(c=>c.Kind==0);var whole=renderer.Capture(fx,640,400);fx.Commands.Add(stroke);Require(whole.SequenceEqual(renderer.Capture(fx,640,400)),"Age-gradient overlap adds brightness");
                double age=(stroke.StartAge+stroke.EndAge)*.5;fx.Commands.Clear();fx.Commands.Add(new DrawCommand(0,80,200,320,200,stroke.Width,0,stroke.Alpha,stroke.StartAge,age));fx.Commands.Add(new DrawCommand(0,320,200,560,200,stroke.Width,0,stroke.Alpha,age,stroke.EndAge));var split=renderer.Capture(fx,640,400);
                for(int sx=308;sx<=332;sx++)for(int sy=196;sy<=204;sy++)for(int c=0;c<4;c++){int at=(sy*640+sx)*4+c;Require(Math.Abs(split[at]-whole[at])<=3,"Age gradient creates a bright sample joint");}
            }
            sheet.Save(Path.Combine(profile,"trail-radiance.png"));
        }
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
    }
    void TestTrailJoints(){
        renderer.Appearance(Color.FromArgb(248,135,178),Color.FromArgb(248,135,178),Color.White);
        foreach(int kind in new[]{0}){
            var fx=new CursorEffects();var command=new DrawCommand(0,100,200,500,200,2.4,0,.4);
            fx.Commands.Add(command);var once=renderer.Capture(fx,640,400);fx.Commands.Add(command);var twice=renderer.Capture(fx,640,400);
            Require(once.SequenceEqual(twice),"Overlapping trail coverage accumulates for kind "+kind);
            fx.Commands.Clear();fx.Commands.Add(new DrawCommand(0,100,200,300,200,2.4,0,.4));fx.Commands.Add(new DrawCommand(0,300,200,500,200,2.4,0,.4));
            var split=renderer.Capture(fx,640,400);
            for(int y=170;y<230;y++)for(int x=292;x<308;x++)Require(split[(y*640+x)*4+3]<=once[(y*640+x)*4+3]+3,"Bright sample node remains at "+x+","+y+" kind "+kind);
            if(kind==0)for(int x=100;x<500;x++)Require(split[(200*640+x)*4+3]>80,"Segment join has a gap");
        }
        // Ring blending remains independent, even though trail overlap is capped.
        var ring=new CursorEffects();var r=new DrawCommand(6,200,200,40,0,0,0,.4);ring.Commands.Add(r);double a=Alpha(renderer.Capture(ring,640,400));ring.Commands.Add(r);Require(Alpha(renderer.Capture(ring,640,400))>a,"Trail blend leaked into click rings");
        var curves=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};curves.Configure(true,false,1,0,1,60);
        curves.Input(40,100,true,true);for(int i=1;i<=36;i++)curves.Input(40+i*15,100+30*Math.Sin(i*.25),false,true);curves.Input(580,100,false,false);
        for(int i=0;i<=32;i++){double angle=i*Math.PI/16;curves.Input(160+28*Math.Cos(angle),260+28*Math.Sin(angle),i==0,true);}curves.Input(188,260,false,false);
        foreach(var p in new[]{new Point(320,300),new Point(430,220),new Point(390,300),new Point(500,240)})curves.Input(p.X,p.Y,p.X==320,true);
        curves.Draw(.02);SaveBackground(renderer.Capture(curves,640,400),Color.FromArgb(16,19,23),Path.Combine(profile,"trail-joints.png"));
    }
    static double LargestTurn(IEnumerable<PointF> points){
        var p=points.ToArray();double largest=0;
        for(int i=1;i<p.Length-1;i++){double ax=p[i].X-p[i-1].X,ay=p[i].Y-p[i-1].Y,bx=p[i+1].X-p[i].X,by=p[i+1].Y-p[i].Y;double norm=Math.Sqrt((ax*ax+ay*ay)*(bx*bx+by*by));if(norm>0)largest=Math.Max(largest,Math.Acos(Math.Max(-1,Math.Min(1,(ax*bx+ay*by)/norm))));}return largest;
    }
    void TestCurvesAndLight(){
        var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};fx.Configure(true,false,1,0,1,60);
        var sample=new[]{new Point(100,220),new Point(140,140),new Point(240,100),new Point(340,140),new Point(400,220),new Point(340,300),new Point(240,340),new Point(140,300),new Point(100,220)};
        for(int i=0;i<sample.Length;i++)fx.Input(sample[i].X,sample[i].Y,i==0,true);fx.Draw(0);
        Require(fx.SmoothTrail.Count>sample.Length&&fx.SmoothTrail.Count<=CursorEffects.MaxTrailVertices,"Sparse loop was not smoothed within a fixed budget");
        Require(LargestTurn(fx.SmoothTrail.Select(p=>new PointF((float)p.X,(float)p.Y)))<LargestTurn(sample.Select(p=>new PointF(p.X,p.Y)))*.6,"Sparse loop still has pronounced angular joints");
        Require(fx.SmoothTrail.All(p=>p.X>=100&&p.X<=400&&p.Y>=100&&p.Y<=340),"Curve overshoots input bounds");
        Require(fx.SmoothTrail.First().X==100&&fx.SmoothTrail.Last().X==100&&fx.SmoothTrail.Last().Y==220,"Smoothing delays/drops the cursor endpoint");
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        SaveBackground(renderer.Capture(fx,640,400),Color.FromArgb(16,19,23),Path.Combine(profile,"curve-smooth.png"));
        var legacy=new CursorEffects();for(int i=1;i<sample.Length;i++)legacy.Commands.Add(new DrawCommand(0,sample[i-1].X,sample[i-1].Y,sample[i].X,sample[i].Y,2.5,0,.9));
        SaveBackground(renderer.Capture(legacy,640,400),Color.FromArgb(16,19,23),Path.Combine(profile,"curve-linear.png"));
        using(var sheet=new Bitmap(1280,432))using(var g=Graphics.FromImage(sheet))using(var title=new Font("Microsoft JhengHei UI",13)){
            g.Clear(Color.FromArgb(16,19,23));g.DrawString("相同稀疏取樣 · 原始折線",title,Brushes.White,20,8);g.DrawString("相同稀疏取樣 · 曲線補間",title,Brushes.White,660,8);
            using(var a=new Bitmap(Path.Combine(profile,"curve-linear.png")))g.DrawImageUnscaled(a,0,32);using(var b=new Bitmap(Path.Combine(profile,"curve-smooth.png")))g.DrawImageUnscaled(b,640,32);sheet.Save(Path.Combine(profile,"curve-comparison.png"));
        }
        var lights=SpreadSample(1);lights.Draw(0);var before=lights.Commands.Where(c=>c.Kind==2).ToArray();
        Require(before.Max(c=>c.X2)-before.Min(c=>c.X2)>.25,"Same-age fragments lack independent brightness");
        var birth=lights.Particles.Select(p=>p.Light).ToArray();lights.Draw(0);Require(before.SequenceEqual(lights.Commands.Where(c=>c.Kind==2)),"Zero-time draw resamples randomness");
        Require(lights.Commands.All(c=>c.Kind==0||c.Kind==2),"Soft effects remain in the drag renderer");
        lights.Draw(.1);Require(lights.Particles.Select(p=>p.Light).SequenceEqual(birth),"Animation resamples particle randomness");var animated=lights.Commands.Where(c=>c.Kind==2).ToArray();lights.Draw(0);Require(animated.SequenceEqual(lights.Commands.Where(c=>c.Kind==2)),"Reference brightness animation changes at zero elapsed time");
        // Worst-case 1s zigzags, maximum particles/rings, same native ABI cap.
        var stress=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,1920,1080)};stress.Configure(true,true,3,3,1,60);stress.SetTrailLifetime(1);
        for(int i=0;i<16;i++)stress.Input(300,300,true,true);for(int i=0;i<128;i++)stress.Input(i%2==0?100:1800,100+i*5,false,true);stress.Draw(0);
        Require(stress.SmoothTrail.Count<=CursorEffects.MaxTrailVertices&&stress.Commands.Count<=2048,"Curve maximum exceeds renderer budget");
        renderer.Capture(stress,1920,1080);
    }
    async void RunTest(){
        string report=Path.Combine(profile,"test.json");var checks=new List<string>();var shell=Native.ShellInputHandles().ToDictionary(h=>h,h=>Native.IsWindowEnabled(h));
        try{
            await Task.Delay(150);Require(ready&&!failed,"Native renderer failed");Require(renderer.Hardware,"Hardware rendering unavailable on test computer");Require(Marshal.SizeOf(typeof(DrawCommand))==40,"Interop command layout");
            Require(cursorFps==60&&effects.Fps==60,"Fixed 60 FPS");Require(overlay.Bounds==SystemInformation.VirtualScreen,"All-screen bounds");ResetControls();
            for(int page=0;page<3;page++){controls.SelectPage(page);controls.PerformLayout();}
            foreach(var n in controls.Numbers){Require(n.Controls.Count==0,"Spin controls");decimal typed=Math.Max(n.Minimum,Math.Min(n.Maximum,73));n.Text=typed.ToString();n.Commit();Require(n.Value==typed,"Typed value");n.Text=(n.Maximum+100).ToString();n.Commit();Require(n.Value==n.Maximum,"Clamp value");}
            var sliders=new List<PositionSlider>();Action<Control> collect=null;collect=c=>{foreach(Control child in c.Controls){if(child is PositionSlider)sliders.Add((PositionSlider)child);collect(child);}};collect(controls);Require(sliders.Count==9,"Nine essential sliders");
            foreach(var s in sliders){var type=typeof(PositionSlider);var down=type.GetMethod("OnMouseDown",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);var up=type.GetMethod("OnMouseUp",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic);down.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width/2,16,0)});Require(Math.Abs(s.Value-(s.Minimum+s.Maximum)/2)<=Math.Ceiling((double)(s.Maximum-s.Minimum)/Math.Max(1,s.Width-18)),"Direct slider jump");up.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width+50,16,0)});Require(s.Value==s.Maximum&&!s.Capture,"Fast upper endpoint");down.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,s.Width/2,16,0)});up.Invoke(s,new object[]{new MouseEventArgs(MouseButtons.Left,1,-50,16,0)});Require(s.Value==s.Minimum&&!s.Capture,"Fast lower endpoint");}
            ResetControls();Require(controls.Numbers.Select(n=>n.Parent.Size).Distinct().Count()==1,"Numeric frames differ, including opacity");foreach(var n in controls.Numbers)Require(n.Parent.ClientSize.Height-n.Parent.Padding.Vertical>=n.Font.Height,"Numeric input text clipped: "+n.AccessibleName);var panelSize=controls.ClientSize;for(int page=0;page<3;page++){controls.SelectPage(page);Require(controls.ClientSize==panelSize,"Tab changes panel size");}checks.Add("three fixed pages, nine essential sliders/plain inputs, identical numeric frames including opacity, fixed 60 FPS / all screens");
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
            var test=new CursorEffects(()=>.5){Viewport=new Rectangle(-1920,-100,3840,1080)};test.Input(-1820,0,true,true);Require(test.Points.Single().X==100&&test.Points.Single().Y==100,"Negative monitor origin");test.Input(-1800,20,true,true,true);Require(test.Points.Count==1,"Blocked input emits");test.Clear();test.Configure(true,true,1,3,1,60);test.Input(-1820,0,true,true);Require(test.Particles.Count==12,"Density multiplier");test.Configure(true,true,2,3,1,60);Require(test.Particles[0].Size==20,"Size multiplier");for(int i=0;i<1000;i++)test.Input(-1820+(i*4)%1500,100,true,true);Require(test.Points.Count==CursorEffects.MaxTrailPoints&&test.Particles.Count==192&&test.Rings.Count==16,"Unbounded particles");for(int i=0;i<20;i++)test.Draw(.1);Require(test.Alive==0,"Expiration");checks.Add("negative origin, blocked controls, multipliers, bounded memory, finite lifetimes");
            TestHighSpeedTrails();checks.Add("600px real GPU line without gaps, 3720px multi-monitor stroke with distributed fragments, release/blocked boundaries, 1000 rapid 7600px samples within fixed budgets");
            TestParticleRules();checks.Add("sample-rate independent distance emission and +/-35% spacing, stationary sleep continuity, four slow perimeter click fragments, upright/inverted triangles, independent speeds, real GPU white-to-tint transition");
            TestReferenceClick();checks.Add("reference Hermite growth, two independent 600ms mesh rings, GPU angular bright/dim arcs, rebased expansion over 45px, random peripheral clusters, zero-scatter radius, real GPU animation frames");
            TestSegmentDissolve();checks.Add("compiled shader threshold keys, pixel clip monotonicity, long retained arcs, thin stroke, independent rotation, opacity independent of clip, random click range");
            TestTrailDefaultsAndFade();checks.Add("rebased width/fragments 200 percent and ripple 75 percent at 100 percent UI, 100px distance emission, 40-1000ms fade, continuous live edits, 1s trail at 125Hz");TestTrailRadiance();checks.Add("source RGB light keys, six palettes with bright new cores and progressive darkening, endpoint age gradient, opacity applied once, no opaque black tail");TestTrailJoints();checks.Add("GPU trail overlap invariant, no sample-node brightening or gaps, tight loops and acute turns, independent ring blend");TestTrailSpread();TestCurvesAndLight();checks.Add("randomized side gap and gentle outward scatter, independent birth-white brightness, smooth sparse loops, bounded curve budget, no soft effects");
            TestWhiteProfile();TestNoSoftEffects();checks.Add("random per-particle white hold/fade, high white birth share, older/far particles retain highlights, geometry-only GPU rendering without sprites or blur");
            var visual=new List<object>();
            var visibleSample=Sample();var visiblePixels=renderer.Capture(visibleSample,640,400);visual.Add(new{alpha=Alpha(visiblePixels)});
            var invisible=Sample();invisible.Opacity=0;invisible.Draw(0);Require(Alpha(renderer.Capture(invisible,640,400))==0,"Opacity zero not transparent");checks.Add("real Direct2D captures, opacity zero transparent");
            var custom=Sample();var beforeTrail=custom.Commands.First(c=>c.Kind==0);var beforeRing=custom.Commands.First(c=>c.Kind==6);var beforeBurst=custom.Particles.First(p=>p.Burst).Size;var beforeFragment=custom.Particles.First(p=>!p.Burst).Size;
            custom.Customize(2,3,1.5,2.5,.4,.7);custom.Draw(0);var afterTrail=custom.Commands.First(c=>c.Kind==0);var afterRing=custom.Commands.First(c=>c.Kind==6);
            Require(Math.Abs(afterTrail.Width/beforeTrail.Width-2)<.001&&Math.Abs(afterTrail.Alpha/beforeTrail.Alpha-.4)<.001,"Trail width/opacity not independent");Require(Math.Abs(afterRing.X2/beforeRing.X2-3)<.001&&Math.Abs(afterRing.Alpha/beforeRing.Alpha-.7)<.001,"Ripple size/opacity not independent");Require(Math.Abs(custom.Particles.First(p=>p.Burst).Size/beforeBurst-2.5)<.001&&Math.Abs(custom.Particles.First(p=>!p.Burst).Size/beforeFragment-1.5)<.001,"Fragment sizes not independent");
            var clearTrail=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};clearTrail.Customize(1,1,1,1,0,1);clearTrail.Input(100,100,true,true);clearTrail.Input(150,100,false,true);Require(clearTrail.Points.Count==0&&clearTrail.Particles.All(p=>p.Burst)&&clearTrail.Rings.Count==2,"Transparent trail still emits");
            renderer.Appearance(Color.Red,Color.Red,Color.Red);var redFx=Sample();foreach(var p in redFx.Particles)p.Flash=0;redFx.Draw(.1);redFx.Draw(.1);redFx.Draw(.02);var red=renderer.Capture(redFx,640,400);long redSum=0,otherSum=0;for(int i=0;i<red.Length;i+=4){redSum+=red[i+2];otherSum+=red[i]+red[i+1];}Require(redSum>10000&&otherSum==0,"Native geometry recoloring failed: red="+redSum+" other="+otherSum);
            var stationary=Sample();var particle=stationary.Particles.First();double initialX=particle.X,initialY=particle.Y,initialAngle=particle.Angle,initialAge=particle.Age;stationary.SetParticleSpeed(0);stationary.SetClickSpeed(0);stationary.Draw(.1);Require(particle.X==initialX&&particle.Y==initialY&&particle.Angle==initialAngle&&particle.Age>initialAge,"Zero speed should freeze motion, not lifetime");stationary.SetParticleSpeed(2);stationary.SetClickSpeed(2);stationary.Draw(.1);Require(Math.Abs(particle.X-initialX-particle.Vx*.2)<.001&&Math.Abs(particle.Y-initialY-particle.Vy*.2)<.001&&Math.Abs(particle.Angle-initialAngle-particle.Spin*.2)<.001,"Live speed multiplier doesn't apply");stationary.SetParticleSpeed(0);stationary.SetClickSpeed(0);for(int i=0;i<10;i++)stationary.Draw(.1);Require(stationary.Alive==0,"Zero-speed particles never expire");
            var speeds=new[]{.5,1,2,3};var endpoints=new List<double[]>();var lifetimes=new List<double>();
            foreach(double speed in speeds){var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,640,400)};fx.SetParticleSpeed(speed);fx.SetClickSpeed(speed);fx.Input(200,200,true,true);fx.Input(230,220,false,true);var references=fx.Particles.ToArray();int steps=0;while(fx.Particles.Count>0&&steps<150){fx.Draw(.01);steps++;}Require(fx.Particles.Count==0,"Speed-scaled particles fail to expire");lifetimes.Add(steps*.01);endpoints.Add(references.SelectMany(p=>new[]{p.X,p.Y,p.Angle}).ToArray());}
            foreach(var end in endpoints)for(int i=0;i<end.Length;i++)Require(Math.Abs(end[i]-endpoints[0][i])<.00001,"Speed changes final scatter range or rotation");for(int i=0;i<speeds.Length;i++)Require(Math.Abs(lifetimes[i]*speeds[i]-lifetimes[1])<.035,"Speed does not scale fade duration");
            var slow=Sample();var fast=Sample();slow.SetParticleSpeed(.5);slow.SetClickSpeed(.5);fast.SetParticleSpeed(3);fast.SetClickSpeed(3);slow.Draw(.06);fast.Draw(.01);for(int i=0;i<slow.Particles.Count;i++)Require(Math.Abs(slow.Particles[i].X-fast.Particles[i].X)<.00001&&Math.Abs(slow.Particles[i].Age/slow.Particles[i].Life-fast.Particles[i].Age/fast.Particles[i].Life)<.00001,"Same progress changes path/fade");
            var variable=Sample();var variableReferences=variable.Particles.ToArray();for(int i=0;i<100&&variable.Particles.Count>0;i++){variable.SetParticleSpeed(i%2==0?.5:3);variable.SetClickSpeed(i%2==0?.5:3);variable.Draw(.01);}var constantFx=Sample();var constantReferences=constantFx.Particles.ToArray();for(int i=0;i<100&&constantFx.Particles.Count>0;i++)constantFx.Draw(.01);for(int i=0;i<constantReferences.Length;i++)Require(Math.Abs(variableReferences[i].X-constantReferences[i].X)<.00001&&Math.Abs(variableReferences[i].Y-constantReferences[i].Y)<.00001,"Live speed changes range");checks.Add("50/100/200/300 percent speed preserves drag/click endpoints and fade progress, changes duration only, live edits preserve range");
            controls.Updating=true;controls.EffectSize.Value=143;controls.ParticleSpeed.Value=185;controls.OpacityValue.Value=72;controls.Updating=false;Configure();var kept=controls.Numbers.Select(n=>n.Value).ToArray();bool keptMaster=controls.VisibleValue.Checked;
            using(var preview=new Bitmap(1280,1296))using(var g=Graphics.FromImage(preview))using(var title=new Font("Microsoft JhengHei UI",14)){
                g.Clear(Color.FromArgb(16,19,23));
                for(int i=0;i<ColorPalette.All.Length;i++){controls.Palette.SelectedIndex=i+1;var p=ColorPalette.All[i];Require(controls.TrailColor.Value==p.Trail&&controls.RippleColor.Value==p.Ripple&&controls.FragmentColor.Value==p.Fragment,"Palette doesn't apply all colors");Require(controls.Numbers.Select(n=>n.Value).SequenceEqual(kept)&&controls.VisibleValue.Checked==keptMaster,"Palette changed effect parameters or master state");renderer.Appearance(p.Trail,p.Ripple,p.Fragment);var pixels=renderer.Capture(Sample(),640,400);string path=Path.Combine(profile,"palette-"+i+".png");SaveBackground(pixels,Color.FromArgb(16,19,23),path);int x=(i%2)*640,y=(i/2)*432;g.DrawString(p.Name,title,Brushes.White,x+24,y+7);using(var rendered=new Bitmap(path))g.DrawImageUnscaled(rendered,x,y+32);}
                preview.Save(Path.Combine(profile,"palettes.png"));
            }
            controls.FragmentColor.Value=Color.Red;Require(controls.Palette.SelectedIndex==0,"Manual colors not marked custom");SaveControls(true);ResetControls();RestoreControls(true);Require(controls.Palette.SelectedIndex==0&&controls.FragmentColor.Value.ToArgb()==Color.Red.ToArgb(),"Custom palette didn't persist");ApplyPalette(ColorPalette.All[2]);SaveControls(true);ResetControls();RestoreControls(true);Require(controls.Palette.SelectedIndex==3,"Named palette didn't restore");ResetControls();checks.Add("six palette previews, switching changes colors only, custom/named palette recognition and persistence");
            renderer.Appearance(Color.FromArgb(69,237,255),Color.FromArgb(69,237,255),Color.FromArgb(196,252,255));var plain=renderer.Capture(Sample(),640,400);SaveBackground(plain,Color.White,Path.Combine(profile,"effects-white.png"));SaveBackground(plain,Color.FromArgb(16,19,23),Path.Combine(profile,"effects-dark.png"));checks.Add("independent sizes/opacity, cached trail recoloring, live particle speed and zero-speed expiration, original appearance without outlines");
            // Validate actual composition, not just offscreen drawing. The
            // screenshot is restricted to our own temporary black test window.
            controls.HidePanel();inputTimer.Stop();StopAnimation(true);lastHealth=clock.ElapsedMilliseconds;
            {
                var area=Screen.PrimaryScreen.WorkingArea;var rect=new Rectangle(area.Left+Math.Max(0,(area.Width-640)/2),area.Top+Math.Max(0,(area.Height-400)/2),640,400);
                // Overlay suppresses GDI painting; a normal owned form below
                // provides a known opaque background for this capture instead.
                using(var backing=new TestBackground()){
                    backing.Bounds=rect;backing.Show();backing.Bounds=rect;Native.SetWindowPos(backing.Handle,new IntPtr(-1),rect.X,rect.Y,rect.Width,rect.Height,0x10|0x40);overlay.Bounds=rect;overlay.Display(true,true);var fx=Sample();renderer.Draw(fx);await Task.Delay(250);
                    using(var shot=new Bitmap(640,400)){using(var g=Graphics.FromImage(shot))g.CopyFromScreen(rect.Location,Point.Empty,shot.Size);foreach(var p in new[]{new Point(5,5),new Point(634,5),new Point(5,394),new Point(634,394)})Require(shot.GetPixel(p.X,p.Y).ToArgb()==Color.Black.ToArgb(),"Own test background occluded; capture discarded");shot.Save(Path.Combine(profile,"composed.png"));int cyan=0;for(int x=202;x<335;x++)for(int y=145;y<255;y++){var c=shot.GetPixel(x,y);if(c.G>c.R+30&&c.B>c.R+30)cyan++;}Require(cyan>100,"DirectComposition pixels not visible");}
                    AssertSafe();
                }
            }
            overlay.Bounds=SystemInformation.VirtualScreen;effects.Viewport=overlay.Bounds;StopAnimation(true);checks.Add("DirectComposition pixels visible on desktop-owned test surface");
            controls.ShowPanel();controls.PerformLayout();await TestPaletteMenu();checks.Add("dark palette field and popup, no white arrow, keyboard selection/open/Escape, menu choice closes and preserves effect settings");using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls.png"));}
            controls.SelectPage(1);using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-click.png"));}controls.SelectPage(2);controls.PerformLayout();using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-fragments.png"));}controls.SelectPage(0);
            controls.VisibleValue.Checked=false;using(var bitmap=new Bitmap(controls.Width,controls.Height)){controls.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(profile,"controls-off.png"));}controls.VisibleValue.Checked=true;Configure();
            controls.WindowState=FormWindowState.Minimized;Require(controls.Visible&&controls.WindowState==FormWindowState.Minimized&&controls.ShowInTaskbar&&overlay.Visible,"Normal minimize changes effects/taskbar");ShowControls();Require(controls.Visible&&controls.WindowState==FormWindowState.Normal,"Restore");controls.HidePanel();Require(!controls.Visible&&overlay.Visible,"Hide differs from minimize");
            controls.Updating=true;controls.EffectSize.Value=173;controls.TrailSpacing.Value=142;controls.ClickMin.Value=6;controls.ClickMax.Value=12;controls.ParticleSpeed.Value=225;controls.TrailFade.Value=320;controls.OpacityValue.Value=68;controls.RippleSize.Value=230;controls.FragmentSize.Value=182;controls.TrailColor.Value=Color.Red;controls.RippleColor.Value=Color.Blue;controls.FragmentColor.Value=Color.Green;controls.VisibleValue.Checked=false;controls.Updating=false;SaveControls(true);
            string saved=File.ReadAllText(ControlsPath);Require(!saved.Contains("glow")&&!saved.Contains("clickFragmentSize")&&!saved.Contains("trailGap")&&!saved.Contains("colorFadeMs"),"Removed advanced fields are still serialized");controls.VisibleValue.Checked=true;ResetControls();Require(controls.Numbers.Length==9&&controls.FragmentSize.Value==100&&controls.EffectSize.Value==100&&controls.RippleSize.Value==100&&controls.TrailSpacing.Value==100&&controls.ClickMin.Value==3&&controls.ClickMax.Value==5&&controls.TrailFade.Value==180,"Simple defaults reset");RestoreControls(true);
            Require(controls.EffectSize.Value==173&&controls.TrailSpacing.Value==142&&controls.ClickMin.Value==6&&controls.ClickMax.Value==12&&controls.ParticleSpeed.Value==225&&controls.TrailFade.Value==320&&controls.OpacityValue.Value==68&&controls.RippleSize.Value==230&&controls.FragmentSize.Value==182&&!controls.VisibleValue.Checked,"Simple settings persistence");Configure();Require(!overlay.Visible&&Math.Abs(effects.TrailFragmentSize-3.64)<.001&&effects.TrailFragmentSize==effects.ClickFragmentSize&&effects.TrailOpacity==effects.ClickOpacity,"Restored global opacity/shared particle size ignored");
            File.WriteAllText(ControlsPath,"{\"version\":10,\"clickCount\":9,\"clickCountJitter\":3,\"trailFragmentSize\":130,\"clickFragmentSize\":200,\"trailOpacity\":72}");RestoreControls(true);Require(controls.ClickMin.Value==6&&controls.ClickMax.Value==12&&controls.FragmentSize.Value==130&&controls.OpacityValue.Value==72,"Previous local settings migration");
            File.WriteAllText(ControlsPath,"{\"version\":6,\"trailColor\":\"#EF83AD\",\"rippleColor\":\"#DB5A91\",\"fragmentColor\":\"#FFE1EC\",\"trailFadeMs\":320,\"particles\":200,\"particleSpeed\":150}");RestoreControls(true);Require(controls.TrailColor.Value==ColorPalette.All[2].Trail&&controls.FragmentColor.Value==ColorPalette.All[2].Fragment&&controls.TrailFade.Value==320&&controls.TrailSpacing.Value==40&&controls.ClickMin.Value==7&&controls.ClickMax.Value==9,"Legacy preset/density migration");
            File.WriteAllText(ControlsPath,"{\"version\":7,\"particles\":0}");RestoreControls(true);Require(controls.TrailSpacing.Value==0&&controls.ClickMin.Value==0&&controls.ClickMax.Value==0,"Disabled legacy fragments enabled");
            File.WriteAllText(ControlsPath,"{\"version\":1,\"visible\":true,\"top\":false,\"monitor\":\"removed\",\"fps\":7,\"size\":125}");RestoreControls(true);Configure();Require(controls.VisibleValue.Checked&&overlay.Visible&&effects.Fps==60&&controls.FragmentSize.Value==125&&effects.TrailFragmentSize==effects.ClickFragmentSize,"Legacy global settings override shared behavior");
            File.WriteAllText(ControlsPath,"{\"version\":12,\"glow\":300,\"fragmentSize\":140}");RestoreControls(true);Configure();Require(controls.Numbers.Length==9&&controls.FragmentSize.Value==140&&effects.Commands.All(c=>c.Kind==0||c.Kind==2||c.Kind==6),"Legacy glow setting restores soft effects");
            bool master=controls.VisibleValue.Checked;typeof(Control).GetMethod("OnClick",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Invoke(controls.SwitchStatus,new object[]{EventArgs.Empty});Require(controls.VisibleValue.Checked==master&&controls.SwitchStatus.Cursor==Cursors.Default&&controls.VisibleValue.Width<=52,"Switch status text is interactive or inside hit area");controls.VisibleValue.Checked=!master;Require(controls.SwitchStatus.Text=="關閉","Status not synchronized");controls.VisibleValue.Checked=master;
            foreach(var entry in shell)Require(!entry.Value||!Native.IsWindow(entry.Key)||Native.IsWindowEnabled(entry.Key),"Shell disabled");checks.Add("compact settings persistence/migration, shared fragment size/opacity, status label does not toggle, normal minimize/hide/exit");
            var result=new{passed=true,hardware=renderer.Hardware,checks,visual,whiteProfileSummary,frames=Frames,layerRepairs};controls.Close();Require(quitting&&controls.IsDisposed,"X didn't exit");File.WriteAllText(report,Json.Serialize(result));
        }catch(Exception e){File.WriteAllText(report,Json.Serialize(new{passed=false,error=e.ToString(),checks,trace=layerTrace.ToArray()}));Quit(1);}
    }
    static void SaveBackground(byte[] pixels,Color background,string path){var result=(byte[])pixels.Clone();for(int i=0;i<result.Length;i+=4){int a=pixels[i+3];result[i]=(byte)Math.Min(255,pixels[i]+background.B*(255-a)/255);result[i+1]=(byte)Math.Min(255,pixels[i+1]+background.G*(255-a)/255);result[i+2]=(byte)Math.Min(255,pixels[i+2]+background.R*(255-a)/255);result[i+3]=255;}D2DRenderer.Save(result,640,400,path);}
}
sealed class TestBackground : Form {
    public TestBackground(){FormBorderStyle=FormBorderStyle.None;AutoScaleMode=AutoScaleMode.None;ShowInTaskbar=false;BackColor=Color.Black;Enabled=false;TopMost=true;}
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80|0x20;return p;}}
}
