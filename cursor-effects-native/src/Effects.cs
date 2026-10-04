using System;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] struct DrawCommand {
    public int Kind;public float X,Y,X2,Y2,Width,Angle,Alpha;
    public DrawCommand(int kind,double x,double y,double x2,double y2,double width,double angle,double alpha){Kind=kind;X=(float)x;Y=(float)y;X2=(float)x2;Y2=(float)y2;Width=(float)width;Angle=(float)(angle*180/Math.PI);Alpha=(float)alpha;}
}
sealed class CursorEffects {
    internal sealed class Item {public double X,Y,Vx,Vy,Angle,Spin,Age,Life,Size,Light=1;public bool Start,Burst;}
    internal struct TrailVertex {public double X,Y,Fade,Width;public bool Start;}
    internal const int MaxTrailPoints=128;
    internal const int MaxTrailVertices=MaxTrailPoints*4;
    internal readonly List<Item> Points=new List<Item>(MaxTrailPoints),Particles=new List<Item>(192),Rings=new List<Item>(16);
    internal readonly List<TrailVertex> SmoothTrail=new List<TrailVertex>(MaxTrailVertices);
    public readonly List<DrawCommand> Commands=new List<DrawCommand>(2048);
    readonly Func<double> random;Item last;double trailEmission;
    public bool Trail=true,Click=true,Dirty;public double Size=1,Strength=1,Density=.5,Opacity=1;public int Fps=60;
    public double TrailWidth=.8,RippleSize=1,TrailFragmentSize=1,ClickFragmentSize=1,TrailOpacity=1,ClickOpacity=1;double particleSpeed=1,trailSpread=1,trailLifetime=.18;
    public Rectangle Viewport=System.Windows.Forms.SystemInformation.VirtualScreen;
    public CursorEffects(Func<double> value=null){var rng=new Random();random=value??rng.NextDouble;}
    public int Alive {get{return Points.Count+Particles.Count+Rings.Count;}}
    public void Configure(bool trail,bool click,double size,double strength,double density,double opacity,int fps){
        double old=Size;Trail=trail;Click=click;Size=Clamp(size,.25,3);Strength=Clamp(strength,0,3);Density=.5*Clamp(density,0,3);Opacity=Clamp(opacity,0,1);Fps=Math.Max(15,Math.Min(360,fps));foreach(var p in Particles)p.Size*=Size/old;Dirty=true;
    }
    public void Customize(double width,double ripple,double trailFragment,double clickFragment,double trailOpacity,double clickOpacity){
        double oldTrail=TrailFragmentSize,oldClick=ClickFragmentSize;TrailWidth=.8*Clamp(width,.25,3);RippleSize=Clamp(ripple,.25,3);TrailFragmentSize=Clamp(trailFragment,.25,3);ClickFragmentSize=Clamp(clickFragment,.25,3);TrailOpacity=Clamp(trailOpacity,0,1);ClickOpacity=Clamp(clickOpacity,0,1);
        foreach(var p in Particles)p.Size*=p.Burst?ClickFragmentSize/oldClick:TrailFragmentSize/oldTrail;Dirty=true;
    }
    public void SetParticleSpeed(double speed){particleSpeed=Clamp(speed,0,3);Dirty=true;}
    public void SetTrailSpread(double spread){trailSpread=Clamp(spread,0,3);Dirty=true;}
    public void SetTrailLifetime(double seconds){
        trailLifetime=Clamp(seconds,.04,1);
        foreach(var p in Points){p.Age=p.Age/p.Life*trailLifetime;p.Life=trailLifetime;}Dirty=true;
    }
    static double Clamp(double value,double min,double max){return double.IsNaN(value)||double.IsInfinity(value)?min:Math.Max(min,Math.Min(max,value));}
    static double Distance(Item a,Item b){double x=a.X-b.X,y=a.Y-b.Y;return Math.Sqrt(x*x+y*y);}
    public void Clear(bool resetPointer=true){Points.Clear();SmoothTrail.Clear();Particles.Clear();Rings.Clear();Commands.Clear();if(resetPointer){last=null;trailEmission=0;}Dirty=false;}
    public void Input(double x,double y,bool down,bool pressed,bool blocked=false){
        if(blocked||x<Viewport.Left||y<Viewport.Top||x>=Viewport.Right||y>=Viewport.Bottom){last=null;trailEmission=0;return;}
        if(Opacity==0||!Trail&&!Click)return;
        var p=new Item{X=x-Viewport.Left,Y=y-Viewport.Top};
        if(down){last=null;trailEmission=0;}
        if(pressed&&!down&&last!=null&&Distance(p,last)<1.5)return;
        // Each accepted cursor sample is joined to the preceding sample, even
        // when a fast drag covers an entire monitor between input ticks. Also
        // keep the final mouse-up position and resume from a stationary anchor.
        if((pressed||last!=null)&&Trail&&TrailOpacity>0&&(last==null||Distance(p,last)>1.5)){
            if(last!=null&&Points.Count==0)Points.Add(new Item{X=last.X,Y=last.Y,Life=trailLifetime,Start=true});
            p.Start=last==null;p.Life=trailLifetime;Points.Add(p);if(Points.Count>MaxTrailPoints)Points.RemoveAt(0);
            if(last!=null){double distance=Distance(p,last);if(distance>3)TrailParticles(last,p,distance);}
        }
        if(down&&Click&&ClickOpacity>0){Rings.Add(new Item{X=p.X,Y=p.Y,Life=.42});if(Rings.Count>16)Rings.RemoveAt(0);Triangle(p.X,p.Y,12,true);}
        last=pressed?p:null;if(pressed||down||Points.Count>0)Dirty=true;
    }
    void TrailParticles(Item a,Item b,double distance){
        // Distribute fragments along the sampled path instead of piling them
        // at its endpoint. Bound work for very long/high-DPI cursor jumps.
        // Carry fractional emissions between samples, so halving density also
        // halves fragments during slow drags instead of rounding .5 back to 1.
        trailEmission+=Math.Min(12,Math.Ceiling(distance/24))*Density;
        int count=(int)Math.Floor(trailEmission);trailEmission-=count;
        double tx=(b.X-a.X)/distance,ty=(b.Y-a.Y)/distance,nx=-ty,ny=tx;
        for(int i=0;i<count;i++){
            // Start near the path, then travel in a random direction. There is
            // no empty strip or compulsory outward offset on either side.
            double t=(i+random())/count,scale=Size*trailSpread;
            double spawnAngle=random()*Math.PI*2,radius=Math.Sqrt(random())*3*scale;
            double along=Math.Cos(spawnAngle)*radius,across=Math.Sin(spawnAngle)*radius;
            var p=Particle(a.X+(b.X-a.X)*t+tx*along+nx*across,a.Y+(b.Y-a.Y)*t+ty*along+ny*across,false);
            double angle=random()*Math.PI*2,speed=(25+random()*75)*scale;
            double drift=Math.Cos(angle)*speed*.55,outward=Math.Sin(angle)*speed;
            p.Vx=tx*drift+nx*outward;p.Vy=ty*drift+ny*outward;
        }
        LimitParticles();
    }
    void Triangle(double x,double y,int count,bool burst){
        count=(int)Math.Floor(count*Density+.5);for(int i=0;i<count;i++)Particle(x,y,burst);LimitParticles();
    }
    Item Particle(double x,double y,bool burst){
        double a=random()*Math.PI*2,s=burst?60+random()*130:15+random()*40;
        var p=new Item{X=x,Y=y,Vx=Math.Cos(a)*s,Vy=Math.Sin(a)*s,Angle=a,Spin=(random()-.5)*2,Life=burst?.42+.25*random():.28+.16*random(),Size=(3+random()*4)*Size*(burst?ClickFragmentSize:TrailFragmentSize),Light=.5+.5*random(),Burst=burst};Particles.Add(p);return p;
    }
    void LimitParticles(){if(Particles.Count>192)Particles.RemoveRange(0,Particles.Count-192);}
    public void Update(double dt){
        dt=Clamp(dt,0,.1);foreach(var list in new[]{Points,Rings}){foreach(var p in list)p.Age+=dt;for(int i=list.Count-1;i>=0;i--)if(list[i].Age>=list[i].Life)list.RemoveAt(i);}
        for(int i=Particles.Count-1;i>=0;i--){
            var p=Particles[i];
            // Speed changes the playback clock of the entire particle, so its
            // path, terminal position and fade progress stay tied together.
            // Zero speed is a stationary fade rather than an endless effect.
            double step=Math.Min(p.Life-p.Age,dt*(particleSpeed>0?particleSpeed:1));
            if(particleSpeed>0){p.X+=p.Vx*step;p.Y+=p.Vy*step;p.Angle+=p.Spin*step;}
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
    double ParticleAlpha(Item p){
        // Brightness is chosen once at birth, never randomized per frame.
        // Keep the early portion legible, then fade smoothly to zero.
        double t=Math.Max(0,1-p.Age/p.Life);
        return Opacity*(p.Burst?ClickOpacity:TrailOpacity)*p.Light*t*(1.8-.8*t);
    }
    void TrailHalo(double intensity){
        for(int i=1;i<SmoothTrail.Count;i++){var a=SmoothTrail[i-1];var b=SmoothTrail[i];double dx=b.X-a.X,dy=b.Y-a.Y,len=Math.Sqrt(dx*dx+dy*dy);if(b.Start||len==0)continue;Add(3,a.X,a.Y,len,Size*TrailWidth,Math.Atan2(dy,dx),Opacity*TrailOpacity*.9*b.Fade*intensity);}
    }
    void Halo(double intensity){
        foreach(var r in Rings){double t=r.Age/r.Life,scale=Size*RippleSize,alpha=Opacity*ClickOpacity*(1-t)*.85*intensity,radius=(8+72*t)*scale;Add(4,r.X,r.Y,radius,24*scale,0,alpha*.07);Add(4,r.X,r.Y,radius,13*scale,0,alpha*.13);Add(4,r.X,r.Y,radius,6*scale,0,alpha*.24);}
        foreach(var p in Particles)Add(5,p.X,p.Y,0,p.Size/5,p.Angle,ParticleAlpha(p)*intensity);
    }
    public bool Draw(double dt){
        Update(dt);if(Alive==0&&!Dirty)return false;Commands.Clear();BuildSmoothTrail();
        // Render the trail before independent rings/fragments. Trail coverage
        // uses MAX blending, avoiding brighter sample joints and loop crossings.
        if(Strength>0)TrailHalo(1-Math.Pow(.45,Strength));
        for(int i=1;i<SmoothTrail.Count;i++){var a=SmoothTrail[i-1];var b=SmoothTrail[i];if(b.Start||a.X==b.X&&a.Y==b.Y)continue;Add(0,a.X,a.Y,b.X,b.Width,0,Opacity*TrailOpacity*.9*b.Fade,b.Y);}
        for(double remaining=Strength*.55;remaining>0;remaining-=1)Halo(Math.Min(1,remaining));
        foreach(var r in Rings){double t=r.Age/r.Life;Add(1,r.X,r.Y,(8+72*t)*Size*RippleSize,2.5*Size*RippleSize,0,Opacity*ClickOpacity*(1-t)*.85);}
        foreach(var p in Particles)Add(2,p.X,p.Y,0,p.Size,p.Angle,ParticleAlpha(p));
        Dirty=Alive>0;return true;
    }
    public Rectangle Surface(){
        double left=double.PositiveInfinity,top=left,right=double.NegativeInfinity,bottom=right;
        Action<Item,double> extend=(p,pad)=>{left=Math.Min(left,p.X-pad);top=Math.Min(top,p.Y-pad);right=Math.Max(right,p.X+pad);bottom=Math.Max(bottom,p.Y+pad);};
        foreach(var p in Points)extend(p,34*Size*TrailWidth+2);foreach(var p in Particles)extend(p,10*p.Size+2);foreach(var r in Rings)extend(r,(22+72*r.Age/r.Life)*Size*RippleSize+2);
        if(double.IsPositiveInfinity(left))return new Rectangle(0,0,1,1);
        left=Math.Max(0,Math.Floor(left/64)*64);top=Math.Max(0,Math.Floor(top/64)*64);right=Math.Min(Viewport.Width,right);bottom=Math.Min(Viewport.Height,bottom);
        if(right<=left||bottom<=top)return new Rectangle(0,0,1,1);
        return new Rectangle((int)left,(int)top,(int)Math.Max(1,Math.Min(Viewport.Width-left,Math.Ceiling((right-left)/128)*128)),(int)Math.Max(1,Math.Min(Viewport.Height-top,Math.Ceiling((bottom-top)/128)*128)));
    }
}
