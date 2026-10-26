import {nativeRateFromEvent} from './native-rate-intent.js';

const MAX_REFERENCES=64;
const MAX_DIAGNOSTICS=32;
const MAX_PENDING=16;
const INPUT_WINDOW=900;
const POINTER_WINDOW=2600;
const USER_TOKEN_WINDOW=1200;
const EPSILON=0.001;
const MEDIA_EVENTS=['ratechange','emptied','loadstart','loadedmetadata','play','playing','waiting','timeupdate'];
const INPUT_EVENTS=['pointerdown','pointerup','click','input','change','keydown','keyup'];
const EDITABLE_TAGS=new Set(['INPUT','TEXTAREA','SELECT']);
const BLOCKED_KEYS=new Set([
 ' ','Space','Spacebar','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
 'Home','End','PageUp','PageDown','j','J','k','K','l','L','m','M','f','F',
 'c','C','t','T','w','W','n','N','MediaPlay','MediaPause','MediaStop','MediaPlayPause','MediaTrackNext','MediaTrackPrevious',
]);

function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function mediaTime(video){try{const value=video.currentTime;return finite(value)?value:null;}catch{return null;}}
function videoFrames(video){try{const value=video.getVideoPlaybackQuality?.();return finite(value?.totalVideoFrames)&&finite(value?.droppedVideoFrames)?Math.max(0,value.totalVideoFrames-value.droppedVideoFrames):null;}catch{return null;}}
function equalRate(a,b){return finite(a)&&finite(b)&&Math.abs(a-b)<=EPSILON;}
function shortReason(value){
 if(typeof value!=='string')return '';
 return value.trim().replace(/[^a-zA-Z0-9_.:-]/gu,'').slice(0,40);
}
function shortMediaKey(value){
 if(typeof value!=='string')return undefined;
 const key=value.trim().replace(/[^a-zA-Z0-9_.:-]/gu,'').slice(0,96);
 return key||undefined;
}
function errorName(error){
 try{
  const name=error?.name;
  return typeof name==='string'&&name?name.slice(0,48):'Error';
 }catch{return 'Error';}
}
function safeStack(target){
 try{return new (target?.Error||Error)().stack?.slice(0,3000)||null;}catch{return null;}
}
function safeNow(target){
 try{const value=target?.performance?.now?.();if(finite(value))return value;}catch{}
 return Date.now();
}
function queueMicrotaskFor(target,callback){
 try{if(typeof target?.queueMicrotask==='function')return target.queueMicrotask(callback);}catch{}
 Promise.resolve().then(callback);
}
function isNode(value){return !!value&&typeof value==='object';}
function nodeTag(node){try{return String(node?.tagName||'').toUpperCase();}catch{return '';}}
function attr(node,name){try{return typeof node?.getAttribute==='function'?node.getAttribute(name):null;}catch{return null;}}
function textForClassification(node){
 try{return String(attr(node,'aria-label')||attr(node,'title')||node?.textContent||'').trim().replace(/\s+/gu,' ').toLowerCase();}catch{return '';}
}
function pathFor(event){
 try{const path=event?.composedPath?.();if(Array.isArray(path)&&path.length)return path;}catch{}
 const path=[];let node=event?.target;const seen=new Set();
 while(node&&path.length<32&&!seen.has(node)){
  path.push(node);seen.add(node);
  try{node=node.parentElement||node.host||null;}catch{node=null;}
 }
 return path;
}
function isEditablePath(path){
 for(const node of path){
  if(!isNode(node))continue;
  const tag=nodeTag(node),role=String(attr(node,'role')||'').toLowerCase();
  try{if(node.isContentEditable)return true;}catch{}
  if(EDITABLE_TAGS.has(tag)||['textbox','combobox','slider'].includes(role))return true;
 }
 return false;
}
function nonRateControl(path){
 for(const node of path.slice(0,10)){
  if(!isNode(node))continue;
  const tag=nodeTag(node),role=String(attr(node,'role')||'').toLowerCase();
  if(tag==='INPUT'){
   const volumeLabel=[attr(node,'aria-label'),attr(node,'title'),attr(node,'name'),attr(node,'id')].filter(value=>typeof value==='string').join(' ').toLowerCase();
   if(/volume|音量/u.test(volumeLabel))return true;
  }
  if(tag!=='BUTTON'&&role!=='button')continue;
  const label=textForClassification(node).replace(/[\s:：·.,!?/\\()[\]{}_-]+/gu,'');
  if(/^(?:play|pause|playvideo|pausevideo|播放|暫停|播放暫停|quality|videoquality|畫質|影片畫質)$/u.test(label))return true;
 }
 return false;
}

export class RateBridge{
 constructor(target=globalThis,{syncPlayerRate=()=>{}}={}){
  this.target=target||globalThis;
  this.syncPlayerRate=typeof syncPlayerRate==='function'?syncPlayerRate:()=>{};
  this.started=false;
  this.onObservation=()=>{};
  this.seq=0;
  this.epoch=0;
  this.records=new WeakMap();
  this.references=new Set();
  this.nativeDescriptors=new Map();
  this.restorers=[];
  this.globalListeners=[];
  this.vcContext=null;
  this.keyContext=null;
  this.pointerOwner=null;
  this.document=this.target?.document||null;
 }

 start(onObservation){
  if(typeof onObservation==='function')this.onObservation=onObservation;
  if(this.started)return true;
  const prototype=this.target?.HTMLMediaElement?.prototype;
  if(!prototype)return false;
  this.started=true;
  for(const name of ['playbackRate','defaultPlaybackRate','src','srcObject']){
   const descriptor=Object.getOwnPropertyDescriptor(prototype,name);
   if(descriptor)this.nativeDescriptors.set(name,descriptor);
  }
  this._patchAccessor(prototype,'playbackRate');
  this._patchAccessor(prototype,'defaultPlaybackRate');
  this._patchAccessor(prototype,'src');
  this._patchAccessor(prototype,'srcObject');
  this._patchMethod(prototype,'load');
  this._listenGlobal();
  return true;
 }

 stop(){
  if(!this.started)return;
  for(const record of [...this.references])this._releaseDefault(record,'stop',true);
  for(const record of [...this.references]){this._detachMedia(record);this.records.delete(record.video);}
  this.references.clear();
  for(const listener of this.globalListeners.splice(0)){
   try{listener.target.removeEventListener(listener.type,listener.handler,true);}catch{}
  }
  for(const restore of this.restorers.splice(0).reverse()){
   try{
    const current=Object.getOwnPropertyDescriptor(restore.object,restore.key);
    if(restore.matches(current))Object.defineProperty(restore.object,restore.key,restore.original);
   }catch{}
  }
  this.started=false;
  this.keyContext=null;
  this.pointerOwner=null;
  this.vcContext=null;
  this.onObservation=()=>{};
 }

 execute(video,{op='read',rate,mediaKey,reason,selected,maintainDefault=true,retain=false}={}){
  if(!video||!this.started)return this._result('read-error',null,null,'bridge-not-started',this.seq,this.epoch);
  const record=this._register(video);
  if(mediaKey!==undefined&&mediaKey!==record.mediaKey){
   record.mediaKey=shortMediaKey(mediaKey);
   this._clearTokens(record);
   if(this.pointerOwner?.record===record)this.pointerOwner=null;
  }
  if(selected!==undefined)record.selected=selected===true;
  if(op==='read')return this._readResult(record,this._nextSeq());
  if(op==='release'){
   const seq=this._nextSeq();
   return this._releaseDefault(record,reason||'release',retain===true,seq);
  }
  if(op!=='apply'&&op!=='adopt')return this._result('write-error',null,null,'invalid-operation',this._nextSeq(),record.epoch);
  const seq=this._nextSeq();
  if(!finite(rate)){
   const values=this._readValues(record);
   const result=this._result('write-error',values.actual,values.default,'invalid-rate',seq,record.epoch);
   this._emit(record,{origin:'vc',property:op==='adopt'?'defaultPlaybackRate':'playbackRate',attemptedRate:null,...result,mediaKey:record.mediaKey,evidence:'invalid-rate',seq,epoch:record.epoch});
   return result;
  }
  const valuesBefore=this._readValues(record);
  if(valuesBefore.error){
   const result=this._result('read-error',valuesBefore.actual,valuesBefore.default,valuesBefore.error,seq,record.epoch);
   this._emit(record,{origin:'vc',property:op==='adopt'?'defaultPlaybackRate':'playbackRate',attemptedRate:rate,...result,mediaKey:record.mediaKey,evidence:'pre-write-read-error',seq,epoch:record.epoch});
   return result;
  }
  let liveStream=false;try{liveStream=typeof this.target.MediaStream==='function'&&video.srcObject instanceof this.target.MediaStream;}catch{}
  if(liveStream&&!equalRate(rate,1)){
   const result=this._result('unsupported',valuesBefore.actual,valuesBefore.default,'live-media-stream',seq,record.epoch);
   this._emit(record,{origin:'vc',property:'playbackRate',attemptedRate:rate,...result,mediaKey:record.mediaKey,evidence:'live-media-stream'});
   return result;
  }
  if(valuesBefore.default!==null)this._refreshDefaultOwnership(record,valuesBefore.default);
  if(op==='adopt'&&!equalRate(valuesBefore.actual,rate)){
   const result=this._result('mismatch',valuesBefore.actual,valuesBefore.default,null,seq,record.epoch);
   this._emit(record,{origin:'vc',property:'defaultPlaybackRate',attemptedRate:rate,...result,mediaKey:record.mediaKey,evidence:'actual-rate-not-selected',seq,epoch:record.epoch});
   return result;
  }
  const context={video,record,seq,op,reason:shortReason(reason),maintainDefault:maintainDefault!==false};
  const previous=this.vcContext;this.vcContext=context;
  let thrown=null,actualReadError=null,actualMatches=op==='adopt';
  let defaultRead=null,defaultAttempted=false,actualWriteAttempted=false;
  try{
   if(op==='apply'){
    try{this.syncPlayerRate(video,rate,this.target);}catch(error){thrown=error;}
    actualWriteAttempted=true;
    try{this._callNativeSetter(video,'playbackRate',rate);}catch(error){thrown=thrown||error;}
    const actualAfter=this._readNative(video,'playbackRate');
    actualReadError=actualAfter.error;
    actualMatches=actualAfter.value!==null&&equalRate(actualAfter.value,rate);
   }
   if(context.maintainDefault&&actualMatches&&!thrown&&!actualReadError){
    defaultAttempted=true;
    try{this._callNativeSetter(video,'defaultPlaybackRate',rate);}catch(error){thrown=thrown||error;}
    defaultRead=this._readNative(video,'defaultPlaybackRate');
   }
  }finally{this.vcContext=previous;}
  const values=this._readValues(record);
  let status='ready',error=null;
  if(thrown){status='write-error';error=errorName(thrown);}
  else if(actualReadError||values.error||defaultRead?.error){status='read-error';error=actualReadError||defaultRead?.error||values.error;}
  else if(!actualMatches||!equalRate(values.actual,rate)){status='mismatch';}
  else if(context.maintainDefault&&(!defaultRead||!equalRate(defaultRead.value,rate)||!equalRate(values.default,rate)))status='mismatch';
  const defaultChanged=valuesBefore.default!==null&&values.default!==null&&!equalRate(valuesBefore.default,values.default);
  if(defaultChanged)this._queuePending(record,'defaultPlaybackRate',values.default,'vc',seq);
  if(valuesBefore.actual!==null&&values.actual!==null&&!equalRate(valuesBefore.actual,values.actual))this._queuePending(record,'playbackRate',values.actual,'vc',seq);
  if(actualWriteAttempted&&(actualReadError||values.actual===null))this._queuePending(record,'playbackRate',rate,'vc',seq);
  if(defaultAttempted&&defaultRead&&!defaultRead.error&&valuesBefore.default!==null&&!equalRate(defaultRead.value,valuesBefore.default))this._queuePending(record,'defaultPlaybackRate',defaultRead.value,'vc',seq);
  if(context.maintainDefault){
   if(status==='ready')record.ownedDefault=rate;
   else if(defaultAttempted||defaultChanged){
    const expectedDefault=defaultRead?.value??values.default;
    if(defaultRead?.error||values.error&&values.default===null)record.ownedDefault=rate;
    else if(expectedDefault!==null&&!equalRate(expectedDefault,valuesBefore.default))this._rollbackDefault(record,expectedDefault,valuesBefore.default,seq);
    else record.ownedDefault=null;
   }
  }
  const result=this._result(status,values.actual,values.default,error,seq,record.epoch);
  const property=op==='adopt'?'defaultPlaybackRate':context.maintainDefault?'playbackRate+defaultPlaybackRate':'playbackRate';
  if(status==='ready'){
   record.appliedRate=rate;
   if(['command','native'].includes(reason)||video.paused||video.ended||video.readyState<2){record.starting=true;record.playAnchor=!video.paused&&!video.ended&&video.readyState>=2?mediaTime(video):null;record.playFrames=record.playAnchor===null?null:videoFrames(video);}
  }
  this._emit(record,{origin:'vc',property,attemptedRate:rate,...result,mediaKey:record.mediaKey,evidence:shortReason(reason)||'vc-execute',seq,epoch:record.epoch});
  return result;
 }

 diagnostics(video){
  const record=this.records.get(video);
  return record?record.diagnostics.map(entry=>({...entry})):[];
 }

 _patchAccessor(object,key){
  const original=this.nativeDescriptors.get(key);
  if(!original||(!original.get&&!original.set))return;
  const bridge=this;
  const descriptor={...original};
  if(typeof original.get==='function')descriptor.get=function(){return Reflect.apply(original.get,this,[]);};
  if(typeof original.set==='function')descriptor.set=function(value){return bridge._watchedSetter(this,key,original.set,value);};
  try{
   Object.defineProperty(object,key,descriptor);
   const wrapped=Object.getOwnPropertyDescriptor(object,key);
   this.restorers.push({object,key,original,wrapped,matches:current=>current?.get===wrapped.get&&current?.set===wrapped.set});
  }catch{}
 }

 _patchMethod(object,key){
  const original=Object.getOwnPropertyDescriptor(object,key);
  if(!original||typeof original.value!=='function')return;
  const bridge=this;
  const wrapped=function(...args){return bridge._watchedMethod(this,key,original.value,args);};
  try{
   Object.defineProperty(object,key,{...original,value:wrapped});
   const installed=Object.getOwnPropertyDescriptor(object,key);
   this.restorers.push({object,key,original,wrapped:installed,matches:current=>current?.value===installed.value});
  }catch{}
 }

 _listenGlobal(){
  const document=this.document;
  if(!document?.addEventListener)return;
  for(const type of INPUT_EVENTS){
   const handler=event=>this._handleInput(event);
   try{document.addEventListener(type,handler,true);this.globalListeners.push({target:document,type,handler});}catch{}
  }
 }

 _register(video){
  let record=this.records.get(video);
  if(record)return record;
  if(this.references.size>=MAX_REFERENCES){
   const oldest=this.references.values().next().value;
   if(oldest){this._releaseDefault(oldest,'capacity',true);this._detachMedia(oldest);this.references.delete(oldest);this.records.delete(oldest.video);}
  }
  const currentDefault=this._readNative(video,'defaultPlaybackRate');
  record={
   video,epoch:0,mediaKey:undefined,selected:false,loading:false,loadingReason:'',starting:true,playAnchor:!video.paused&&video.readyState>=2?mediaTime(video):null,playFrames:videoFrames(video),
   defaultBaseline:currentDefault.value,ownedDefault:null,appliedRate:null,lastActual:null,
   lastInput:null,tokens:[],pendingEvents:[],diagnostics:[],overrideStacks:0,
   attached:false,mediaHandlers:[],lastLoadObservation:null,
  };
  const actual=this._readNative(video,'playbackRate');record.lastActual=actual.value;
  this.records.set(video,record);this.references.add(record);this._attachMedia(record);
  this._observeSourceMutations(record);
  return record;
 }

 _attachMedia(record){
  if(record.attached||typeof record.video?.addEventListener!=='function')return;
  for(const type of MEDIA_EVENTS){
   const handler=event=>this._handleMediaEvent(record,event);
   try{record.video.addEventListener(type,handler,true);record.mediaHandlers.push({type,handler});}catch{}
  }
  record.attached=true;
 }

 _detachMedia(record){
  for(const item of record.mediaHandlers.splice(0)){
   try{record.video.removeEventListener(item.type,item.handler,true);}catch{}
  }
  try{record.sourceObserver?.disconnect();}catch{}
  record.sourceObserver=null;
  record.attached=false;
 }

 _observeSourceMutations(record){
  const Observer=this.target?.MutationObserver;
  if(typeof Observer!=='function'||record.sourceObserver)return;
  try{
   const observer=new Observer(mutations=>{
    if(!this.references.has(record)||!mutations.some(mutation=>this._isSourceMutation(record,mutation)))return;
    const seq=this._nextSeq();
    this._beginEpoch(record,'source-mutation',seq,'load');
   });
   observer.observe(record.video,{attributes:true,attributeFilter:['src'],childList:true,subtree:true});
   record.sourceObserver=observer;
  }catch{}
 }

 _isSourceMutation(record,mutation){
  const target=mutation?.target,type=mutation?.type;
  if(type==='attributes'&&mutation.attributeName==='src')return target===record.video||nodeTag(target)==='SOURCE';
  if(type==='childList'&&target===record.video){
   const changed=[...(mutation.addedNodes||[]),...(mutation.removedNodes||[])];
   return changed.some(node=>nodeTag(node)==='SOURCE');
  }
  return false;
 }

 _drainSourceMutations(record){
  try{record.sourceObserver?.takeRecords?.();}catch{}
 }

 _readNative(video,key){
  const descriptor=this.nativeDescriptors.get(key);
  if(typeof descriptor?.get!=='function')return {value:null,error:key+'-getter-unavailable'};
  try{
   const value=Reflect.apply(descriptor.get,video,[]);
   return finite(value)?{value,error:null}:{value:null,error:key+'-non-finite'};
  }catch(error){return {value:null,error:errorName(error)};}
 }

 _readValues(record){
  const actual=this._readNative(record.video,'playbackRate');
  const defaultRate=this._readNative(record.video,'defaultPlaybackRate');
  if(actual.value!==null)record.lastActual=actual.value;
  return {actual:actual.value,default:defaultRate.value,error:actual.error||defaultRate.error||null};
 }

 _readResult(record,seq){
  const values=this._readValues(record);
  const result=this._result(values.error?'read-error':'ready',values.actual,values.default,values.error,seq,record.epoch);
  return result;
 }

 _result(status,actualRate,defaultRate,error,seq,epoch){
  return {status,actualRate:finite(actualRate)?actualRate:null,defaultRate:finite(defaultRate)?defaultRate:null,...(error?{error}:{}),seq,epoch};
 }

 _nextSeq(){return ++this.seq;}

 _callNativeSetter(video,key,value){
  const descriptor=this.nativeDescriptors.get(key);
  if(typeof descriptor?.set!=='function')throw new TypeError(key+'-setter-unavailable');
  return Reflect.apply(descriptor.set,video,[value]);
 }

 _watchedSetter(video,key,originalSetter,value){
  const record=this.records.get(video);
  if(!record)return Reflect.apply(originalSetter,video,[value]);
  if(key==='src'||key==='srcObject')return this._watchedSourceSetter(video,key,originalSetter,value,record);
  const context=this.vcContext?.video===video?this.vcContext:null;
  let classification={origin:'vc',evidence:'vc-execute',seq:context?.seq};
  if(!context)classification=this._classifyPageWrite(record,key,value);
  const seq=context?.seq||classification.seq||this._nextSeq();
  const before=this._readNative(video,key==='defaultPlaybackRate'?'defaultPlaybackRate':'playbackRate');
  let {origin,evidence}=classification;
  let thrown=null;
  try{Reflect.apply(originalSetter,video,[value]);}catch(error){thrown=error;}
  const after=this._readNative(video,key==='defaultPlaybackRate'?'defaultPlaybackRate':'playbackRate');
  if(classification.pendingToken){
   const token=classification.pendingToken;
   const tokenActive=record.tokens.includes(token)&&token.epoch===record.epoch&&token.expires>=safeNow(this.target);
   if(tokenActive&&!thrown&&after.value!==null&&equalRate(after.value,token.rate)){
    token.used=true;
    record.tokens=record.tokens.filter(item=>item!==token);
    origin='user';evidence='native-rate-option';
   }else{origin='ambiguous';evidence='rate-option-unconfirmed';}
  }
  if(key==='defaultPlaybackRate'&&!context&&!thrown&&after.value!==null){
   record.defaultBaseline=after.value;record.ownedDefault=null;
  }
  const attemptedRate=finite(value)?value:null;
  const finalValue=after.value;
  const status=thrown?'write-error':after.error?'read-error':attemptedRate!==null&&!equalRate(finalValue,attemptedRate)?'mismatch':'ready';
  const values=this._readValues(record);
  const info={origin,property:key,attemptedRate,actualRate:values.actual,defaultRate:values.default,status,...(thrown?{error:errorName(thrown)}:after.error?{error:after.error}:{}),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence};
  if(before.value!==after.value&&after.value!==null)this._queuePending(record,key,after.value,origin,seq);
  if(origin!=='vc'){
   const stack=this._captureOverrideStack(record,key,attemptedRate,origin);
   this._emit(record,info,stack);
  }
  if(thrown)throw thrown;
  return undefined;
 }

 _watchedMethod(video,key,original,args){
  const record=this.records.get(video);
  if(!record)return Reflect.apply(original,video,args);
  const context=this.vcContext?.video===video?this.vcContext:null;
  const seq=context?.seq||this._recentInputSeq(record)||this._nextSeq();
  const before=this._readValues(record);
  this._beginEpoch(record,key,seq,context?'vc':'page');
  let result,thrown=null;
  try{result=Reflect.apply(original,video,args);}catch(error){thrown=error;}
  this._drainSourceMutations(record);
  const after=this._readValues(record);
  const didReset=before.actual!==null&&after.actual!==null&&!equalRate(before.actual,after.actual)&&equalRate(after.actual,after.default);
  if(didReset){
   this._queuePending(record,'load',after.actual,context?'vc':'load',seq);
   if(!context)this._emit(record,{origin:'load',property:'playbackRate',attemptedRate:after.actual,actualRate:after.actual,defaultRate:after.default,status:after.error?'read-error':'ready',...(after.error?{error:after.error}:{}),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'load-reset'});
  }
  if(thrown){
   if(!context)this._emit(record,{origin:'page',property:key,attemptedRate:null,actualRate:after.actual,defaultRate:after.default,status:'write-error',error:errorName(thrown),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'load-call-error'});
   throw thrown;
  }
  return result;
 }

 _watchedSourceSetter(video,key,originalSetter,value,record){
  const context=this.vcContext?.video===video?this.vcContext:null;
  const seq=context?.seq||this._recentInputSeq(record)||this._nextSeq();
  const before=this._readValues(record);
  this._beginEpoch(record,key,seq,context?'vc':'page');
  let thrown=null;
  try{Reflect.apply(originalSetter,video,[value]);}catch(error){thrown=error;}
  this._drainSourceMutations(record);
  const after=this._readValues(record);
  const didReset=before.actual!==null&&after.actual!==null&&!equalRate(before.actual,after.actual)&&equalRate(after.actual,after.default);
  if(didReset){
   this._queuePending(record,'load',after.actual,context?'vc':'load',seq);
   if(!context)this._emit(record,{origin:'load',property:'playbackRate',attemptedRate:after.actual,actualRate:after.actual,defaultRate:after.default,status:after.error?'read-error':'ready',...(after.error?{error:after.error}:{}),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'source-load-reset'});
  }
  if(thrown){
   if(!context)this._emit(record,{origin:'page',property:key,attemptedRate:null,actualRate:after.actual,defaultRate:after.default,status:'write-error',error:errorName(thrown),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'source-set-error'});
   throw thrown;
  }
  return undefined;
 }

 _beginEpoch(record,reason,seq,origin){
  record.epoch++;record.loading=true;record.loadingReason=reason;record.starting=true;record.playAnchor=null;record.playFrames=null;record.tokens=[];record.pendingEvents=[];record.lastInput=null;record.directEvent=null;
  this.epoch++;
  if(origin==='page'&&record.mediaKey!==undefined){
   this._emit(record,{origin:'load',property:reason,attemptedRate:null,actualRate:record.lastActual,defaultRate:this._readNative(record.video,'defaultPlaybackRate').value,status:'ready',seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'resource-epoch'});
  }
 }

 _queuePending(record,property,rate,origin,seq){
  if(!finite(rate))return;
  const actualRate=this._readNative(record.video,'playbackRate').value,defaultRate=this._readNative(record.video,'defaultPlaybackRate').value;
  const existing=record.pendingEvents.find(item=>item.property===property&&item.epoch===record.epoch&&item.seq===seq&&equalRate(item.rate,rate));
  if(existing){existing.actualRate=actualRate;existing.defaultRate=defaultRate;return;}
  record.pendingEvents.push({property,rate,origin,seq,actualRate,defaultRate,epoch:record.epoch,at:safeNow(this.target)});
  if(record.pendingEvents.length>MAX_PENDING)record.pendingEvents.splice(0,record.pendingEvents.length-MAX_PENDING);
 }

 _classifyPageWrite(record,key,value){
  const now=safeNow(this.target),attempted=finite(value)?value:null;
  record.tokens=record.tokens.filter(token=>!token.used&&token.epoch===record.epoch&&token.expires>=now);
  const live=this._classifyCurrentEvent(record,key,attempted);
  if(live)return live;
  const token=record.tokens.find(item=>!item.used&&item.epoch===record.epoch&&item.expires>=now&&attempted!==null&&equalRate(item.rate,attempted));
  if(token&&key==='defaultPlaybackRate')return {origin:'ambiguous',evidence:'rate-option-default-pending',seq:token.seq};
  if(token&&key==='playbackRate')return {origin:'pending-user',evidence:'native-rate-option',seq:token.seq,pendingToken:token};
  const mismatched=record.tokens.some(token=>!token.used&&token.epoch===record.epoch&&token.expires>=now);
  const keyContext=this.keyContext;
  if(keyContext?.record===record&&keyContext.epoch===record.epoch&&keyContext.expires>=now)return {origin:'user',evidence:'direct-key-write',seq:keyContext.seq};
  const input=record.lastInput;
  if(input&&input.epoch===record.epoch&&now-input.at<=INPUT_WINDOW){
   if(input.kind==='non-rate')return {origin:'page',evidence:'non-rate-control-reset',seq:input.seq};
   return {origin:'ambiguous',evidence:mismatched?'rate-option-value-mismatch':'trusted-player-input-nearby',seq:input.seq};
  }
  return {origin:'page',evidence:'main-world-setter'};
 }

 _classifyCurrentEvent(record,key,attempted){
  let event;
  try{event=this.target?.event;}catch{return null;}
  if(!event?.isTrusted||!(event.eventPhase>0)||!['click','input','change','keydown'].includes(String(event.type||'')))return null;
  const path=pathFor(event),type=String(event.type),exactRate=nativeRateFromEvent(event);
  const owner=this._resolveOwner(path,{allowRecentPointer:true,keydown:type==='keydown'});
  const touchesRecord=this._pathTouchesRecord(path,record);
  const nonRate=nonRateControl(path);
  if(owner!==record){
   const seq=this._nextSeq();
   if(owner)return {origin:'page',evidence:'different-media-input',seq};
   if(touchesRecord){
    record.tokens=[];
    return nonRate?{origin:'page',evidence:'non-rate-control-reset',seq}:{origin:'ambiguous',evidence:'ambiguous-media-owner',seq};
   }
   return null;
  }
  const seq=this._nextSeq();
  if(nonRate){
   record.tokens=[];
   return {origin:'page',evidence:'non-rate-control-reset',seq};
  }
  if(finite(exactRate)){
   let token=record.tokens.find(item=>item.event===event&&item.epoch===record.epoch&&item.expires>=safeNow(this.target));
   if(!token)token=this._createRateToken(record,exactRate,seq,event);
   const direct={event,rate:exactRate,epoch:record.epoch,seq:token.seq,token,prepared:true};
   record.directEvent=direct;
   queueMicrotaskFor(this.target,()=>{if(record.directEvent===direct)record.directEvent=null;});
   if(key==='defaultPlaybackRate')return {origin:'ambiguous',evidence:'rate-option-default-pending',seq:token.seq};
   if(equalRate(attempted,exactRate))return {origin:'pending-user',evidence:'native-rate-option',seq:token.seq,pendingToken:token};
   return {origin:'ambiguous',evidence:'rate-option-value-mismatch',seq:token.seq};
  }
  record.tokens=[];
  const direct={event,rate:attempted,epoch:record.epoch,seq,prepared:true};
  record.directEvent=direct;
  queueMicrotaskFor(this.target,()=>{if(record.directEvent===direct)record.directEvent=null;});
  if(type==='keydown'&&!BLOCKED_KEYS.has(String(event.key||''))&&!isEditablePath(path))return {origin:'user',evidence:'direct-key-write',seq};
  return {origin:'ambiguous',evidence:'trusted-player-input-nearby',seq};
 }

 _createRateToken(record,rate,seq,event){
  const now=safeNow(this.target);
  const token={rate,epoch:record.epoch,expires:now+USER_TOKEN_WINDOW,used:false,seq,event};
  record.tokens=record.tokens.filter(item=>!item.used&&item.epoch===record.epoch&&item.expires>=now);
  record.tokens=[];
  record.tokens.push(token);
  queueMicrotaskFor(this.target,()=>this._confirmRateToken(record,token));
  return token;
 }

 _confirmRateToken(record,token){
  if(token.used||!record.tokens.includes(token)||token.epoch!==record.epoch||token.expires<safeNow(this.target)||!this.references.has(record))return;
  const values=this._readValues(record);
  if(values.actual===null||!equalRate(values.actual,token.rate))return;
  token.used=true;record.tokens=record.tokens.filter(item=>item!==token);
  this._emit(record,{origin:'user',property:'playbackRate',attemptedRate:token.rate,actualRate:values.actual,defaultRate:values.default,status:values.error?'read-error':'ready',...(values.error?{error:values.error}:{}),seq:token.seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'native-rate-option'});
  this._queuePending(record,'user',token.rate,'user',token.seq);
 }

 _pathTouchesRecord(path,record){
  for(const node of path){
   if(!isNode(node)||node===this.document||node===this.target)continue;
   const tag=nodeTag(node);if(tag==='BODY'||tag==='HTML')continue;
   if(node===record.video)return true;
   try{if(typeof node.contains==='function'&&node.contains(record.video))return true;}catch{}
  }
  return false;
 }

 _captureOverrideStack(record,key,attemptedRate,origin){
  if(key!=='playbackRate'||origin!=='page'||record.appliedRate===null||record.overrideStacks>=4)return null;
  const values=this._readValues(record);
  if(values.actual===null||equalRate(values.actual,record.appliedRate)||attemptedRate===null||equalRate(attemptedRate,record.appliedRate))return null;
  record.overrideStacks++;
  return safeStack(this.target);
 }

 _emit(record,info,stack){
  const entry={
   origin:info.origin,property:info.property,attemptedRate:finite(info.attemptedRate)?info.attemptedRate:null,
   actualRate:finite(info.actualRate)?info.actualRate:null,defaultRate:finite(info.defaultRate)?info.defaultRate:null,
   status:info.status,error:info.error,seq:info.seq,epoch:info.epoch,mediaKey:info.mediaKey,
   evidence:shortReason(info.evidence),reason:shortReason(info.reason),
   phase:record.loading?'loading':record.starting?'starting':'playing',
  };
  if(stack)entry.stack=stack;
  record.diagnostics.push(entry);
  if(record.diagnostics.length>MAX_DIAGNOSTICS)record.diagnostics.splice(0,record.diagnostics.length-MAX_DIAGNOSTICS);
  if(info.origin!=='vc'){
   const observed={...entry};delete observed.stack;
   try{this.onObservation(record.video,observed);}catch{}
  }
  return entry;
 }

 _rollbackDefault(record,expectedCurrent,baseline,seq){
  const current=this._readNative(record.video,'defaultPlaybackRate');
  if(current.error){record.ownedDefault=expectedCurrent;return false;}
  if(!finite(baseline)){record.ownedDefault=current.value;return false;}
  if(equalRate(current.value,baseline)){
   record.pendingEvents=record.pendingEvents.filter(item=>!(item.property==='defaultPlaybackRate'&&item.seq===seq&&equalRate(item.rate,expectedCurrent)));
   record.ownedDefault=null;
   return true;
  }
  if(!equalRate(current.value,expectedCurrent)){
   record.defaultBaseline=current.value;
   record.ownedDefault=null;
   return false;
  }
  let thrown=null;
  try{this._callNativeSetter(record.video,'defaultPlaybackRate',baseline);}catch(error){thrown=error;}
  const after=this._readNative(record.video,'defaultPlaybackRate');
  if(current.value!==null&&after.value!==null&&!equalRate(current.value,after.value))this._queuePending(record,'defaultPlaybackRate',after.value,'vc',seq);
  if(!after.error&&equalRate(after.value,baseline)){
   record.pendingEvents=record.pendingEvents.filter(item=>!(item.property==='defaultPlaybackRate'&&item.seq===seq&&equalRate(item.rate,expectedCurrent)));
   record.ownedDefault=null;
   return !thrown;
  }
  record.ownedDefault=after.error?expectedCurrent:after.value;
  return false;
 }

 _releaseDefault(record,reason,fromStop,providedSeq){
  const seq=providedSeq||this._nextSeq();
  const before=this._readValues(record);
  let thrown=null,evidence='default-not-owned';
  if(record.ownedDefault!==null){
   if(before.default!==null&&equalRate(before.default,record.ownedDefault)){
    if(finite(record.defaultBaseline)&&!equalRate(before.default,record.defaultBaseline)){
     const previous=this.vcContext;
     this.vcContext={video:record.video,record,seq,op:'release',reason:shortReason(reason),maintainDefault:true};
     try{this._callNativeSetter(record.video,'defaultPlaybackRate',record.defaultBaseline);evidence='default-restored';}catch(error){thrown=error;evidence='default-restore-error';}
     finally{this.vcContext=previous;}
    }else evidence='default-already-baseline';
   }else evidence='default-ownership-changed';
  }
  record.ownedDefault=null;
  const after=this._readValues(record);
  if(before.default!==null&&after.default!==null&&!equalRate(before.default,after.default))this._queuePending(record,'defaultPlaybackRate',after.default,'vc',seq);
  let status=thrown?'write-error':after.error?'read-error':'ready';
  if(!thrown&&!after.error&&evidence==='default-restored'&&!equalRate(after.default,record.defaultBaseline))status='mismatch';
  const result=this._result(status,after.actual,after.default,thrown?errorName(thrown):after.error,seq,record.epoch);
  this._emit(record,{origin:'vc',property:'defaultPlaybackRate',attemptedRate:evidence==='default-restored'?record.defaultBaseline:null,...result,mediaKey:record.mediaKey,evidence:shortReason(reason)||evidence,seq,epoch:record.epoch});
  if(!fromStop){this._detachMedia(record);this.references.delete(record);this.records.delete(record.video);}
  return result;
 }

 _refreshDefaultOwnership(record,current){
  if(record.ownedDefault!==null&&!equalRate(current,record.ownedDefault)){
   record.defaultBaseline=current;record.ownedDefault=null;
  }else if(record.ownedDefault===null)record.defaultBaseline=current;
 }

 _clearTokens(record){record.tokens=[];record.pendingEvents=[];record.lastInput=null;record.directEvent=null;}

 _recentInputSeq(record){
  const input=record.lastInput;
  return input&&input.epoch===record.epoch&&safeNow(this.target)-input.at<=INPUT_WINDOW?input.seq:null;
 }

 _handleInput(event){
  if(!event?.isTrusted)return;
  const path=pathFor(event),type=String(event.type||'');
  const exactRate=nativeRateFromEvent(event);
  if(finite(exactRate)){
   const record=this._resolveOwner(path,{allowRecentPointer:true,keydown:type==='keydown'});
   if(!record)return;
   if(record.directEvent?.event===event){
    const direct=record.directEvent;record.directEvent=null;
    record.lastInput={kind:'exact-rate',at:safeNow(this.target),epoch:record.epoch,seq:direct.seq};
    return;
   }
   const now=safeNow(this.target),seq=this._nextSeq(),token=this._createRateToken(record,exactRate,seq,event);
   record.lastInput={kind:'exact-rate',at:now,epoch:record.epoch,seq};
   return;
  }
  const record=this._resolveOwner(path,{allowRecentPointer:type!=='pointerdown',keydown:type==='keydown'});
  if(!record)return;
  if(record.directEvent?.event===event){
   const direct=record.directEvent;record.directEvent=null;
   record.lastInput={kind:'general',at:safeNow(this.target),epoch:record.epoch,seq:direct.seq};
   return;
  }
  const now=safeNow(this.target),knownNonRate=nonRateControl(path),seq=this._nextSeq();
  record.tokens=record.tokens.filter(token=>!token.used&&token.epoch===record.epoch&&token.expires>=now);
  record.tokens=[];
  if(type==='pointerdown'&&!isEditablePath(path))this.pointerOwner={record,epoch:record.epoch,at:now};
  record.lastInput={kind:knownNonRate?'non-rate':'general',at:now,epoch:record.epoch,seq};
  if(type==='keydown'&&!BLOCKED_KEYS.has(String(event.key||''))&&!isEditablePath(path)){
   const context={record,epoch:record.epoch,expires:now+INPUT_WINDOW,seq};
   this.keyContext=context;
   queueMicrotaskFor(this.target,()=>{if(this.keyContext===context)this.keyContext=null;});
  }
 }

 _resolveOwner(path,{allowRecentPointer=false,keydown=false}={}){
  const records=[...this.references];
  for(const node of path){
   if(!isNode(node)||node===this.document||node===this.target)continue;
   const tag=nodeTag(node);if(tag==='BODY'||tag==='HTML')continue;
   const direct=records.find(record=>record.video===node);
   if(direct)return direct;
  }
  for(const node of path){
   if(!isNode(node)||node===this.document||node===this.target)continue;
   const tag=nodeTag(node);if(tag==='BODY'||tag==='HTML')continue;
   const scope=[];
   for(const record of records){
    try{if(typeof node.contains==='function'&&node.contains(record.video))scope.push(record);}catch{}
   }
   if(scope.length===1)return scope[0];
   if(scope.length>1){
    const selected=scope.filter(record=>record.selected);
    if(selected.length===1)return selected[0];
    if(allowRecentPointer&&this._validPointerOwner())return this.pointerOwner.record;
    return null;
   }
  }
  if(allowRecentPointer&&this._validPointerOwner())return this.pointerOwner.record;
  if(keydown){
   const selected=[...this.references].filter(record=>record.selected);
   if(selected.length===1)return selected[0];
  }
  return null;
 }

 _validPointerOwner(){
  return !!this.pointerOwner&&this.references.has(this.pointerOwner.record)&&safeNow(this.target)-this.pointerOwner.at<=POINTER_WINDOW&&this.pointerOwner.epoch===this.pointerOwner.record.epoch;
 }

 _handleMediaEvent(record,event){
  if(!this.references.has(record))return;
  if(!event?.isTrusted)return;
  const type=String(event?.type||'');
  if(type==='loadedmetadata'){
   record.loading=false;record.loadingReason='';record.starting=true;record.playAnchor=!record.video.paused?mediaTime(record.video):null;record.playFrames=record.playAnchor===null?null:videoFrames(record.video);
   return;
  }
  if(type==='play'||type==='playing'||type==='waiting'){
   if((type==='playing'||type==='waiting')&&!record.starting&&!record.loading)return;
   record.starting=true;
   if(type==='play'||record.playAnchor===null&&type==='playing'){record.playAnchor=mediaTime(record.video);record.playFrames=videoFrames(record.video);}
   if(type==='playing'){record.loading=false;record.loadingReason='';}
   return;
  }
  if(type==='timeupdate'){
   if(!record.starting)return;
   const video=record.video,time=mediaTime(video);
   if(video.paused||video.ended||video.seeking||video.readyState<2)return;
   const frames=videoFrames(video),advanced=record.playAnchor!==null&&time!==null&&Math.abs(time-record.playAnchor)>=0.001||record.playFrames!==null&&frames!==null&&frames>record.playFrames;
   if(!advanced)return;
   const values=this._readValues(record);
   if(values.actual!==null&&record.appliedRate!==null&&!equalRate(values.actual,record.appliedRate)){
    const seq=this._nextSeq();this._queuePending(record,'load',values.actual,'transition',seq);
    this._emit(record,{origin:'transition',property:'ratechange',attemptedRate:values.actual,actualRate:values.actual,defaultRate:values.default,status:values.error?'read-error':'ready',...(values.error?{error:values.error}:{}),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'startup-progress-rate'});
   }
   record.starting=false;record.loading=false;record.loadingReason='';
   return;
  }
  if(type==='emptied'||type==='loadstart'){
   if(!record.loading){record.epoch++;this.epoch++;record.tokens=[];record.pendingEvents=[];record.lastInput=null;}
   record.loading=true;record.loadingReason=type;record.starting=true;record.playAnchor=null;record.playFrames=null;
   this._observeLoadReset(record,type);
   return;
  }
  if(type!=='ratechange'||!event?.isTrusted)return;
  const values=this._readValues(record);
  if(values.error){
   const seq=this._nextSeq();
   this._emit(record,{origin:record.loading?'load':'unknown',property:'ratechange',attemptedRate:null,actualRate:values.actual,defaultRate:values.default,status:'read-error',error:values.error,seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:'trusted-ratechange-read-error'});
   return;
  }
  const now=safeNow(this.target);
  const pendingIndex=record.pendingEvents.findIndex(item=>item.epoch===record.epoch&&now-item.at<=USER_TOKEN_WINDOW&&equalRate(values.actual,item.actualRate)&&equalRate(values.default,item.defaultRate)&&(
   item.property==='load'?equalRate(values.actual,item.rate):
   item.property==='playbackRate'?equalRate(values.actual,item.rate):
   item.property==='defaultPlaybackRate'?equalRate(values.default,item.rate):
   item.property==='user'?equalRate(values.actual,item.rate):false
  ));
  if(pendingIndex>=0){record.pendingEvents.splice(pendingIndex,1);record.lastActual=values.actual;return;}
  const seq=this._nextSeq();
  const origin=record.loading?'load':record.starting?'transition':'unknown';
  this._emit(record,{origin,property:'ratechange',attemptedRate:values.actual,actualRate:values.actual,defaultRate:values.default,status:'ready',seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:record.loading?'load-epoch-ratechange':record.starting?'startup-ratechange':'unattributed-ua-ratechange'});
 }

 _observeLoadReset(record,evidence){
  const previous=record.lastActual,values=this._readValues(record);
  if(values.actual!==null&&values.default!==null&&previous!==null&&!equalRate(values.actual,previous)&&equalRate(values.actual,values.default)){
   const seq=this._nextSeq();
   this._queuePending(record,'load',values.actual,'load',seq);
   this._emit(record,{origin:'load',property:'playbackRate',attemptedRate:values.actual,actualRate:values.actual,defaultRate:values.default,status:values.error?'read-error':'ready',...(values.error?{error:values.error}:{}),seq,epoch:record.epoch,mediaKey:record.mediaKey,evidence:shortReason(evidence)||'load-reset'});
  }
  record.lastActual=values.actual;
 }
}
