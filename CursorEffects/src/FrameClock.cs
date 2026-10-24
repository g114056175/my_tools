using System;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// A sleeping worker waits on a one-shot high-resolution kernel timer. No busy
// polling and no global timeBeginPeriod request; inactive effects disarm it.
sealed class FrameClock : IDisposable {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWaitableTimerEx(IntPtr attributes,string name,uint flags,uint access);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetWaitableTimer(SafeWaitHandle timer,ref long due,int period,IntPtr callback,IntPtr state,bool resume);
    [DllImport("kernel32.dll")] static extern bool CancelWaitableTimer(SafeWaitHandle timer);
    readonly EventWaitHandle timer=new EventWaitHandle(false,EventResetMode.AutoReset),exit=new EventWaitHandle(false,EventResetMode.ManualReset);
    readonly Thread worker;bool disposed;public readonly bool HighResolution;
    public FrameClock(Action tick){
        IntPtr handle=CreateWaitableTimerEx(IntPtr.Zero,null,2,0x1f0003);HighResolution=handle!=IntPtr.Zero;
        if(handle==IntPtr.Zero)handle=CreateWaitableTimerEx(IntPtr.Zero,null,0,0x1f0003);
        if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
        timer.SafeWaitHandle=new SafeWaitHandle(handle,true);worker=new Thread(()=>{var events=new WaitHandle[]{timer,exit};while(WaitHandle.WaitAny(events)==0){try{tick();}catch{exit.Set();}}}){IsBackground=true,Name="Cursor frame clock"};worker.Start();
    }
    public void Arm(double milliseconds){if(disposed)return;long due=-Math.Max(1,(long)Math.Ceiling(Math.Max(0,milliseconds)*10000));if(!SetWaitableTimer(timer.SafeWaitHandle,ref due,0,IntPtr.Zero,IntPtr.Zero,false))throw new System.ComponentModel.Win32Exception();}
    public void Cancel(){if(!disposed)CancelWaitableTimer(timer.SafeWaitHandle);}
    public void Dispose(){if(disposed)return;disposed=true;CancelWaitableTimer(timer.SafeWaitHandle);exit.Set();worker.Join();timer.Dispose();exit.Dispose();}
}
