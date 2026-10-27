/** A failed worker wake-up must not leave a document permanently unconfigured. */
export class StartupHandshake{
 constructor({request,accept,alive=()=>true,mayRetry=()=>true,onError=()=>{},delays=[150,500,1500],timeout=1500}){
  Object.assign(this,{request,accept,alive,mayRetry,onError,delays,timeout,task:null,controller:null,ready:false,disposed:false,status:'idle',attempts:0,error:''});
 }
 ensure({force=false,reason='initial'}={}){
  if(this.disposed)return Promise.resolve(false);
  if(this.task)return this.task;
  if(this.ready&&!force)return Promise.resolve(true);
  this.ready=false;this.reason=reason;
  const controller=new AbortController();this.controller=controller;
  const task=this.run(controller.signal).catch(error=>{this.status='failed';this.error=String(error?.message||error);this.onError(error);return false;}).finally(()=>{if(this.task===task){this.task=null;this.controller=null;}});
  this.task=task;return task;
 }
 wait(milliseconds,signal){
  return new Promise(resolve=>{
   if(signal.aborted){resolve(false);return;}
   const done=value=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);};
   const abort=()=>done(false),timer=setTimeout(()=>done(true),milliseconds);
   signal.addEventListener('abort',abort,{once:true});
  });
 }
 receive(signal){
  return new Promise(resolve=>{
   let settled=false,timer;
   const done=result=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(result);};
   const abort=()=>done(null);
   if(signal.aborted){done(null);return;}
   signal.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>{this.error='Background connection timed out';done(null);},this.timeout);
   Promise.resolve().then(()=>this.request()).then(done,error=>{this.error=String(error?.message||error);done(null);});
  });
 }
 async run(signal){
  for(let attempt=0;attempt<=this.delays.length;attempt++){
   if(this.disposed||!this.alive())return false;
   if(signal.aborted)return this.ready;
   this.attempts++;this.status='requesting';
   const response=await this.receive(signal);
   if(signal.aborted||this.disposed)return this.ready&&!this.disposed;
   if(response?.ok&&this.accept(response)){this.ready=true;this.status='ready';this.error='';return true;}
   this.error=response?.error||this.error||'Background connection unavailable';
   if(attempt===this.delays.length||!this.mayRetry()||!this.alive())break;
   this.status='retrying';if(!await this.wait(this.delays[attempt],signal))return this.ready&&!this.disposed;
  }
  this.status='waiting';return false;
 }
 acknowledge(){if(this.disposed)return;this.ready=true;this.status='ready';this.error='';this.controller?.abort();}
 dispose(){this.disposed=true;this.ready=false;this.status='disposed';this.controller?.abort();}
 snapshot(){return {status:this.status,attempts:this.attempts,reason:this.reason||'',error:this.error};}
}
