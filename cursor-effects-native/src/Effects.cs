using System;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] struct DrawCommand {
    public int Kind;public float X,Y,X2,Y2,Width,Angle,Alpha;
    public DrawCommand(int kind,double x,double y,double x2,double y2,double width,double angle,double alpha){Kind=kind;X=(float)x;Y=(float)y;X2=(float)x2;Y2=(float)y2;Width=(float)width;Angle=(float)(angle*180/Math.PI);Alpha=(float)alpha;}
}
sealed class CursorEffects {
    internal sealed class Item {public double X,Y,Vx,Vy,Angle,Spin,Age,Life,Size;public bool Start,Burst;}
    internal readonly List<Item> Points=new List<Item>(32),Particles=new List<Item>(192),Rings=new List<Item>(16);
    public readonly List<DrawCommand> Commands=new List<DrawCommand>(1600);
    readonly Func<double> random;Item last;
    public bool Trail=true,Click=true,Dirty;public double Size=1,Strength=1,Density=1,Opacity=1;public int Fps=60;
    public double TrailWidth=1,RippleSize=1,TrailFragmentSize=1,ClickFragmentSize=1,TrailOpacity=1,ClickOpacity=1;double particleSpeed=1;
    public Rectangle Viewport=System.Windows.Forms.SystemInformation.VirtualScreen;
    public CursorEffects(Func<double> value=null){var rng=new Random();random=value??rng.NextDouble;}
    public int Alive {get{return Points.Count+Particles.Count+Rings.Count;}}
    public void Configure(bool trail,bool click,double size,double strength,double density,double opacity,int fps){
        double old=Size;Trail=trail;Click=click;Size=Clamp(size,.25,3);Strength=Clamp(strength,0,3);Density=Clamp(density,0,3);Opacity=Clamp(opacity,0,1);Fps=Math.Max(15,Math.Min(360,fps));foreach(var p in Particles)p.Size*=Size/old;Dirty=true;
    }
    public void Customize(double width,double ripple,double trailFragment,double clickFragment,double trailOpacity,double clickOpacity){
        double oldTrail=TrailFragmentSize,oldClick=ClickFragmentSize;TrailWidth=Clamp(width,.25,3);RippleSize=Clamp(ripple,.25,3);TrailFragmentSize=Clamp(trailFragment,.25,3);ClickFragmentSize=Clamp(clickFragment,.25,3);TrailOpacity=Clamp(trailOpacity,0,1);ClickOpacity=Clamp(clickOpacity,0,1);
        foreach(var p in Particles)p.Size*=p.Burst?ClickFragmentSize/oldClick:TrailFragmentSize/oldTrail;Dirty=true;
    }
    public void SetParticleSpeed(double speed){particleSpeed=Clamp(speed,0,3);Dirty=true;}
    static double Clamp(double value,double min,double max){return double.IsNaN(value)||double.IsInfinity(value)?min:Math.Max(min,Math.Min(max,value));}
    static double Distance(Item a,Item b){double x=a.X-b.X,y=a.Y-b.Y;return Math.Sqrt(x*x+y*y);}
    public void Clear(bool resetPointer=true){Points.Clear();Particles.Clear();Rings.Clear();Commands.Clear();if(resetPointer)last=null;Dirty=false;}
    public void Input(double x,double y,bool down,bool pressed,bool blocked=false){
        if(blocked||x<Viewport.Left||y<Viewport.Top||x>=Viewport.Right||y>=Viewport.Bottom){last=null;return;}
        if(Opacity==0||!Trail&&!Click)return;
        var p=new Item{X=x-Viewport.Left,Y=y-Viewport.Top};
        if(down)last=null;
        if(pressed&&!down&&last!=null&&Distance(p,last)<1.5)return;
        // Each accepted cursor sample is joined to the preceding sample, even
        // when a fast drag covers an entire monitor between input ticks. Also
        // keep the final mouse-up position and resume from a stationary anchor.
        if((pressed||last!=null)&&Trail&&TrailOpacity>0&&(last==null||Distance(p,last)>1.5)){
            if(last!=null&&Points.Count==0)Points.Add(new Item{X=last.X,Y=last.Y,Life=.32,Start=true});
            p.Start=last==null;p.Life=.32;Points.Add(p);if(Points.Count>32)Points.RemoveAt(0);
            if(last!=null){double distance=Distance(p,last);if(distance>3)TrailParticles(last,p,distance);}
        }
        if(down&&Click&&ClickOpacity>0){Rings.Add(new Item{X=p.X,Y=p.Y,Life=.42});if(Rings.Count>16)Rings.RemoveAt(0);Triangle(p.X,p.Y,12,true);}
        last=pressed?p:null;if(pressed||down||Points.Count>0)Dirty=true;
    }
    void TrailParticles(Item a,Item b,double distance){
        // Distribute fragments along the sampled path instead of piling them
        // at its endpoint. Bound work for very long/high-DPI cursor jumps.
        int count=(int)Math.Floor(Math.Min(12,Math.Ceiling(distance/24))*Density+.5);
        for(int i=0;i<count;i++){double t=(i+.5)/count;Particle(a.X+(b.X-a.X)*t,a.Y+(b.Y-a.Y)*t,false);}
        LimitParticles();
    }
    void Triangle(double x,double y,int count,bool burst){
        count=(int)Math.Floor(count*Density+.5);for(int i=0;i<count;i++)Particle(x,y,burst);LimitParticles();
    }
    void Particle(double x,double y,bool burst){
        double a=random()*Math.PI*2,s=burst?60+random()*130:15+random()*40;
        Particles.Add(new Item{X=x,Y=y,Vx=Math.Cos(a)*s,Vy=Math.Sin(a)*s,Angle=a,Spin=(random()-.5)*2,Life=burst?.42+.25*random():.28+.16*random(),Size=(3+random()*4)*Size*(burst?ClickFragmentSize:TrailFragmentSize),Burst=burst});
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
    void Halo(double intensity){
        for(int i=1;i<Points.Count;i++){var a=Points[i-1];var b=Points[i];double len=Distance(a,b);if(b.Start||len==0)continue;Add(3,a.X,a.Y,len,Size*TrailWidth,Math.Atan2(b.Y-a.Y,b.X-a.X),Opacity*TrailOpacity*.9*(1-b.Age/b.Life)*intensity);}
        foreach(var r in Rings){double t=r.Age/r.Life,scale=Size*RippleSize,alpha=Opacity*ClickOpacity*(1-t)*.85*intensity,radius=(8+72*t)*scale;Add(4,r.X,r.Y,radius,24*scale,0,alpha*.07);Add(4,r.X,r.Y,radius,13*scale,0,alpha*.13);Add(4,r.X,r.Y,radius,6*scale,0,alpha*.24);}
        foreach(var p in Particles)Add(5,p.X,p.Y,0,p.Size/5,p.Angle,Opacity*(p.Burst?ClickOpacity:TrailOpacity)*(1-p.Age/p.Life)*intensity);
    }
    public bool Draw(double dt){
        Update(dt);if(Alive==0&&!Dirty)return false;Commands.Clear();
        for(double remaining=Strength*.55;remaining>0;remaining-=1)Halo(Math.Min(1,remaining));
        for(int i=1;i<Points.Count;i++){var a=Points[i-1];var b=Points[i];if(b.Start||Distance(a,b)==0)continue;Add(0,a.X,a.Y,b.X,(1.5+2*(double)i/Points.Count)*Size*TrailWidth,0,Opacity*TrailOpacity*.9*(1-b.Age/b.Life),b.Y);}
        foreach(var r in Rings){double t=r.Age/r.Life;Add(1,r.X,r.Y,(8+72*t)*Size*RippleSize,2.5*Size*RippleSize,0,Opacity*ClickOpacity*(1-t)*.85);}
        foreach(var p in Particles)Add(2,p.X,p.Y,0,p.Size,p.Angle,Opacity*(p.Burst?ClickOpacity:TrailOpacity)*(1-p.Age/p.Life));
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
