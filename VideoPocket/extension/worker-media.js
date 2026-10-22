import {isBroadcastIdentityField,isMediaMetadataField,isMediaShapeField,isStrongMediaField} from './media-schema.js';
// Observe metadata crossing the existing player/Worker boundary. Do not
// replace worker scripts, read media buffers, or infer ownership from timing.
const MEDIA_KEY = isMediaMetadataField;
const MEDIA_SIGNAL_KEY = key => isStrongMediaField(key) || isBroadcastIdentityField(key) || isMediaShapeField(key);
const MEDIA_TEXT = /^(?:https?:\/\/|#EXTM3U\b|<MPD\b)/i;

export function observeWorkerMetadata(target,onValue,options={}){
  const NativeWorker=target.Worker;
  if(typeof NativeWorker!=='function')return ()=>{};
  const tracked=new WeakSet(),states=new WeakMap(),listeners=[];
  let disposed=false;
  const bounded=!!options.metadataOnly;
  const maxDepth=Math.max(1,Math.min(24,Number(options.maxDepth)||8));
  const maxNodes=Math.max(32,Math.min(4096,Number(options.maxNodes)||512));
  const maxCharacters=Math.max(4096,Math.min(512*1024,Number(options.maxCharacters)||128*1024));
  const maxMessages=Math.max(1,Math.min(512,Number(options.maxMessages)||120));
  const clock=typeof options.now==='function'?options.now:()=>Date.now();
  const permit=state=>{
    if(!state)return true;
    let stamp;
    try{stamp=Number(clock());}catch{stamp=Date.now();}
    if(!Number.isFinite(stamp))stamp=Date.now();
    if(stamp<state.windowStart||stamp-state.windowStart>=1000){state.windowStart=stamp;state.messages=0;}
    if(state.messages>=maxMessages)return false;
    state.messages++;return true;
  };
  const hasMediaSignal=(node,depth=0,key='',seen=new WeakSet(),budget={left:maxNodes})=>{
    if(depth>maxDepth||node==null||budget.left--<=0)return false;
    if(typeof node==='string')return MEDIA_TEXT.test(node) || (key==='key' && /^(?:broadcast_(?:id|url|media_key|media_id|title)|media_key)$/i.test(node));
    if(typeof node!=='object')return false;
    if(seen.has(node))return false;
    let proto;try{proto=Object.getPrototypeOf(node)}catch{return false;}
    if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return false;
    if(MEDIA_SIGNAL_KEY(key))return true;
    seen.add(node);
    let keys;
    try{keys=Array.isArray(node)?Array.from({length:Math.min(node.length,160)},(_,index)=>String(index)):Object.keys(node).slice(0,160);}catch{return false;}
    for(const childKey of keys){
      const field=Object.getOwnPropertyDescriptor(node,childKey);
      if(field&&Object.hasOwn(field,'value')&&hasMediaSignal(field.value,depth+1,childKey,seen,budget))return true;
    }
    return false;
  };
  const metadata=(value,state)=>{
    let remaining=bounded?maxNodes:4096,characters=0;const seen=new WeakSet();
    const copy=(node,depth=0,key='')=>{
      if(--remaining<0||depth>(bounded?maxDepth:24))return undefined;
      if(typeof node==='string'){
        if(bounded&&!MEDIA_KEY(key)&&!MEDIA_TEXT.test(node))return undefined;
        if(bounded&&/^(?:video_)?(?:title|name)$/i.test(key)&&node.length>512)return undefined;
        characters+=node.length;return characters<= (bounded?maxCharacters:512*1024)?node:undefined;
      }
      if(node==null||typeof node==='number'||typeof node==='boolean')return node;
      if(typeof node!=='object'||seen.has(node))return undefined;
      // Worker messages may carry entire encoded segments. Leave all native
      // objects and buffers alone, including transferred/detached buffers.
      const proto=Object.getPrototypeOf(node);
      if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return undefined;
      seen.add(node);const out=Array.isArray(node)?[]:Object.create(null);
      let keys;
      try{keys=Array.isArray(node)?Array.from({length:Math.min(node.length,160)},(_,index)=>String(index)):Object.keys(node).slice(0,160);}catch{return undefined;}
      for(const key of keys){
        if(remaining<=0||characters>512*1024)break;
        const field=Object.getOwnPropertyDescriptor(node,key);
        if(!field||!Object.hasOwn(field,'value')||key==='length')continue;
        if(bounded&&Array.isArray(field.value)&&field.value.length>160&&!MEDIA_KEY(key))continue;
        if(bounded&&!Array.isArray(node)&&!MEDIA_KEY(key)&&(!field.value||typeof field.value!=='object'))continue;
        const child=copy(field.value,depth+1,key);if(child!==undefined)out[key]=child;
      }
      return bounded&&Object.keys(out).length===0?undefined:out;
    };
    try{const result=copy(value);if(result!==undefined&&(!bounded||hasMediaSignal(result))){onValue(result);return true;}}catch{}
    return false;
  };
  const WrappedWorker=new Proxy(NativeWorker,{construct(original,args,newTarget){
    const worker=Reflect.construct(original,args,newTarget);
    if(!disposed&&listeners.length<32)try{
      const state={messages:0,windowStart:0};states.set(worker,state);
      const receive=event=>{if(!disposed&&permit(state))metadata(event.data,state);};
      worker.addEventListener('message',receive);tracked.add(worker);
      listeners.push({worker:new WeakRef(worker),receive,state});
    }catch{}
    return worker;
  }});
  const proto=NativeWorker.prototype,originalPost=proto.postMessage;
  const wrappedPost=typeof originalPost==='function'?function(...args){
    const result=originalPost.apply(this,args);
    if(!disposed&&tracked.has(this)){
      const state=states.get(this);
      if(permit(state))metadata(args[0],state);
    }
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
