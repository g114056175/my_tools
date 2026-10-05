using System;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] struct DrawCommand {
    public int Kind;public float X,Y,X2,Y2,Width,Angle,Alpha,StartAge,EndAge;
    public DrawCommand(int kind,double x,double y,double x2,double y2,double width,double angle,double alpha,double startAge=0,double endAge=0){Kind=kind;X=(float)x;Y=(float)y;X2=(float)x2;Y2=(float)y2;Width=(float)width;Angle=(float)(angle*180/Math.PI);Alpha=(float)alpha;StartAge=(float)startAge;EndAge=(float)endAge;}
}
sealed class CursorEffects {
    internal sealed class Item {public double X,Y,Vx,Vy,Angle,Spin,Age,Life,Size,Light=1,Tone=1,Flash,WhiteHold,WhiteFade;public bool Start,Burst;}
    internal struct TrailVertex {public double X,Y,Fade,Width;public bool Start;}
    internal const int MaxTrailPoints=128;
    internal const int MaxTrailVertices=MaxTrailPoints*4;
    internal readonly List<Item> Points=new List<Item>(MaxTrailPoints),Particles=new List<Item>(192),Rings=new List<Item>(16);
    internal readonly List<TrailVertex> SmoothTrail=new List<TrailVertex>(MaxTrailVertices);
    public readonly List<DrawCommand> Commands=new List<DrawCommand>(2048);
    readonly Func<double> random;Item last;double trailRemaining;
    public bool Trail=true,Click=true,Dirty;public double Size=1,Density=.5,Opacity=1;public int Fps=60;
    public double TrailWidth=1.6,RippleSize=.75,TrailFragmentSize=2,ClickFragmentSize=2,TrailOpacity=1,ClickOpacity=1;
    double particleSpeed=1,clickSpeed=1,trailSpread=1,trailLifetime=.18,trailSpacing=100,spacingJitter=.35,trailGap=8,clickRadius=50,clickScatter=.35;int clickCount=4,clickCountJitter=1;
    public Rectangle Viewport=System.Windows.Forms.SystemInformation.VirtualScreen;
    public CursorEffects(Func<double> value=null){var rng=new Random();random=value??rng.NextDouble;}
    public int Alive {get{return Points.Count+Particles.Count+Rings.Count;}}
    public void Configure(bool trail,bool click,double size,double density,double opacity,int fps){
        double old=Size;Trail=trail;Click=click;Size=Clamp(size,.25,3);Density=.5*Clamp(density,0,3);Opacity=Clamp(opacity,0,1);Fps=Math.Max(15,Math.Min(360,fps));foreach(var p in Particles)p.Size*=Size/old;Dirty=true;
    }
    public void Customize(double width,double ripple,double trailFragment,double clickFragment,double trailOpacity,double clickOpacity){
        double oldTrail=TrailFragmentSize,oldClick=ClickFragmentSize;TrailWidth=1.6*Clamp(width,.25,3);RippleSize=.75*Clamp(ripple,.25,3);TrailFragmentSize=2*Clamp(trailFragment,.25,3);ClickFragmentSize=2*Clamp(clickFragment,.25,3);TrailOpacity=Clamp(trailOpacity,0,1);ClickOpacity=Clamp(clickOpacity,0,1);
        foreach(var p in Particles)p.Size*=p.Burst?ClickFragmentSize/oldClick:TrailFragmentSize/oldTrail;Dirty=true;
    }
    public void SetParticleSpeed(double speed){particleSpeed=Clamp(speed,0,3);Dirty=true;}
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
    public void Clear(bool resetPointer=true){Points.Clear();SmoothTrail.Clear();Particles.Clear();Rings.Clear();Commands.Clear();if(resetPointer){last=null;trailRemaining=0;}Dirty=false;}
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
            for(int i=0;i<2;i++)Rings.Add(new Item{X=p.X,Y=p.Y,Life=.6,Size=(.12+.02*random())/.13,Angle=random()*Math.PI*2,Spin=random()});
            if(Rings.Count>16)Rings.RemoveRange(0,Rings.Count-16);ClickParticles(p.X,p.Y);
        }
        last=pressed?p:null;if(pressed||down||Points.Count>0)Dirty=true;
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
    void ClickParticles(double x,double y){
        if(clickHigh==0||Density==0)return;
        int low=clickLow,high=clickHigh;
        int count=(int)Math.Floor((low+Math.Min(high-low,(int)(random()*(high-low+1))))*Density*2+.5);double scale=Size*RippleSize;
        for(int i=0;i<count;i++){
            // Independent angles preserve natural clusters/empty sectors.
            // Randomize within an annulus, never equally spaced spokes.
            double angle=random()*Math.PI*2,inner=1-.55*clickScatter,outer=1+.2*clickScatter;
            double radius=clickRadius*Math.Sqrt(inner*inner+random()*(outer*outer-inner*inner))*scale,speed=(22+random()*24)*scale;
            var p=Particle(x+Math.Cos(angle)*radius,y+Math.Sin(angle)*radius,true);
            double drift=(random()-.5)*18*scale;p.Vx=Math.Cos(angle)*speed-Math.Sin(angle)*drift;p.Vy=Math.Sin(angle)*speed+Math.Cos(angle)*drift;
        }
        LimitParticles();
    }
    Item Particle(double x,double y,bool burst){
        double flash=random()<.92?.96+.04*random():.4+.35*random();
        var p=new Item{X=x,Y=y,Angle=random()<.5?0:Math.PI,Spin=0,Life=burst?.6+.1*random():.2+.2*random(),Size=(3+random()*4)*Size*(burst?ClickFragmentSize:TrailFragmentSize),Light=.9+.1*random(),Tone=.8+.2*random(),Flash=flash,WhiteHold=.2+.4*random(),WhiteFade=.12+.18*random(),Burst=burst};Particles.Add(p);return p;
    }
    void LimitParticles(){if(Particles.Count>192)Particles.RemoveRange(0,Particles.Count-192);}
    public void Update(double dt){
        dt=Clamp(dt,0,.1);foreach(var list in new[]{Points,Rings}){foreach(var p in list)p.Age+=dt;for(int i=list.Count-1;i>=0;i--)if(list[i].Age>=list[i].Life)list.RemoveAt(i);}
        foreach(var r in Rings){double t=r.Age/r.Life,lo=Hermite(t,.149039,1,1,.45561826,0,0),hi=Hermite(t,.15865384,1,.79881656,-.06509134,0,0);r.Angle+=11.17010689*(lo+(hi-lo)*r.Spin)*dt;}
        for(int i=Particles.Count-1;i>=0;i--){
            var p=Particles[i];
            // Speed changes the playback clock of the entire particle, so its
            // path, terminal position and fade progress stay tied together.
            // Zero speed is a stationary fade rather than an endless effect.
            double speed=p.Burst?clickSpeed:particleSpeed;
            double step=Math.Min(p.Life-p.Age,dt*(speed>0?speed:1));
            if(speed>0){p.X+=p.Vx*step;p.Y+=p.Vy*step;}
            p.Age+=step;if(p.Age>=p.Life)Particles.RemoveAt(i);
        }
    }
    void Add(int type,double x,double y,double x2,double width,double angle,double alpha,double y2=0){Commands.Add(new DrawCommand(type,x,y,x2,y2,width,angle,alpha));}
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
    internal static double FragmentGrowth(double t){return t<.15445095?Hermite(t,0,.15445095,0,1,0,0):Math.Max(0,Hermite(t,.15445095,1,1,0,0,-2.16215014));}
    internal static double WaveThreshold(double t){return Clamp(t<.2?Hermite(t,0,.2,1,0,.2666659,0):Hermite(t,.2,1,0,1,.1616586,.2773564),0,1);}
    static readonly double[] alphaTimes={0,18890.0/65535,23901.0/65535,30840.0/65535,37586.0/65535,43754.0/65535,49537.0/65535,55898.0/65535,1};
    static readonly double[] alphaValues={1,1,0,1,0,1,0,1,1};
    static double FragmentAlpha(double t){for(int i=1;i<alphaTimes.Length;i++)if(t<=alphaTimes[i])return alphaValues[i-1]+(alphaValues[i]-alphaValues[i-1])*(t-alphaTimes[i-1])/(alphaTimes[i]-alphaTimes[i-1]);return 0;}
    double ParticleAlpha(Item p){return Opacity*(p.Burst?ClickOpacity:TrailOpacity)*p.Light*FragmentAlpha(p.Age/p.Life);}
    double ParticleWhite(Item p){double t=Clamp((p.Age/p.Life-p.WhiteHold)/p.WhiteFade,0,1);return p.Flash*(1-t*t*(3-2*t));}
    double ParticleSize(Item p){return p.Size*FragmentGrowth(p.Age/p.Life);}
    double RingRadius(Item r){return 72*r.Size*WaveGrowth(r.Age/r.Life)*Size*RippleSize;}
    double RingLifeAlpha(Item r){return Clamp((1-r.Age/r.Life)/(1-.108827),0,1);}
    double RingAlpha(Item r){return Opacity*ClickOpacity*RingLifeAlpha(r);}
    double RingClip(Item r){return WaveThreshold(r.Age/r.Life)/Math.Max(.000001,RingLifeAlpha(r));}
    double RingWhite(Item r){return Clamp((.5-r.Age/r.Life)/(.5-.111772),0,1);}
    // TrailRenderer path1866 RGB gradient: bright blue -> dim blue -> black.
    // Its independent alpha keys remain 1. Use the dominant blue channel as
    // a hue-independent light curve for all palettes, then map HDR onto SDR.
    internal static double TrailLight(double t){t=Clamp(t,0,1);const double a=1349.0/65535,b=27563.0/65535,m=.28235295;return t<a?1:t<b?1+(m-1)*(t-a)/(b-a):m*(1-t)/(1-b);}
    public bool Draw(double dt){
        Update(dt);if(Alive==0&&!Dirty)return false;Commands.Clear();BuildSmoothTrail();
        // Render the trail before independent rings/fragments. Trail coverage
        // uses MAX blending, avoiding brighter sample joints and loop crossings.
        for(int i=1;i<SmoothTrail.Count;i++){var a=SmoothTrail[i-1];var b=SmoothTrail[i];if(b.Start||a.X==b.X&&a.Y==b.Y)continue;Commands.Add(new DrawCommand(0,a.X,a.Y,b.X,b.Y,b.Width,0,Opacity*TrailOpacity,1-a.Fade,1-b.Fade));}
        foreach(var r in Rings)Add(6,r.X,r.Y,RingRadius(r),RingClip(r),r.Angle,RingAlpha(r),RingWhite(r));
        foreach(var p in Particles)Add(2,p.X,p.Y,ParticleWhite(p),ParticleSize(p),p.Angle,ParticleAlpha(p),p.Tone);
        Dirty=Alive>0;return true;
    }
    public Rectangle Surface(){
        double left=double.PositiveInfinity,top=left,right=double.NegativeInfinity,bottom=right;
        Action<Item,double> extend=(p,pad)=>{left=Math.Min(left,p.X-pad);top=Math.Min(top,p.Y-pad);right=Math.Max(right,p.X+pad);bottom=Math.Max(bottom,p.Y+pad);};
        foreach(var p in Points)extend(p,2*Size*TrailWidth+2);foreach(var p in Particles)extend(p,p.Size+2);foreach(var r in Rings)extend(r,RingRadius(r)*1.04+2);
        if(double.IsPositiveInfinity(left))return new Rectangle(0,0,1,1);
        left=Math.Max(0,Math.Floor(left/64)*64);top=Math.Max(0,Math.Floor(top/64)*64);right=Math.Min(Viewport.Width,right);bottom=Math.Min(Viewport.Height,bottom);
        if(right<=left||bottom<=top)return new Rectangle(0,0,1,1);
        return new Rectangle((int)left,(int)top,(int)Math.Max(1,Math.Min(Viewport.Width-left,Math.Ceiling((right-left)/128)*128)),(int)Math.Max(1,Math.Min(Viewport.Height-top,Math.Ceiling((bottom-top)/128)*128)));
    }
}
