using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Reflection;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;

// Offscreen GPU verification. No cursor movement, overlay, tray, settings or
// changes to other applications; the HWND remains hidden for its whole life.
static class ClickWaveTests {
    const int W=320,H=240,CX=160,CY=120;
    static void Require(bool ok,string message){if(!ok)throw new Exception(message);}
    static CursorEffects Click(double age=0){
        var fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,W,H)};
        fx.Configure(false,true,1,1,1,60);fx.Input(CX,CY,true,true);
        Advance(fx,age);return fx;
    }
    static CursorEffects VisualClick(double age=0){
        // Constant .5 is useful for assertions, but stacks every triangle and
        // both rings at the same phase. Previews must use real distinct draws.
        uint seed=5824;var fx=new CursorEffects(()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;}){Viewport=new Rectangle(0,0,W,H)};
        fx.Configure(false,true,1,1,1,60);fx.SetClickCountRange(4,4);fx.Input(CX,CY,true,true);Advance(fx,age);return fx;
    }
    static void Advance(CursorEffects fx,double age){while(age>1e-9){double step=Math.Min(.05,age);fx.Draw(step);age-=step;}fx.Draw(0);}
    static int CenterAlpha(byte[] pixels){return pixels[(CY*W+CX)*4+3];}
    static void Save(byte[] pixels,Color background,string path){
        var result=(byte[])pixels.Clone();for(int i=0;i<result.Length;i+=4){int a=pixels[i+3];result[i]=(byte)Math.Min(255,pixels[i]+background.B*(255-a)/255);result[i+1]=(byte)Math.Min(255,pixels[i+1]+background.G*(255-a)/255);result[i+2]=(byte)Math.Min(255,pixels[i+2]+background.R*(255-a)/255);result[i+3]=255;}
        D2DRenderer.Save(result,W,H,path);
    }
    public static int Run(string output,string baseline=null,string production=null){
        // Keep initialization in a separate method from references to the
        // beforefieldinit renderer so the CLR cannot eagerly load its exports.
        Directory.CreateDirectory(output);EmbeddedRuntime.Initialize(Path.Combine(output,"runtime"));
        return Capture(output,baseline,production);
    }
    static int Capture(string output,string baseline,string production){
        var checks=new List<string>();var samples=new List<object>();
        try{
            using(var window=new Form())using(var renderer=new D2DRenderer(window.Handle)){
                var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
                var fx=Click();Require(fx.ClickCores.Count==1&&fx.Rings.Count==2,"One click must emit one core and two rings");
                var raw=renderer.Capture(fx,W,H);int birth=(CY*W+CX)*4;Require(CenterAlpha(raw)>245&&raw[birth]>raw[birth+2]&&raw[birth+2]>230,"Click birth needs a slightly palette-tinted white center");
                fx=Click(.04);fx.Particles.Clear();fx.Rings.Clear();fx.Draw(0);raw=renderer.Capture(fx,W,H);
                int center=(CY*W+CX)*4;Require(raw[center]>raw[center+2]+20&&CenterAlpha(raw)>195,"Early colored water is dim instead of the reference's strong blue pulse");
                int previous=CenterAlpha(raw);fx.Draw(.06);raw=renderer.Capture(fx,W,H);Require(CenterAlpha(raw)<previous&&CenterAlpha(raw)>0,"Center does not fade independently");
                var core=fx.Commands.Single(c=>c.Kind==8);var surface=fx.Surface();
                for(int y=0;y<H;y++)for(int x=0;x<W;x++){
                    int i=(y*W+x)*4,a=raw[i+3];Require(raw[i]<=a&&raw[i+1]<=a&&raw[i+2]<=a,"Invalid premultiplied desktop pixel");
                    if(a>0)Require(surface.Contains(x,y),"Compact surface clips the center wave");
                    if((x-CX)*(x-CX)+(y-CY)*(y-CY)>(core.X2+2)*(core.X2+2))Require(a<=40,"Outer rays turn into a second opaque water disc");
                }
                fx.Draw(.1);fx.Draw(.051);Require(fx.ClickCores.Count==0&&renderer.Capture(fx,W,H).All(b=>b==0),"Core outlives 250ms or leaves a square");
                fx=Click(.25);Require(fx.ClickCores.Count==0&&fx.Rings.Count==2&&fx.Commands.Count(c=>c.Kind==6)==2,"Core expiration also removes outer rings");
                checks.Add("palette-tinted white birth, bright colored water, independent 250ms fade, circular coverage, valid premultiplied pixels and bounded surface");
                fx=Click(.0166667);raw=renderer.Capture(fx,W,H);
                Require(raw[birth+2]<225&&raw[birth+1]>raw[birth+2]+5&&raw[birth]>raw[birth+2]+12,"The next 60fps frame stays white or loses the pale blue pulse: "+raw[birth+2]+","+raw[birth+1]+","+raw[birth]);
                var timed=Click(.05);timed.InputTimed(CX,CY,true,true,false,.014);timed.Draw(.016);
                Require(Math.Abs(timed.ClickCores.Last().Age-.002)<1e-8&&Math.Abs(timed.ClickCores.First().Age-.066)<1e-8,"Newborn click is aged by the entire previous frame");
                raw=renderer.Capture(timed,W,H);Require(raw[birth+2]>240,"A late-frame birth skips its white flash");
                checks.Add("next 60fps frame is blue; late-frame input uses its own birth age while existing clicks advance normally");
                var flashSamples=new List<object>();int lastFlash=256;double birthFlashRadius=0;
                foreach(double age in new[]{0,.0166667,.0333333,.05,.0833333,.1}){
                    var pulse=VisualClick(age);var flash=pulse.Commands.Single(c=>c.Kind==9);var waterCommand=pulse.Commands.Single(c=>c.Kind==8);
                    Require(waterCommand.Width==0,"White light is mixed back into the expanding colored water");
                    if(age==0)birthFlashRadius=flash.X2;Require(Math.Abs(flash.X2-birthFlashRadius)<.001&&(age<.033||flash.X2<waterCommand.X2),"Birth flash grows with the colored wave");
                    var onlyFlash=new CursorEffects();onlyFlash.Commands.Add(flash);var flashPixels=renderer.Capture(onlyFlash,W,H);int light=CenterAlpha(flashPixels);
                    Require(light<lastFlash,"Initial white flash rebrightens after birth");lastFlash=light;
                    if(age>=.05)Require(light<30,"50-100ms flash residue leaves an opaque inner disc");
                    if(age>.08)Require(light<=2,"Late single-click white flash leaves a separate bright zone");
                    flashSamples.Add(new{ageMs=age*1000,centerAlpha=light,radiusPx=flash.X2,waterRadiusPx=waterCommand.X2});
                    Save(flashPixels,Color.FromArgb(16,19,23),Path.Combine(output,"birth-flash-"+((int)Math.Round(age*1000)).ToString("D3")+".png"));
                }
                File.WriteAllText(Path.Combine(output,"birth-flash.json"),new JavaScriptSerializer().Serialize(flashSamples));
                checks.Add("actual initial flash peaks at birth, only decays at fixed radius, drops below alpha30 at50ms and alpha2 at83ms; colored water carries no white fill");
                fx=Click(.033);fx.Rings.Clear();fx.Particles.Clear();fx.Draw(0);raw=renderer.Capture(fx,W,H);int minRed=255,maxRed=0,outerBlue=0;double bodyRadius=fx.Commands.Single(c=>c.Kind==8).X2;
                for(int y=0;y<H;y++)for(int x=0;x<W;x++){
                    int at=(y*W+x)*4;double distance=Math.Sqrt((x-CX)*(x-CX)+(y-CY)*(y-CY));
                    if(distance<bodyRadius-5&&raw[at+3]>190){minRed=Math.Min(minRed,raw[at+2]);maxRed=Math.Max(maxRed,raw[at+2]);}
                    if(distance>bodyRadius+2&&raw[at+3]>2&&raw[at]>raw[at+2]+2)outerBlue++;
                }
                Require(maxRed-minRed>=4&&outerBlue>8,"Early water is a uniform opaque disc without external blue rays");
                var whiteBirth=Click();whiteBirth.Rings.Clear();whiteBirth.Particles.Clear();whiteBirth.Draw(0);var whitePixels=renderer.Capture(whiteBirth,W,H);double whiteRadius=whiteBirth.Commands.Single(c=>c.Kind==9).X2;int tintedEdge=0;
                for(int sample=0;sample<96;sample++){double angle=(sample+.5)*Math.PI/48;int x=(int)Math.Round(CX+whiteRadius*.92*Math.Cos(angle)),y=(int)Math.Round(CY+whiteRadius*.92*Math.Sin(angle)),at=(y*W+x)*4;int a=whitePixels[at+3];if(a>100&&(whitePixels[at]-whitePixels[at+2])*255.0/a>10)tintedEdge++;}
                Require(tintedEdge>24,"The birth-white wave has a plain white hard edge instead of a blue-tinted transition");
                var maskProbe=new CursorEffects();maskProbe.Commands.Add(new DrawCommand(6,CX,CY,70,0,.7,.4,.45));renderer.Appearance(Color.White,Color.White,Color.White);var maskPixels=renderer.Capture(maskProbe,W,H);
                for(int at=0;at<maskPixels.Length;at+=4)for(int channel=0;channel<3;channel++)Require(Math.Abs(maskPixels[at+channel]-maskPixels[at+3])<=2,"Alpha clipping makes a white rim gray/black during premultiplication");
                renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
                checks.Add("nonuniform early water with bounded blue exterior rays; partially clipped white rim preserves RGB=alpha instead of darkening its ends");
                // Cover the entire overlap, independent random ring sizes and
                // UI scales. The old independent size clocks leaked outside.
                foreach(double scale in new[]{.25,1.0,3.0}){
                    int randomIndex=0;var bounded=new CursorEffects(()=>randomIndex++%6<3?0:1){Viewport=new Rectangle(0,0,W,H)};
                    bounded.Configure(false,true,scale,1,1,60);bounded.Customize(1,scale,1,1,1,1);bounded.Input(CX,CY,true,true);
                    for(int frame=0;frame<100;frame++){
                        bounded.Draw(frame==0?0:.002);
                        var fill=bounded.Commands.Single(c=>c.Kind==8);double inner=bounded.Commands.Where(c=>c.Kind==6).Min(c=>(double)c.X2);
                        Require(Math.Abs(fill.X2-inner)<.0001,"Center boundary does not coincide with the ring at "+frame*2+"ms, scale "+scale);
                    }
                }
                checks.Add("0-198ms water and outer rim share the same expanding envelope at every UI scale; the second rim overlaps inward");
                fx=VisualClick(.1);raw=renderer.Capture(fx,W,H);
                var clickBounds=fx.Surface();for(int y=0;y<H;y++)for(int x=0;x<W;x++){
                    int i=(y*W+x)*4,a=raw[i+3];if(a>0)Require(clickBounds.Contains(x,y),"Compact surface clips expanded ring coverage");
                    Require(raw[i]<=a&&raw[i+1]<=a&&raw[i+2]<=a,"Combined water/ring/fragments contain invalid premultiplied desktop pixels");
                }
                var growing=fx.Commands.Where(c=>c.Kind==2).ToArray();
                Require(growing.Length==4&&growing.All(c=>c.X2>.96&&c.Width>3),"Growing click triangles must remain white near peak size");
                var colored166=VisualClick(1.0/6).Commands.Where(c=>c.Kind==2).ToArray();Require(colored166.Average(c=>c.X2)<.25,"166ms fragments stay white and hide the deeper selected tint");
                foreach(double age in new[]{.033,.05}){
                    var early=VisualClick(age).Commands.Where(c=>c.Kind==2).ToArray();
                    double areaRatio=early.Zip(growing,(a,b)=>a.Width*a.Width/(b.Width*b.Width)).Average();
                    Require(age<.04?areaRatio>.10&&areaRatio<.28:areaRatio>.30&&areaRatio<.65,"Triangle growth lags behind 60fps measured 33/50ms area ratios");
                }
                Require(growing.Select(c=>new{c.X,c.Y}).Distinct().Count()==4,"Preview stacks all fragments at one point");
                var rim=fx.Commands.Where(c=>c.Kind==6).ToArray();
                var ringOnly=new CursorEffects();ringOnly.Commands.AddRange(rim);var ringPixels=renderer.Capture(ringOnly,W,H);
                int brightCyan=0;for(int i=0;i<ringPixels.Length;i+=4)if(ringPixels[i+3]>80&&ringPixels[i+1]>ringPixels[i+2]+30)brightCyan++;
                Require(brightCyan>60,"Blue template outer ring is white instead of cyan");
                int coverage=0;double ringRadius=rim[0].X2;
                for(int i=0;i<128;i++){double angle=(i+.5)*Math.PI/64;int peak=0;for(int dr=-5;dr<=3;dr++){int x=(int)Math.Round(CX+(ringRadius+dr)*Math.Cos(angle)),y=(int)Math.Round(CY+(ringRadius+dr)*Math.Sin(angle));peak=Math.Max(peak,ringPixels[(y*W+x)*4+3]);}if(peak>64)coverage++;}
                Require(coverage>20&&coverage<112,"Default overlapping arc masks produce a uniform complete bright circle");
                fx=VisualClick(.25);var shrinking=fx.Commands.Where(c=>c.Kind==2).ToArray();
                Require(shrinking.Length==4&&shrinking.All(c=>c.Alpha>=.41&&c.X2<.25)&&shrinking.Zip(growing,(a,b)=>a.Width<b.Width).All(v=>v),"250ms click fragments must stay legible and colored while shrinking");
                checks.Add("seeded four-fragment preview, white size peak near 100ms, legible shrinking colored fragments at 250ms, cyan outer ring");
                foreach(double age in new[]{.05,.083333,.1,.166667,.25,.333333}){
                    var arcs=VisualClick(age);arcs.Particles.Clear();arcs.ClickCores.Clear();arcs.Draw(0);var pixels=renderer.Capture(arcs,W,H);double arcRadius=arcs.Commands.First(c=>c.Kind==6).X2;int lit=0;
                    for(int sample=0;sample<128;sample++){double angle=(sample+.5)*Math.PI/64;int peak=0;for(int dr=-6;dr<=3;dr++){int x=(int)Math.Round(CX+(arcRadius+dr)*Math.Cos(angle)),y=(int)Math.Round(CY+(arcRadius+dr)*Math.Sin(angle));peak=Math.Max(peak,pixels[(y*W+x)*4+3]);}if(peak>32)lit++;}
                    Require(lit>16&&lit<108,"Overlapping birth arcs become a uniform complete circle at "+age+"s: "+lit+"/128");
                }
                uint radialSeed=19427;
                foreach(double scale in new[]{.25,1.0,3.0})for(int cohort=0;cohort<24;cohort++){
                    var expanding=new CursorEffects(()=>{radialSeed=unchecked(radialSeed*1664525+1013904223);return radialSeed/4294967296.0;}){Viewport=new Rectangle(0,0,W,H)};
                    expanding.Configure(false,true,1,1,1,60);expanding.Customize(1,scale,1,1,1,1);expanding.Input(CX,CY,true,true);
                    for(int frame=0;frame<=30;frame++){
                        expanding.Draw(frame==0?0:1.0/60);double expandingRadius=expanding.Commands.Where(c=>c.Kind==6).Max(c=>(double)c.X2);
                        foreach(var particle in expanding.Particles){double dx=particle.X-CX,dy=particle.Y-CY;Require(Math.Sqrt(dx*dx+dy*dy)>expandingRadius,"Click fragment center falls inside its expanding rim at "+frame+"/60s, scale "+scale);}
                        if(scale==1&&frame>=2&&frame<=6){
                            foreach(var fragment in expanding.Commands.Where(c=>c.Kind==2)){double dx=fragment.X-CX,dy=fragment.Y-CY,gap=Math.Sqrt(dx*dx+dy*dy)-expandingRadius;Require(gap<fragment.Width*.5+1,"Growing triangle is detached from the expanding rim at "+frame+"/60s: "+gap);}
                        }
                    }
                }
                checks.Add("50-333ms overlapping arcs retain a substantial gap; 72 cohorts keep fragment centers outside through 500ms, with growing triangle bodies adjoining/overlapping the rim at 33-100ms");
                var red=Color.FromArgb(255,64,126);renderer.Appearance(blue.Trail,red,blue.Fragment);fx=Click(.04);raw=renderer.Capture(fx,W,H);
                Require(raw[center+2]>raw[center]+30,"Core ignores a red/pink ripple palette");
                fx.Opacity=.4;fx.Draw(0);var dim=renderer.Capture(fx,W,H);Require(Math.Abs(CenterAlpha(dim)/(double)CenterAlpha(raw)-.4)<.03,"Core ignores global opacity");
                fx=Click(.04);double radius=fx.Commands.Single(c=>c.Kind==8).X2;fx.Customize(1,2,1,1,1,1);fx.Draw(0);Require(Math.Abs(fx.Commands.Single(c=>c.Kind==8).X2/radius-2)<.001,"Core ignores ripple size");
                Require(Math.Abs(fx.Commands.Single(c=>c.Kind==8).Alpha-(CursorEffects.WaterOpacity-fx.Commands.Single(c=>c.Kind==9).Alpha))<.001,"Water opacity reduction differs from .80 while birth flash remains independent");
                fx.SetClickSpeed(0);Advance(fx,.211);Require(fx.ClickCores.Count==0,"Particle speed freezes core expiration");
                fx=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,W,H)};fx.Input(CX,CY,false,false);Require(fx.ClickCores.Count==0,"Hover emits a core");
                fx.Input(CX,CY,true,true,true);Require(fx.ClickCores.Count==0,"Blocked click emits a core");fx.Configure(true,false,1,1,1,60);fx.Input(CX,CY,true,true);Require(fx.ClickCores.Count==0,"Disabled clicks emit a core");
                fx.Configure(false,true,1,1,0,60);fx.Input(CX,CY,true,true);Require(fx.ClickCores.Count==0,"Transparent clicks emit a core");
                fx=Click();for(int i=0;i<256;i++)fx.Input(CX,CY,true,true);Require(fx.ClickCores.Count==8&&fx.Rings.Count==16&&fx.Commands.Count<=2048,"Rapid clicks exceed a bounded cohort");fx.Clear();Require(fx.ClickCores.Count==0&&fx.Alive==0,"Clear keeps center waves alive");
                checks.Add("palette, opacity, ripple scale, speed-independent lifetime, disabled/blocked/hover input, clear and rapid-click bounds");
                var ages=new[]{0,.016,.033,.05,.083,.1,.133,.167,.2,.25,.333,.45,.583,.7};
                foreach(var palette in new[]{blue,ColorPalette.Sakura}){
                    string name=palette==blue?"blue":"pink";renderer.Appearance(palette.Trail,palette.Ripple,palette.Fragment);
                    foreach(double age in ages){fx=VisualClick(age);raw=renderer.Capture(fx,W,H);samples.Add(new{palette=name,ageMs=(int)Math.Round(age*1000),centerAlpha=CenterAlpha(raw),cores=fx.ClickCores.Count,rings=fx.Rings.Count});D2DRenderer.Save(raw,W,H,Path.Combine(output,name+"-"+((int)Math.Round(age*1000)).ToString("D3")+"-alpha.png"));Save(raw,Color.FromArgb(76,111,159),Path.Combine(output,name+"-"+((int)Math.Round(age*1000)).ToString("D3")+".png"));}
                    for(int frame=0;frame<48;frame++){fx=VisualClick(frame/60.0);raw=renderer.Capture(fx,W,H);D2DRenderer.Save(raw,W,H,Path.Combine(output,name+"-animation-"+frame.ToString("D2")+"-alpha.png"));Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,name+"-animation-"+frame.ToString("D2")+".png"));}
                }
                CaptureRingShape(renderer,output,checks);
                CaptureLayering(renderer,output,checks);
                CaptureMotion(renderer,output,checks);
                CapturePaletteAndShapes(renderer,output,checks);
                foreach(var reference in new[]{new{path=baseline,core=false},new{path=production,core=true}}){
                    if(string.IsNullOrEmpty(reference.path))continue;
                    // LoadFile permits the downloaded and rebuilt EXEs to have
                    // the same assembly identity while keeping their code apart.
                    var assembly=Assembly.LoadFile(Path.GetFullPath(reference.path));var native=assembly.GetType("EmbeddedRuntime");var oldFx=assembly.GetType("CursorEffects");var oldRenderer=assembly.GetType("D2DRenderer");
                    string label=reference.core?"production":"before";
                    native.GetMethod("Initialize",BindingFlags.Static|BindingFlags.Public|BindingFlags.NonPublic).Invoke(null,new object[]{Path.Combine(output,label+"-runtime")});
                    using(var oldWindow=new Form())using(var old=(IDisposable)Activator.CreateInstance(oldRenderer,new object[]{oldWindow.Handle})){
                        oldRenderer.GetMethod("Appearance").Invoke(old,new object[]{blue.Trail,blue.Ripple,blue.Fragment});renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
                        foreach(double age in new[]{.04,.32}){
                            var oldEffects=Activator.CreateInstance(oldFx,new object[]{new Func<double>(()=>.5)});oldFx.GetField("Viewport").SetValue(oldEffects,new Rectangle(0,0,W,H));
                            oldFx.GetMethod("Configure").Invoke(oldEffects,new object[]{false,true,1.0,1.0,1.0,60});oldFx.GetMethod("Input").Invoke(oldEffects,new object[]{(double)CX,(double)CY,true,true,false});
                            double remaining=age;while(remaining>1e-9){double step=Math.Min(.05,remaining);oldFx.GetMethod("Draw").Invoke(oldEffects,new object[]{step});remaining-=step;}oldFx.GetMethod("Draw").Invoke(oldEffects,new object[]{0.0});
                            var before=(byte[])oldRenderer.GetMethod("Capture").Invoke(old,new object[]{oldEffects,W,H});var after=renderer.Capture(Click(age),W,H);
                            Require(reference.core?CenterAlpha(before)>0||age>=.2:CenterAlpha(before)==0,"Reference EXE has the wrong center behavior");
                            if(age<.2)Require(CenterAlpha(after)>80,"Center correction has no measurable output");
                            if(reference.core)Require(before.Zip(after,(a,b)=>Math.Abs(a-b)).Max()<=1,"Production EXE has different GPU pixels");
                            Save(before,Color.FromArgb(76,111,159),Path.Combine(output,label+"-"+(int)(age*1000)+".png"));Save(after,Color.FromArgb(76,111,159),Path.Combine(output,"after-"+(int)(age*1000)+".png"));
                        }
                    }
                    // Click rendering intentionally changes; still require the
                    // complete drag pixels to remain identical to the release.
                    using(var oldWindow=new Form())using(var old=(IDisposable)Activator.CreateInstance(oldRenderer,new object[]{oldWindow.Handle})){
                        oldRenderer.GetMethod("Appearance").Invoke(old,new object[]{blue.Trail,blue.Ripple,blue.Fragment});renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
                        var legacyTrail=Activator.CreateInstance(oldFx,new object[]{new Func<double>(()=>.5)});oldFx.GetField("Viewport").SetValue(legacyTrail,new Rectangle(0,0,W,H));oldFx.GetMethod("Configure").Invoke(legacyTrail,new object[]{true,false,1.0,0.0,1.0,60});
                        var current=new CursorEffects(()=>.5){Viewport=new Rectangle(0,0,W,H)};current.Configure(true,false,1,0,1,60);
                        for(int point=0;point<6;point++){
                            double x=30+point*45,y=100+20*Math.Sin(point);oldFx.GetMethod("Input").Invoke(legacyTrail,new object[]{x,y,point==0,true,false});current.Input(x,y,point==0,true);
                            oldFx.GetMethod("Draw").Invoke(legacyTrail,new object[]{.012});current.Draw(.012);
                        }
                        var a=(byte[])oldRenderer.GetMethod("Capture").Invoke(old,new object[]{legacyTrail,W,H});var b=renderer.Capture(current,W,H);
                        Require(a.Zip(b,(x,y)=>Math.Abs(x-y)).Max()<=1,"Click correction changes released drag pixels");
                    }
                    checks.Add(reference.core?"rebuilt production EXE matches verified click GPU pixels and unchanged trail line":"downloaded release center is empty; corrected click is visible; trail line pixels match baseline");
                }
                File.WriteAllText(Path.Combine(output,"result.json"),new JavaScriptSerializer().Serialize(new{passed=true,hardware=renderer.Hardware,checks,samples}));
            }
            return 0;
        }catch(Exception error){File.WriteAllText(Path.Combine(output,"result.json"),new JavaScriptSerializer().Serialize(new{passed=false,error=error.ToString(),checks}));return 1;}
    }
    static int RadialAlpha(byte[] raw,double radius,double angle){
        int x=(int)Math.Round(CX+radius*Math.Cos(angle)),y=(int)Math.Round(CY+radius*Math.Sin(angle));return raw[(y*W+x)*4+3];
    }
    static void CapturePaletteAndShapes(D2DRenderer renderer,string output,List<string> checks){
        var hierarchy=new List<object>();
        foreach(var palette in ColorPalette.All){
            renderer.Appearance(palette.Trail,palette.Ripple,palette.Fragment);var fx=VisualClick(1.0/6);
            var water=new CursorEffects();water.Commands.AddRange(fx.Commands.Where(c=>c.Kind==8||c.Kind==9));var waterPixels=renderer.Capture(water,W,H);int at=(CY*W+CX)*4,a=waterPixels[at+3];
            double waterLight=(waterPixels[at+2]*.2126+waterPixels[at+1]*.7152+waterPixels[at]*.0722)*255/a;
            var fragments=new CursorEffects();fragments.Commands.AddRange(fx.Commands.Where(c=>c.Kind==2));var fragmentPixels=renderer.Capture(fragments,W,H);var lights=new List<double>();
            foreach(var fragment in fragments.Commands){int x=(int)Math.Round(fragment.X),y=(int)Math.Round(fragment.Y),i=(y*W+x)*4,alpha=fragmentPixels[i+3];Require(alpha>20,"166ms fragment center disappeared");lights.Add((fragmentPixels[i+2]*.2126+fragmentPixels[i+1]*.7152+fragmentPixels[i]*.0722)*255/alpha);}
            Require(a>30,"166ms water disappeared before its fade completed");
            var selected=new[]{palette.Ripple.R,palette.Ripple.G,palette.Ripple.B};var sampled=new[]{waterPixels[at+2]*255.0/a,waterPixels[at+1]*255.0/a,waterPixels[at]*255.0/a};
            Require(sampled.Zip(selected,(actual,expected)=>Math.Abs(actual-expected)).Max()<12,"Actual 166ms water loses the selected palette hue in "+palette.Name);
            hierarchy.Add(new{palette=palette.Name,ageMs=1000.0/6,waterStraightRGB=sampled,selectedWaterRGB=selected,waterStraightLuminance=waterLight,fragmentMeanStraightLuminance=lights.Average(),fragmentWhiteMean=fragments.Commands.Average(c=>c.X2),waterAlpha=a});
            Save(renderer.Capture(fx,W,H),Color.FromArgb(76,111,159),Path.Combine(output,"palette-166-"+ColorPalette.All.ToList().IndexOf(palette)+".png"));
        }
        File.WriteAllText(Path.Combine(output,"palette-hierarchy.json"),new JavaScriptSerializer().Serialize(hierarchy));
        var blue=ColorPalette.Blue;renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        for(int shape=0;shape<FragmentShapes.Names.Length;shape++)for(int frame=0;frame<42;frame++){
            var fx=VisualClick(frame/60.0);fx.SetFragmentShape((FragmentShape)shape);fx.Draw(0);Save(renderer.Capture(fx,W,H),Color.FromArgb(16,19,23),Path.Combine(output,"shape-"+shape+"-animation-"+frame.ToString("D2")+".png"));
        }
        checks.Add("all seven actual 166ms GPU water centers retain their selected saturated hue and fade coverage after unpremultiplication; five selected shapes captured across their full click lifetime");
    }
    static double ArcDirection(byte[] pixels){
        double xsum=0,ysum=0;for(int y=0;y<H;y++)for(int x=0;x<W;x++){int a=pixels[(y*W+x)*4+3];xsum+=(x-CX)*a;ysum+=(y-CY)*a;}return Math.Atan2(ysum,xsum);
    }
    static void CaptureRingShape(D2DRenderer renderer,string output,List<string> checks){
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        var fx=VisualClick(.033333);fx.Rings.Clear();fx.Particles.Clear();fx.Draw(0);var raw=renderer.Capture(fx,W,H);double radius=fx.Commands.Single(c=>c.Kind==8).X2;int outerMax=0;
        for(int y=0;y<H;y++)for(int x=0;x<W;x++)if((x-CX)*(x-CX)+(y-CY)*(y-CY)>radius*radius*1.18*1.18)outerMax=Math.Max(outerMax,raw[(y*W+x)*4+3]);
        Require(outerMax<=2,"33ms blue halo extends too far beyond the water boundary");
        fx=VisualClick(.1);fx.Rings.RemoveAt(1);fx.Particles.Clear();fx.ClickCores.Clear();fx.Draw(0);double directionBefore=ArcDirection(renderer.Capture(fx,W,H));
        fx.Draw(.05);double directionAfter=ArcDirection(renderer.Capture(fx,W,H));double delta=Math.Atan2(Math.Sin(directionAfter-directionBefore),Math.Cos(directionAfter-directionBefore));
        Require(delta<-.15&&delta>-.8,"GPU arc moves clockwise or jumps instead of rotating counterclockwise: "+delta);
        renderer.Appearance(Color.White,Color.White,Color.White);var arc=new CursorEffects();arc.Commands.Add(new DrawCommand(6,CX,CY,70,0,.82,0,1));raw=renderer.Capture(arc,W,H);
        Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"crescent-taper.png"));
        var profiles=new List<Tuple<int,int>>();
        for(int sample=0;sample<256;sample++){
            double angle=(sample+.5)*Math.PI/128;var values=new int[23];for(int r=0;r<values.Length;r++)values[r]=RadialAlpha(raw,52+r,angle);int peak=values.Max(),width=values.Count(v=>v>peak*.5);
            if(peak>40)profiles.Add(Tuple.Create(peak,width));
        }
        int maxPeak=profiles.Max(p=>p.Item1);var crest=profiles.Where(p=>p.Item1>maxPeak*.9).Select(p=>(double)p.Item2).ToArray();var tips=profiles.Where(p=>p.Item1<maxPeak*.55).Select(p=>(double)p.Item2).ToArray();
        Require(crest.Length>5&&tips.Length>5&&crest.Average()>=3&&tips.Average()<crest.Average()*.85,"Crescent ends merely fade instead of narrowing: crest="+crest.Average()+", tips="+(tips.Length>0?tips.Average():0));
        File.WriteAllText(Path.Combine(output,"ring-shape.json"),new JavaScriptSerializer().Serialize(new{halo33msMaxAlphaBeyond118Percent=outerMax,counterclockwiseDegrees=delta*180/Math.PI,crestWidthPixels=crest.Average(),tipWidthPixels=tips.Average(),note="GPU alpha full width at half of each ray's own peak; excludes uniform opacity dimming"}));
        renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        checks.Add("33ms halo remains inside 1.18 water radius; actual GPU arc turns counterclockwise; late crescent tips narrow geometrically at half-local-peak instead of only fading");
    }
    static void CaptureLayering(D2DRenderer renderer,string output,List<string> checks){
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        var fx=VisualClick(.25);fx.Particles.Clear();fx.ClickCores.Clear();fx.Draw(0);var raw=renderer.Capture(fx,W,H);
        Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"layered-rim-250ms.png"));
        double radius=fx.Commands.First(c=>c.Kind==6).X2;int separatedRays=0;
        for(int sample=0;sample<128;sample++){
            double angle=(sample+.5)*Math.PI/64;var profile=new int[20];
            for(int r=0;r<profile.Length;r++)profile[r]=RadialAlpha(raw,radius-16+r,angle);
            bool separated=false;
            // At the smaller 60px scale the 6.5% inset is about three
            // desktop pixels. Keep the same peak/valley contrast requirement.
            for(int a=1;a<profile.Length-4;a++)for(int b=a+3;b<Math.Min(a+9,profile.Length-1);b++){
                int low=255;for(int middle=a+1;middle<b;middle++)low=Math.Min(low,profile[middle]);
                if(profile[a]>80&&profile[b]>80&&profile[a]>=profile[a-1]&&profile[a]>=profile[a+1]&&profile[b]>=profile[b-1]&&profile[b]>=profile[b+1]&&low<Math.Min(profile[a],profile[b])*.88)separated=true;
            }
            if(separated)separatedRays++;
        }
        Require(separatedRays>=8,"250ms overlapping rims merge into one radial stripe: "+separatedRays+" separated rays");
        var swept=new bool[128];int maxInstant=0,earlyCoverage=0,midCoverage=0,lateCoverage=0;
        fx=VisualClick();fx.Particles.Clear();fx.ClickCores.Clear();
        for(int frame=0;frame<=30;frame++){
            fx.Draw(frame==0?0:1.0/60);raw=renderer.Capture(fx,W,H);radius=fx.Commands.First(c=>c.Kind==6).X2;int instant=0;
            for(int sample=0;sample<128;sample++){
                double angle=(sample+.5)*Math.PI/64;int peak=0;for(int dr=-14;dr<=3;dr++)peak=Math.Max(peak,RadialAlpha(raw,radius+dr,angle));
                if(peak>32){swept[sample]=true;instant++;}
            }
            maxInstant=Math.Max(maxInstant,instant);
            if(frame==6)earlyCoverage=instant;if(frame==20)midCoverage=instant;if(frame==27)lateCoverage=instant;
        }
        Require(swept.Count(v=>v)>115&&maxInstant>90&&maxInstant<112,"Single-click arcs fail to substantially surround the center or form a rigid whole circle: "+swept.Count(v=>v)+" swept, "+maxInstant+" instant");
        Require(earlyCoverage>=100&&midCoverage<earlyCoverage&&lateCoverage<earlyCoverage*.55,"Actual 100/333/450ms ring sequence fails to form broad coverage then contract to a short crescent: "+earlyCoverage+","+midCoverage+","+lateCoverage);
        var rapidSamples=new List<object>();
        foreach(double interval in new[]{.05,.1})foreach(double age in new[]{.006,.012,1.0/60}){
            fx=VisualClick();for(int click=0;click<4;click++){Advance(fx,interval);fx.Input(CX,CY,true,true);}Advance(fx,age);raw=renderer.Capture(fx,W,H);
            var isolated=renderer.Capture(VisualClick(age),W,H);int center=(CY*W+CX)*4;
            Require(raw[center+2]>=Math.Min(250,isolated[center+2]+30)&&raw[center+1]>240&&raw[center]>245,"Rapid clicks hide the new white pulse behind earlier blue water: interval="+interval+", age="+age+", RGB="+raw[center+2]+","+raw[center+1]+","+raw[center]+", isolatedR="+isolated[center+2]);
            // A full 16.7ms render interval allows the original white pulse to
            // cool toward blue; a 6/12ms pulse still needs the near-white peak.
            if(interval<.06)Require(raw[center+2]>(age<.015?240:230),"50ms repeated clicks lose their white center between input and render: age="+age+", R="+raw[center+2]);
            // At 50ms spacing, the previous water must bridge the smaller
            // newborn disc to its own older outer rim, rather than a black gap.
            if(interval<.06){double oldRadius=fx.Commands.Where(c=>c.Kind==8).Max(c=>(double)c.X2),newRadius=fx.Commands.Where(c=>c.Kind==8).Min(c=>(double)c.X2);int visible=0;
                for(int sample=0;sample<128;sample++)if(RadialAlpha(raw,newRadius+(oldRadius-newRadius)*.55,(sample+.5)*Math.PI/64)>70)visible++;
                Require(visible>120,"Rapid click water leaves a transparent band between the newborn center and outer rim");
            }
            if(interval<.06&&Math.Abs(age-.012)<.00001){
                var waterOnly=new CursorEffects();waterOnly.Commands.AddRange(fx.Commands.Where(c=>c.Kind==8||c.Kind==9));var waterPixels=renderer.Capture(waterOnly,W,H);int whiteRadius=0,blueRadius=0;
                // Pale water must not be classified as the high-white flash.
                // Require near-white RGB and low chroma, rather than the old
                // threshold that also counted light blue as white.
                for(int r=1;r<80;r++){int whiteCount=0,blueCount=0;for(int sample=0;sample<128;sample++){double a=(sample+.5)*Math.PI/64;int x=(int)Math.Round(CX+r*Math.Cos(a)),y=(int)Math.Round(CY+r*Math.Sin(a)),at=(y*W+x)*4;if(waterPixels[at+2]>245&&waterPixels[at]-waterPixels[at+2]<10)whiteCount++;if(waterPixels[at+3]>70&&waterPixels[at]>waterPixels[at+2]+15)blueCount++;}if(whiteCount>100)whiteRadius=r;if(blueCount>100)blueRadius=r;}
                double ratio=blueRadius/(double)whiteRadius;Require(whiteRadius>20&&ratio>1.5&&ratio<2.1,"Rapid white center and blue water radii have the wrong proportion: "+whiteRadius+":"+blueRadius);
                rapidSamples.Add(new{measurement="50ms interval, latest click age12ms; water/flash only; high white minRGB>245 and B-R<10; blue alpha>70 and B-R>15; >100/128 angular samples",whiteRadiusPx=whiteRadius,blueRadiusPx=blueRadius,blueToWhiteRadius=ratio});
            }
            rapidSamples.Add(new{intervalMs=interval*1000,ageMs=age*1000,centerRGB=new[]{raw[center+2],raw[center+1],raw[center]},isolatedRGB=new[]{isolated[center+2],isolated[center+1],isolated[center]}});
            Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"rapid-layer-"+(int)(interval*1000)+"ms-"+(int)(age*1000)+"ms.png"));
        }
        File.WriteAllText(Path.Combine(output,"layering.json"),new JavaScriptSerializer().Serialize(new{separatedRays,sweptAngles=swept.Count(v=>v),maxInstant,coverageAt100ms=earlyCoverage,coverageAt333ms=midCoverage,coverageAt450ms=lateCoverage,rapidSamples}));
        checks.Add("250ms GPU pixels contain separated concentric arc peaks; a single click sweeps over 90% of directions without a rigid full circle; 50/100ms rapid clicks brighten off-frame births and retain the intervening water band");
    }
    static void CaptureMotion(D2DRenderer renderer,string output,List<string> checks){
        var blue=ColorPalette.All[0];renderer.Appearance(blue.Trail,blue.Ripple,blue.Fragment);
        uint seed=9813;Func<double> random=()=>{seed=unchecked(seed*1664525+1013904223);return seed/4294967296.0;};
        var rapid=new CursorEffects(random){Viewport=new Rectangle(0,0,W,H)};rapid.Configure(false,true,1,1,1,60);
        var motion=new List<object>();
        for(int frame=0;frame<60;frame++){
            bool click=frame%6==0;if(click)rapid.InputTimed(CX,CY,true,true,false,1.0/60);rapid.Draw(1.0/60);
            var raw=renderer.Capture(rapid,W,H);int at=(CY*W+CX)*4;
            if(click)Require(raw[at+2]>245&&raw[at+1]>247&&raw[at]>249,"Continuous-frame rapid click misses its near-white initial flash");
            motion.Add(new{kind="rapid",frame,timeMs=(frame+1)*1000/60.0,clicked=click,centerRGB=new[]{raw[at+2],raw[at+1],raw[at]}});
            Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"rapid-blue-animation-"+frame.ToString("D2")+".png"));
        }
        var rapidFast=new CursorEffects(random){Viewport=new Rectangle(0,0,W,H)};rapidFast.Configure(false,true,1,1,1,60);
        for(int frame=0;frame<60;frame++){
            bool click=frame%3==0;if(click)rapidFast.InputTimed(CX,CY,true,true,false,1.0/60-.012);rapidFast.Draw(1.0/60);
            var raw=renderer.Capture(rapidFast,W,H);int at=(CY*W+CX)*4;
            if(click&&frame>0)Require(raw[at+2]>240&&raw[at+1]>245&&raw[at]>249,"50ms continuous clicks lose the 12ms white pulse");
            motion.Add(new{kind="rapid-fast",frame,timeMs=(frame+1)*1000/60.0,clicked=click,centerRGB=new[]{raw[at+2],raw[at+1],raw[at]}});
            Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"rapid-fast-blue-animation-"+frame.ToString("D2")+".png"));
        }
        // Replay observed visible official births; these are video-frame
        // timestamps, not invented OS input timestamps or a 50ms recording.
        var observed=new CursorEffects(random){Viewport=new Rectangle(0,0,W,H)};observed.Configure(false,true,1,1,1,60);
        int[] births={110,132,148,165,185,194};
        for(int frame=110;frame<=219;frame++){
            if(Array.IndexOf(births,frame)>=0)observed.InputTimed(CX,CY,true,true,false,1.0/60);observed.Draw(1.0/60);
            if(frame<132)continue;var raw=renderer.Capture(observed,W,H);
            D2DRenderer.Save(raw,W,H,Path.Combine(output,"official-timing-"+frame.ToString("D3")+"-alpha.png"));
            Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,"official-timing-"+frame.ToString("D3")+".png"));
        }
        var drag=new CursorEffects(random){Viewport=new Rectangle(0,0,W,H)};drag.Configure(true,false,1,1,1,60);int bright=0,colored=0;
        for(int frame=0;frame<96;frame++){
            double t=frame*.075,x=CX+118*Math.Cos(t),y=CY+78*Math.Sin(t);
            drag.Input(x,y,frame==0,true);drag.Draw(1.0/60);var bodies=drag.Commands.Where(c=>c.Kind==2).ToArray();
            bright+=bodies.Count(c=>c.X2>.9&&c.Alpha>.15);colored+=bodies.Count(c=>c.X2<.3&&c.Alpha>.15);
            motion.Add(new{kind="drag",frame,timeMs=(frame+1)*1000/60.0,white=bodies.Count(c=>c.X2>.9),colored=bodies.Count(c=>c.X2<.3)});
            Save(renderer.Capture(drag,W,H),Color.FromArgb(16,19,23),Path.Combine(output,"drag-blue-animation-"+frame.ToString("D2")+".png"));
        }
        Require(bright>0&&colored>bright*1.5,"Steady drag keeps too many visible particles white");
        var flickerPixels=new List<object>();
        foreach(bool burst in new[]{true,false}){
            var fx=new CursorEffects(random){Viewport=new Rectangle(0,0,W,H)};fx.Configure(!burst,burst,1,1,1,60);fx.Input(30,CY,true,true);if(!burst)fx.Input(W-30,CY,false,true);
            var particle=fx.Particles.First();fx.Clear();fx.Particles.Add(particle);particle.X=CX;particle.Y=CY;particle.Vx=particle.Vy=0;
            string name=burst?"click-fragment":"drag-fragment";
            // Measure an isolated existing particle, not a scene with moving
            // rings or newly emitted triangles. Its GPU pixels must recover.
            double previousLight=0;int keyIndex=0;
            foreach(double t in new[]{23901.0/65535,30840.0/65535,37586.0/65535,43754.0/65535,49537.0/65535,55898.0/65535}){
                particle.Age=t*particle.Life;fx.Draw(0);var command=fx.Commands.Single(c=>c.Kind==2);var raw=renderer.Capture(fx,W,H);int at=(CY*W+CX)*4;
                double light=.2126*raw[at+2]+.7152*raw[at+1]+.0722*raw[at];
                if(keyIndex%2==1)Require(light>previousLight*1.35,"Isolated GPU particle never visibly recovers after alpha dip: "+name+" key "+keyIndex);
                flickerPixels.Add(new{kind=name,key=keyIndex,timeMs=particle.Age*1000,whiteMix=command.X2,centerAlpha=raw[at+3],centerRGB=new[]{raw[at+2],raw[at+1],raw[at]},luminance=light});
                Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,name+"-flicker-"+keyIndex+".png"));previousLight=light;keyIndex++;
            }
            for(int frame=0;frame<48;frame++){
                particle.Age=frame/48.0*particle.Life;fx.Draw(0);var command=fx.Commands.Single(c=>c.Kind==2);var raw=renderer.Capture(fx,W,H);
                motion.Add(new{kind=name,frame,timeMs=particle.Age*1000,lifeMs=particle.Life*1000,size=command.Width,whiteMix=command.X2,alpha=command.Alpha,centerAlpha=CenterAlpha(raw)});
                Save(raw,Color.FromArgb(16,19,23),Path.Combine(output,name+"-animation-"+frame.ToString("D2")+".png"));
            }
        }
        File.WriteAllText(Path.Combine(output,"motion.json"),new JavaScriptSerializer().Serialize(new{whiteDragVisibleFrames=bright,coloredDragVisibleFrames=colored,samples=motion,flickerPixels}));
        checks.Add("actual 16.7ms continuous-frame rapid clicks retain white centers; steady drag is predominantly colored; isolated existing fragments captured through growth, three flicker cycles and shrink");
        checks.Add("isolated click and drag fragment GPU luminance recovers after all three alpha dips, with no new particle or ring overlap");
    }
}
