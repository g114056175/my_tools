using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;

sealed partial class CursorHost {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr value,out long created,out long exited,out long kernel,out long user);
    [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr value,ref ProcessMemory memory,uint size);
    [StructLayout(LayoutKind.Sequential)] struct ProcessMemory {public uint Size,PageFaultCount;public UIntPtr PeakWorkingSet,WorkingSet,PeakPagedPool,PagedPool,PeakNonPagedPool,NonPagedPool,Pagefile,PeakPagefile,Private;}
    sealed class Snapshot {public double Cpu;public long Private,Working;}
    Snapshot SampleProcess(){var s=new Snapshot();var h=OpenProcess(0x410,false,Process.GetCurrentProcess().Id);if(h==IntPtr.Zero)throw new Exception("Process metrics");try{long c,e,k,u;if(!GetProcessTimes(h,out c,out e,out k,out u))throw new Exception("CPU metrics");s.Cpu=(k+u)/10000.0;var m=new ProcessMemory();m.Size=(uint)Marshal.SizeOf(m);if(!GetProcessMemoryInfo(h,ref m,m.Size))throw new Exception("Memory metrics");s.Private=(long)m.Private.ToUInt64();s.Working=(long)m.WorkingSet.ToUInt64();}finally{CloseHandle(h);}return s;}
    static double Percentile(List<double> items,double p){var sorted=items.OrderBy(x=>x).ToArray();return sorted.Length==0?0:sorted[Math.Min(sorted.Length-1,(int)(sorted.Length*p))];}
    async Task<object> MeasurePhase(string name,bool active,bool maximum,bool large=false,bool highSpeed=false){
        controls.Updating=true;controls.Strength.Value=maximum?300:100;controls.ParticleStrength.Value=maximum?300:100;foreach(var n in new[]{controls.EffectSize,controls.RippleSize,controls.TrailFragmentSize,controls.ClickFragmentSize,controls.ParticleSpeed})n.Value=large?300:100;controls.Updating=false;Configure();StopAnimation(true);await Task.Delay(1000);
        int count=0;long start=clock.ElapsedMilliseconds;var injection=new System.Windows.Forms.Timer{Interval=16};injection.Tick+=(s,e)=>{double time=(clock.ElapsedMilliseconds-start)/1000.0;var b=overlay.Bounds;double x=highSpeed?b.Left+(count%2==0?90:b.Width-90):b.Left+b.Width/2+400*Math.Sin(time*2);Pointer(x,b.Top+b.Height/2+200*Math.Sin(time*3),count++%38==0,true);};
        var before=SampleProcess();Intervals.Clear();DrawTimes.Clear();long frameStart=Frames;measuring=true;if(active)injection.Start();File.WriteAllText(Path.Combine(profile,"performance-phase.json"),Json.Serialize(new{phase=name,processIds=new[]{Process.GetCurrentProcess().Id}}));
        await Task.Delay(6000);injection.Stop();injection.Dispose();measuring=false;long elapsed=clock.ElapsedMilliseconds-start;var after=SampleProcess();File.WriteAllText(Path.Combine(profile,"performance-phase.json"),Json.Serialize(new{phase="transition",processIds=new[]{Process.GetCurrentProcess().Id}}));
        var value=new{phase=name,elapsedMs=elapsed,cpuMilliseconds=after.Cpu-before.Cpu,cpuPercentAllLogicalProcessors=(after.Cpu-before.Cpu)/elapsed/Environment.ProcessorCount*100,privateMiB=after.Private/1048576.0,workingSetMiB=after.Working/1048576.0,processCount=1,frames=new{frames=Frames-frameStart,drawMeanMs=DrawTimes.Count>0?DrawTimes.Average():0,drawP95Ms=Percentile(DrawTimes,.95),frameP95Ms=Percentile(Intervals,.95),over33ms=Intervals.Count(t=>t>33.4),surface=new{renderer.Surface.Width,renderer.Surface.Height}}};StopAnimation(true);return value;
    }
    async void RunPerformance(){try{
        controls.HidePanel();ResetControls();await Task.Delay(1500);var phases=new List<object>();phases.Add(await MeasurePhase("idle",false,false));phases.Add(await MeasurePhase("active-default",true,false));phases.Add(await MeasurePhase("active-maximum",true,true));phases.Add(await MeasurePhase("active-all-max",true,true,true));phases.Add(await MeasurePhase("active-high-speed",true,true,false,true));phases.Add(await MeasurePhase("idle-after-effects",false,false));
        File.WriteAllText(Path.Combine(profile,"performance.json"),Json.Serialize(new{passed=!failed,hardware=renderer.Hardware,logicalProcessors=Environment.ProcessorCount,bounds=new{overlay.Bounds.Width,overlay.Bounds.Height},phases,notes=new[]{"Own native process only; no browser processes.","6-second phases at 60FPS. active-all-max also sets all sizes and particle speed to 300%; active-high-speed alternates across desktop width with glow/density at 300%.","Private commit is not resident RAM. Draw timings are CPU submission, not GPU completion.","Coordinates are injected into this application, never OS input."}}));Quit(0);
    }catch(Exception e){File.WriteAllText(Path.Combine(profile,"performance.json"),Json.Serialize(new{passed=false,error=e.ToString()}));Quit(1);}}
}
