using System;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] struct DrawCommand {
    public int Kind;public float X,Y,X2,Y2,Width,Angle,Alpha,StartAge,EndAge;public int Shape;
    public DrawCommand(int kind,double x,double y,double x2,double y2,double width,double angle,double alpha,double startAge=0,double endAge=0,int shape=0){Kind=kind;X=(float)x;Y=(float)y;X2=(float)x2;Y2=(float)y2;Width=(float)width;Angle=(float)(angle*180/Math.PI);Alpha=(float)alpha;StartAge=(float)startAge;EndAge=(float)endAge;Shape=shape;}
}
enum FragmentShape {Triangle,Heart,Arrow,Star,Lightning}
static class FragmentShapes {
    public static readonly string[] Names={"三角形","心形","箭頭","星星","閃電"};
    public static double Angle(FragmentShape shape,double seed){return shape==FragmentShape.Arrow?Math.Min(3,(int)(seed*4))*Math.PI/2:shape==FragmentShape.Triangle?(seed<.5?0:Math.PI):0;}
}
sealed class CursorEffects {
    internal sealed class Item {public double X,Y,Vx,Vy,Angle,Spin,Age,Life,Size,RadialX,RadialY,WaveSize,RingInset,RingDissolve,Light=1,Tone=1,Flash,WhiteHold,WhiteFade,Orientation;public bool Start,Burst;public FragmentShape Shape;}
    internal struct TrailVertex {public double X,Y,Fade,Width;public bool Start;}
    internal const int MaxTrailPoints=128;
    internal const int MaxTrailVertices=MaxTrailPoints*4;
    internal readonly List<Item> Points=new List<Item>(MaxTrailPoints),Particles=new List<Item>(192),Rings=new List<Item>(16);
    internal readonly List<Item> ClickCores=new List<Item>(8);
    internal readonly List<TrailVertex> SmoothTrail=new List<TrailVertex>(MaxTrailVertices);
    public readonly List<DrawCommand> Commands=new List<DrawCommand>(2048);
    readonly Func<double> random;Item last;double trailRemaining,birthOffset;
    public bool Trail=true,Click=true,Dirty;public double Size=1,Density=.5,Opacity=1;public int Fps=60;
    internal const double DefaultRippleSize=2.0/3,DefaultFragmentSize=2.2,WaterOpacity=.80,BirthFlashScale=1.02;
    public double TrailWidth=1.6,RippleSize=DefaultRippleSize,TrailFragmentSize=DefaultFragmentSize,ClickFragmentSize=DefaultFragmentSize,TrailOpacity=1,ClickOpacity=1;
    FragmentShape fragmentShape;
    double particleSpeed=1,clickSpeed=1,trailSpread=1,trailLifetime=.18,trailSpacing=100,spacingJitter=.35,trailGap=8,clickRadius=200.0/3,clickScatter=.35;int clickCount=4,clickCountJitter=1;
    public Rectangle Viewport=System.Windows.Forms.SystemInformation.VirtualScreen;
    public CursorEffects(Func<double> value=null){var rng=new Random();random=value??rng.NextDouble;}
    public int Alive {get{return Points.Count+Particles.Count+Rings.Count+ClickCores.Count;}}
    public void Configure(bool trail,bool click,double size,double density,double opacity,int fps){
        double old=Size;Trail=trail;Click=click;Size=Clamp(size,.25,3);Density=.5*Clamp(density,0,3);Opacity=Clamp(opacity,0,1);Fps=Math.Max(15,Math.Min(360,fps));foreach(var p in Particles)p.Size*=Size/old;Dirty=true;
    }
    public void Customize(double width,double ripple,double trailFragment,double clickFragment,double trailOpacity,double clickOpacity){
        double oldTrail=TrailFragmentSize,oldClick=ClickFragmentSize;TrailWidth=1.6*Clamp(width,.25,3);RippleSize=DefaultRippleSize*Clamp(ripple,.25,3);TrailFragmentSize=DefaultFragmentSize*Clamp(trailFragment,.25,3);ClickFragmentSize=DefaultFragmentSize*Clamp(clickFragment,.25,3);TrailOpacity=Clamp(trailOpacity,0,1);ClickOpacity=Clamp(clickOpacity,0,1);
        foreach(var p in Particles)p.Size*=p.Burst?ClickFragmentSize/oldClick:TrailFragmentSize/oldTrail;Dirty=true;
    }
    public void SetParticleSpeed(double speed){particleSpeed=Clamp(speed,0,3);Dirty=true;}
    public void SetFragmentShape(FragmentShape shape){shape=(FragmentShape)Math.Max(0,Math.Min(FragmentShapes.Names.Length-1,(int)shape));if(shape==fragmentShape)return;fragmentShape=shape;foreach(var p in Particles){p.Shape=shape;p.Angle=FragmentShapes.Angle(shape,p.Orientation);}Dirty=true;}
    public void SetClickSpeed(double speed){clickSpeed=Clamp(speed,0,3);Dirty=true;}
    public void SetTrailSpread(double spread){trailSpread=Clamp(spread,0,3);Dirty=true;}
    public void SetTrailEmission(double spacing,double jitter){double next=Clamp(spacing,0,300);trailRemaining=trailSpacing>0?trailRemaining*next/trailSpacing:0;trailSpacing=next;spacingJitter=Clamp(jitter,0,.8);Dirty=true;}
    public void SetTrailGap(double gap){trailGap=Clamp(gap,0,60);Dirty=true;}
    int clickLow=3,clickHigh=5;
    public void SetClickParticles(int count,double radius){clickCount=Math.Max(0,Math.Min(20,count));clickRadius=Clamp(radius,4,120);SetClickCountJitter(clickCountJitter);}
    public void SetClickCountJitter(int count){clickCountJitter=Math.Max(0,Math.Min(10,count));SetClickCountRange(clickCount==0?0:clickCount-clickCountJitter,clickCount==0?0:clickCount+clickCountJitter);}
    public void SetClickCountRange(int low,int high){low=Math.Max(0,Math.Min(20,low));high=Math.Max(0,Math.Min(20,high));clickLow=Math.Min(low,high);clickHigh=Math.Max(low,high);Dirty=true;}
    public void SetClickScatter(double scatter){clickScatter=Clamp(scatter,0,1);Dirty=true;}
    public void SetTrailLifetime(double seconds){
        trailLifetime=Clamp(seconds,.04,1);
        foreach(var p in Points){p.Age=p.Age/p.Life*trailLifetime;p.Life=trailLifetime;}Dirty=true;
    }
    static double Clamp(double value,double min,double max){return double.IsNaN(value)||double.IsInfinity(value)?min:Math.Max(min,Math.Min(max,value));}
    static double Distance(Item a,Item b){double x=a.X-b.X,y=a.Y-b.Y;return Math.Sqrt(x*x+y*y);}
    public void Clear(bool resetPointer=true){Points.Clear();SmoothTrail.Clear();Particles.Clear();Rings.Clear();ClickCores.Clear();Commands.Clear();if(resetPointer){last=null;trailRemaining=0;}Dirty=false;}
    public void Input(double x,double y,bool down,bool pressed,bool blocked=false){
        if(blocked||x<Viewport.Left||y<Viewport.Top||x>=Viewport.Right||y>=Viewport.Bottom){last=null;trailRemaining=0;return;}
        if(Opacity==0||!Trail&&!Click)return;
        var p=new Item{X=x-Viewport.Left,Y=y-Viewport.Top};
        if(down){last=null;trailRemaining=0;}
        if(pressed&&!down&&last!=null&&Distance(p,last)<1.5)return;
        // Each accepted cursor sample is joined to the preceding sample, even
        // when a fast drag covers an entire monitor between input ticks. Also
        // keep the final mouse-up position and resume from a stationary anchor.
        if((pressed||last!=null)&&Trail&&TrailOpacity>0&&(last==null||Distance(p,last)>1.5)){
            if(last!=null&&Points.Count==0)Points.Add(new Item{X=last.X,Y=last.Y,Life=trailLifetime,Start=true});
            p.Start=last==null;p.Life=trailLifetime;Points.Add(p);if(Points.Count>MaxTrailPoints)Points.RemoveAt(0);
            if(last!=null){double distance=Distance(p,last);if(distance>0)TrailParticles(last,p,distance);}
        }
        if(down&&Click&&ClickOpacity>0){
            // FX_Touch / MeshTri emits two independently sized, rotated ring
            // meshes, not a single expanding stroke. Keep a bounded cohort.
            for(int i=0;i<2;i++)Rings.Add(new Item{X=p.X,Y=p.Y,Age=-birthOffset,Life=.6,Size=(.12+.02*random())/.13,Angle=random()*Math.PI*2,Spin=random()});
            // FX_Touch/ring is a short circular fill, not the 600ms
            // MeshTri rings. Reuse a ring's scale without perturbing fragments'
            // random sequence; the core does not follow the particle speed.
            // The water and outer arc share an expansion envelope. The second
            // source arc separates inward while retaining their radial overlap.
            double clickScale=(Rings[Rings.Count-2].Size+Rings[Rings.Count-1].Size)*.5;
            Rings[Rings.Count-2].Size=Rings[Rings.Count-1].Size=clickScale;
            var first=Rings[Rings.Count-2];var second=Rings[Rings.Count-1];double delta=second.Angle-first.Angle;
            // Radial separation lets the two partial arcs surround the center
            // without merging into a uniform bright circle at the same radius.
            second.Angle=first.Angle+2+.08*Math.Atan2(Math.Sin(delta),Math.Cos(delta));second.RingInset=.065;second.RingDissolve=.25;
            ClickCores.Add(new Item{X=p.X,Y=p.Y,Age=-birthOffset,Life=.25,Size=clickScale,Angle=Rings[Rings.Count-2].Angle});
            if(ClickCores.Count>8)ClickCores.RemoveAt(0);
            if(Rings.Count>16)Rings.RemoveRange(0,Rings.Count-16);ClickParticles(p.X,p.Y);
        }
        last=pressed?p:null;if(pressed||down||Points.Count>0)Dirty=true;
    }
    public void InputTimed(double x,double y,bool down,bool pressed,bool blocked,double secondsIntoFrame){
        birthOffset=Clamp(secondsIntoFrame,0,.1);try{Input(x,y,down,pressed,blocked);}finally{birthOffset=0;}
    }
    void TrailParticles(Item a,Item b,double distance){
        // Distance-clocked emission: subdividing the same movement into more
        // input samples cannot produce extra particles. Retain the fractional
        // distance across frames and stationary holds, never spawn at rest.
        if(Density<=0||trailSpacing==0)return;
        double spacing=trailSpacing/(Density*2);
        if(trailRemaining<=0)trailRemaining=NextSpacing(spacing);
        double tx=(b.X-a.X)/distance,ty=(b.Y-a.Y)/distance,nx=-ty,ny=tx;
        // Huge virtual-desktop jumps are sampled over the entire segment with
        // a fixed allocation budget, rather than leaving a burst queued up.
        if(distance>spacing*64){
            for(int i=0;i<64;i++)TrailParticle(a,b,(i+.25+.5*random())/64,tx,ty,nx,ny);
            trailRemaining=NextSpacing(spacing);LimitParticles();return;
        }
        double consumed=0;int count=0;
        while(distance-consumed>=trailRemaining&&count<64){
            consumed+=trailRemaining;TrailParticle(a,b,consumed/distance,tx,ty,nx,ny);
            trailRemaining=NextSpacing(spacing);count++;
        }
        trailRemaining-=distance-consumed;if(trailRemaining<=0)trailRemaining=NextSpacing(spacing);
        LimitParticles();
    }
    double NextSpacing(double spacing){return spacing*(1+(random()*2-1)*spacingJitter);}
    void TrailParticle(Item a,Item b,double t,double tx,double ty,double nx,double ny){
        // A narrow, randomized band on either side of the trail, followed by
        // gentle outward drift. Triangle orientation is independent of motion.
        double side=random()<.5?-1:1,scale=Size*trailSpread;
        double gap=trailGap*(.75+.5*random())*Size;
        var p=Particle(a.X+(b.X-a.X)*t,a.Y+(b.Y-a.Y)*t,false);
        // Include the triangle's bounding radius so larger fragments do not
        // erase the intended visible gap or cross the line at birth.
        double offset=side*(gap+p.Size)*trailSpread;p.X+=nx*offset;p.Y+=ny*offset;
        double drift=(random()-.5)*12*scale,outward=side*(8+random()*16)*scale;
        p.Vx=tx*drift+nx*outward;p.Vy=ty*drift+ny*outward;
    }
    double ClickAngle(int start){
        double best=0,bestDot=2;
        // Independent angles; at most three candidates only when nearly coincident.
        // Keep the least crowded candidate, without enforcing full-circle coverage.
        for(int attempt=0;attempt<3;attempt++){
            double angle=random()*Math.PI*2,c=Math.Cos(angle),s=Math.Sin(angle),near=-1;
            for(int j=start;j<Particles.Count;j++)near=Math.Max(near,c*Particles[j].RadialX+s*Particles[j].RadialY);
            if(near<bestDot){best=angle;bestDot=near;}if(near<.9781476007338057)break;
        }
        return best;
    }
    void ClickParticles(double x,double y){
        if(clickHigh==0||Density==0)return;
        int low=clickLow,high=clickHigh;
        int count=(int)Math.Floor((low+Math.Min(high-low,(int)(random()*(high-low+1))))*Density*2+.5);if(count<1)return;double scale=Size*RippleSize;
        int start=Particles.Count;
        for(int i=0;i<count;i++){
            // Same-side groups and partial overlap are allowed.
            double angle=ClickAngle(start),offset=random();
            double waveScale=Rings[Rings.Count-1].Size;
            // Start just outside the actual newborn wave, then share its
            // expansion. Triangle bodies overlap the rim while their centers
            // stay outside; a fixed outer annulus left an empty early gap.
            double radius=WaveRadius(0,waveScale)+(1.1+offset*2.2*clickScatter)*scale*clickRadius/(200.0/3),speed=(3+random()*5)*scale;
            var p=Particle(x+Math.Cos(angle)*radius,y+Math.Sin(angle)*radius,true);
            p.RadialX=Math.Cos(angle);p.RadialY=Math.Sin(angle);p.WaveSize=Rings[Rings.Count-1].Size;
            double drift=(random()-.5)*6*scale;p.Vx=Math.Cos(angle)*speed-Math.Sin(angle)*drift;p.Vy=Math.Sin(angle)*speed+Math.Cos(angle)*drift;
        }
        LimitParticles();
    }
    Item Particle(double x,double y,bool burst){
        double flash=random()<.92?.96+.04*random():.4+.35*random();
        double orientation=random();var p=new Item{X=x,Y=y,Shape=fragmentShape,Orientation=orientation,Angle=FragmentShapes.Angle(fragmentShape,orientation),Spin=0,Life=burst?.6+.1*random():.2+.2*random(),Size=(3+random()*4)*Size*(burst?ClickFragmentSize:TrailFragmentSize),Light=.9+.1*random(),Tone=.8+.2*random(),Flash=flash,WhiteHold=.2+.4*random(),WhiteFade=.12+.18*random(),Burst=burst};
        if(burst){
            // The 60fps reference keeps the growing click triangles white;
            // tint appears during shrink, before the independent drag profile.
            // Reuse the sampled values, without additional random draws.
            p.Flash=1;p.Light=1;p.Age=.01;p.WhiteHold=.18+.03*(p.WhiteHold-.2)/.4;p.WhiteFade=.05+.02*(p.WhiteFade-.12)/.18;
            // A tiny pre-roll matches the first captured visible triangles:
            // footage area is ~18% of peak at 33ms and ~45% at 50ms.
        }else{
            // Most of a drag fragment's visible life is colored. A short,
            // randomized white phase is independent of cursor proximity.
            p.WhiteHold=.11+.09*(p.WhiteHold-.2)/.4;p.WhiteFade=.08+.05*(p.WhiteFade-.12)/.18;
        }
        p.Age-=birthOffset;Particles.Add(p);return p;
    }
    void LimitParticles(){if(Particles.Count>192)Particles.RemoveRange(0,Particles.Count-192);}
    public void Update(double dt){
        dt=Clamp(dt,0,.1);foreach(var list in new[]{Points,Rings,ClickCores}){foreach(var p in list)p.Age+=dt;for(int i=list.Count-1;i>=0;i--)if(list[i].Age>=list[i].Life)list.RemoveAt(i);}
        foreach(var r in Rings){double t=r.Age/r.Life,lo=Hermite(t,.149039,1,1,.45561826,0,0),hi=Hermite(t,.15865384,1,.79881656,-.06509134,0,0);r.Angle-=11.17010689*(lo+(hi-lo)*r.Spin)*dt;}
        for(int i=Particles.Count-1;i>=0;i--){
            var p=Particles[i];
            // Speed changes the playback clock of the entire particle, so its
            // path, terminal position and fade progress stay tied together.
            // Zero speed is a stationary fade rather than an endless effect.
            double speed=p.Burst?clickSpeed:particleSpeed;
            double step=Math.Min(p.Life-p.Age,dt*(speed>0?speed:1));
            if(speed>0){
                p.X+=p.Vx*step;p.Y+=p.Vy*step;
                if(p.Burst){double before=Math.Max(0,p.Age-.01),after=Math.Max(0,p.Age+step-.01);double growth=WaveRadius(after,p.WaveSize)-WaveRadius(before,p.WaveSize);p.X+=p.RadialX*growth;p.Y+=p.RadialY*growth;}
            }
            p.Age+=step;if(p.Age>=p.Life)Particles.RemoveAt(i);
        }
    }
    void Add(int type,double x,double y,double x2,double width,double angle,double alpha,double y2=0,double detail=0){Commands.Add(new DrawCommand(type,x,y,x2,y2,width,angle,alpha,detail));}
    TrailVertex Vertex(int index){var p=Points[index];return new TrailVertex{X=p.X,Y=p.Y,Fade=1-p.Age/p.Life,Width=(1.5+2*(double)index/Points.Count)*Size*TrailWidth};}
    static TrailVertex Lerp(TrailVertex a,TrailVertex b,double t){return new TrailVertex{X=a.X+(b.X-a.X)*t,Y=a.Y+(b.Y-a.Y)*t,Fade=a.Fade+(b.Fade-a.Fade)*t,Width=a.Width+(b.Width-a.Width)*t};}
    void BuildSmoothTrail(){
        // Quadratic corner rounding stays inside each sample triangle: no
        // overshoot, delayed cursor head, extra polling or per-frame objects.
        // Share a fixed vertex budget; typical strokes get up to 12 samples
        // per corner, while long/dense strokes cannot expand the draw budget.
        SmoothTrail.Clear();
        int maxSteps=Math.Min(12,MaxTrailVertices/Math.Max(1,Points.Count));
        for(int start=0;start<Points.Count;){
            int end=start;while(end+1<Points.Count&&!Points[end+1].Start)end++;
            if(end>start){
                var head=Vertex(start);head.Start=true;SmoothTrail.Add(head);
                if(end>start+1){
                    var left=Lerp(head,Vertex(start+1),.5);SmoothTrail.Add(left);
                    for(int i=start+1;i<end;i++){
                        var control=Vertex(i);var right=Lerp(control,Vertex(i+1),.5);
                        double dx=left.X-2*control.X+right.X,dy=left.Y-2*control.Y+right.Y;
                        int steps=Math.Max(1,Math.Min(maxSteps,(int)Math.Ceiling(Math.Sqrt(Math.Sqrt(dx*dx+dy*dy)/2))));
                        for(int j=1;j<=steps;j++){double t=(double)j/steps;SmoothTrail.Add(Lerp(Lerp(left,control,t),Lerp(control,right,t),t));}
                        left=right;
                    }
                }
                SmoothTrail.Add(Vertex(end));
            }
            start=end+1;
        }
    }
    // Hermite keys from the reference SizeOverLifetime. No per-frame arrays,
    // curve objects, or randomness: one tiny evaluation per visible item.
    static double Hermite(double t,double a,double b,double va,double vb,double ma,double mb){double u=Clamp((t-a)/(b-a),0,1),u2=u*u,u3=u2*u;return (2*u3-3*u2+1)*va+(u3-2*u2+u)*(b-a)*ma+(-2*u3+3*u2)*vb+(u3-u2)*(b-a)*mb;}
    internal static double WaveGrowth(double t){return t<.00720978?.42050898:t<.21392822?Hermite(t,.00720978,.21392822,.42050898,.71597731,2.40047336,.91157448):Hermite(t,.21392822,1,.71597731,1,.91157448,0);}
    internal static double ClickCoreGrowth(double t){return t<.21392822?Hermite(t,0,.21392822,.32583582,.71597731,2.40047336,.91157448):Hermite(t,.21392822,1,.71597731,1,.91157448,0);}
    internal static double FragmentGrowth(double t){return t<.15445095?Hermite(t,0,.15445095,0,1,0,0):Math.Max(0,Hermite(t,.15445095,1,1,0,0,-2.16215014));}
    internal static double WaveThreshold(double t){return Clamp(t<.2?Hermite(t,0,.2,1,0,.2666659,0):Hermite(t,.2,1,0,1,.1616586,.2773564),0,1);}
    static readonly double[] alphaTimes={0,18890.0/65535,23901.0/65535,30840.0/65535,37586.0/65535,43754.0/65535,49537.0/65535,55898.0/65535,1};
    static readonly double[] alphaValues={1,1,0,1,0,1,0,1,1};
    static double FragmentAlpha(double t){for(int i=1;i<alphaTimes.Length;i++)if(t<=alphaTimes[i])return alphaValues[i-1]+(alphaValues[i]-alphaValues[i-1])*(t-alphaTimes[i-1])/(alphaTimes[i]-alphaTimes[i-1]);return 0;}
    double ParticleAlpha(Item p){
        double t=p.Age/p.Life;
        // Valid source alpha keys brighten/dim three times; RGB becomes blue
        // and does not repeatedly become white. A small SDR floor keeps the
        // click fragments legible at the first dip without removing flicker.
        double fade=Clamp((t-.75)/.25,0,1),floor=p.Burst?.42:.10;
        return Opacity*(p.Burst?ClickOpacity:TrailOpacity)*p.Light*(floor+(1-floor)*FragmentAlpha(t))*(1-fade*fade*(3-2*fade));
    }
    double ParticleWhite(Item p){double t=Clamp((p.Age/p.Life-p.WhiteHold)/p.WhiteFade,0,1);return p.Flash*(1-t*t*(3-2*t));}
    double ParticleSize(Item p){return p.Size*FragmentGrowth(p.Age/p.Life);}
    // Pixel calibration from capture_1.mp4: about 29px at birth and 50-62px
    // through expansion. The source world-unit scale is not a desktop pixel.
    double WaveRadius(double age,double scale){return 90*scale*(WaveGrowth(Math.Min(1,age/.6))+.04*Math.Exp(-Math.Max(0,age)/.055))*Size*RippleSize;}
    double RingRadius(Item r){return WaveRadius(r.Age,r.Size);}
    double RingLifeAlpha(Item r){double t=Clamp((r.Age/r.Life-.55)/.45,0,1);return 1-t*t*(3-2*t);}
    double RingAlpha(Item r){double t=Clamp(r.Age/.12,0,1);return Opacity*ClickOpacity*RingLifeAlpha(r)*t*t*(3-2*t);}
    // Source particle alpha stays at one: SDR dimming must not accelerate
    // the shader's circumference cutoff by dividing its threshold again.
    double RingClip(Item r){
        double t=Clamp(r.Age/r.Life,0,1),opening=Math.Exp(-t/.065);
        double second=Clamp((t-.4)/.35,0,1);
        return .52+.48*(opening+(1-opening)*t*t)+.14*t*t*t+r.RingDissolve*second*second*(3-2*second);
    }
    double RingWhite(Item r){return Clamp((.5-r.Age/r.Life)/(.5-.111772),0,1);}
    double ClickCoreRadius(Item r){
        // The fill expires faster, but has the same growing outer boundary.
        // The rim is rendered on top of the fill's narrow inner soft edge.
        return RingRadius(r);
    }
    double ClickFlashAlpha(Item r){double t=Clamp((r.Age-.04)/.06,0,1);return Opacity*ClickOpacity*Math.Exp(-Math.Max(0,r.Age)/.022)*(1-t*t*(3-2*t));}
    double ClickCoreAlpha(Item r){
        // Keep the early colored body bright and overlapping the rim, then
        // clear it before the independent outer-ring lifetime ends.
        double t=Clamp((r.Age-.05)/(.245-.05),0,1),fade=1-t*t*(3-2*t);
        return Opacity*ClickOpacity*WaterOpacity*fade;
    }
    // TrailRenderer path1866 RGB gradient: bright blue -> dim blue -> black.
    // Its independent alpha keys remain 1. Use the dominant blue channel as
    // a hue-independent light curve for all palettes, then map HDR onto SDR.
    internal static double TrailLight(double t){t=Clamp(t,0,1);const double a=1349.0/65535,b=27563.0/65535,m=.28235295;return t<a?1:t<b?1+(m-1)*(t-a)/(b-a):m*(1-t)/(1-b);}
    public bool Draw(double dt){
        Update(dt);if(Alive==0&&!Dirty)return false;Commands.Clear();BuildSmoothTrail();
        // Render the trail before independent rings/fragments. Trail coverage
        // uses MAX blending, avoiding brighter sample joints and loop crossings.
        for(int i=1;i<SmoothTrail.Count;i++){var a=SmoothTrail[i-1];var b=SmoothTrail[i];if(b.Start||a.X==b.X&&a.Y==b.Y)continue;Commands.Add(new DrawCommand(0,a.X,a.Y,b.X,b.Y,b.Width,0,Opacity*TrailOpacity,1-a.Fade,1-b.Fade));}
        foreach(var r in ClickCores)Add(8,r.X,r.Y,ClickCoreRadius(r),0,r.Angle,Math.Max(0,ClickCoreAlpha(r)-ClickFlashAlpha(r)),r.Age/r.Life);
        // The actual birth flash is strongest at age zero and only decays.
        // It retains its birth size while the separate colored water expands.
        // Repeated clicks accumulate surviving flashes, not a new center fill
        // that brightens after the initial white phase has already finished.
        foreach(var r in ClickCores)Add(9,r.X,r.Y,WaveRadius(0,r.Size)*BirthFlashScale,0,r.Angle,ClickFlashAlpha(r));
        foreach(var r in Rings){double insetAge=Clamp(r.Age/.12,0,1);Add(6,r.X,r.Y,RingRadius(r),RingClip(r),r.Angle,RingAlpha(r),RingWhite(r),r.RingInset*insetAge*insetAge*(3-2*insetAge));}
        foreach(var p in Particles)Commands.Add(new DrawCommand(2,p.X,p.Y,ParticleWhite(p),p.Tone,ParticleSize(p),p.Angle,ParticleAlpha(p),shape:(int)p.Shape));
        Dirty=Alive>0;return true;
    }
    public Rectangle Surface(){
        double left=double.PositiveInfinity,top=left,right=double.NegativeInfinity,bottom=right;
        Action<Item,double> extend=(p,pad)=>{left=Math.Min(left,p.X-pad);top=Math.Min(top,p.Y-pad);right=Math.Max(right,p.X+pad);bottom=Math.Max(bottom,p.Y+pad);};
        foreach(var p in Points)extend(p,2*Size*TrailWidth+2);foreach(var p in Particles)extend(p,p.Size*1.6+3);foreach(var r in Rings)extend(r,RingRadius(r)*1.16+2);foreach(var r in ClickCores)extend(r,Math.Max(ClickCoreRadius(r)*1.18,WaveRadius(0,r.Size)*BirthFlashScale*1.18)+2);
        if(double.IsPositiveInfinity(left))return new Rectangle(0,0,1,1);
        left=Math.Max(0,Math.Floor(left/64)*64);top=Math.Max(0,Math.Floor(top/64)*64);right=Math.Min(Viewport.Width,right);bottom=Math.Min(Viewport.Height,bottom);
        if(right<=left||bottom<=top)return new Rectangle(0,0,1,1);
        return new Rectangle((int)left,(int)top,(int)Math.Max(1,Math.Min(Viewport.Width-left,Math.Ceiling((right-left)/128)*128)),(int)Math.Max(1,Math.Min(Viewport.Height-top,Math.Ceiling((bottom-top)/128)*128)));
    }
}
