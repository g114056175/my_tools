// Observe metadata crossing the existing player/Worker boundary. Do not
// replace worker scripts, read media buffers, or infer ownership from timing.
export function observeWorkerMetadata(target,onValue){
  const NativeWorker=target.Worker;
  if(typeof NativeWorker!=='function')return ()=>{};
  const tracked=new WeakSet(),listeners=[];
  let disposed=false;
  const metadata=value=>{
    let remaining=4096,characters=0;const seen=new WeakSet();
    const copy=(node,depth=0)=>{
      if(--remaining<0||depth>24)return undefined;
      if(typeof node==='string'){characters+=node.length;return characters<=512*1024?node:undefined;}
      if(node==null||typeof node==='number'||typeof node==='boolean')return node;
      if(typeof node!=='object'||seen.has(node))return undefined;
      // Worker messages may carry entire encoded segments. Leave all native
      // objects and buffers alone, including transferred/detached buffers.
      const proto=Object.getPrototypeOf(node);
      if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return undefined;
      seen.add(node);const out=Array.isArray(node)?[]:Object.create(null);
      for(const key of Object.keys(node).slice(0,160)){
        if(remaining<=0||characters>512*1024)break;
        const field=Object.getOwnPropertyDescriptor(node,key);
        if(!Object.hasOwn(field,'value')||key==='length')continue;
        const child=copy(field.value,depth+1);if(child!==undefined)out[key]=child;
      }
      return out;
    };
    try{const result=copy(value);if(result!==undefined)onValue(result);}catch{}
  };
  const WrappedWorker=new Proxy(NativeWorker,{construct(original,args,newTarget){
    const worker=Reflect.construct(original,args,newTarget);
    if(!disposed&&listeners.length<32)try{
      const receive=event=>{if(!disposed)metadata(event.data);};
      worker.addEventListener('message',receive);tracked.add(worker);
      listeners.push({worker:new WeakRef(worker),receive});
    }catch{}
    return worker;
  }});
  const proto=NativeWorker.prototype,originalPost=proto.postMessage;
  const wrappedPost=typeof originalPost==='function'?function(...args){
    const result=originalPost.apply(this,args);
    if(!disposed&&tracked.has(this))metadata(args[0]);
    return result;
  }:null;
  const dispose=()=>{
    disposed=true;
    if(target.Worker===WrappedWorker)target.Worker=NativeWorker;
    if(wrappedPost&&proto.postMessage===wrappedPost)proto.postMessage=originalPost;
    for(const {worker,receive} of listeners.splice(0))try{worker.deref()?.removeEventListener('message',receive);}catch{}
  };
  try{
    target.Worker=WrappedWorker;
    if(wrappedPost)proto.postMessage=wrappedPost;
  }catch{try{dispose();}catch{}return ()=>{};}
  return dispose;
}
