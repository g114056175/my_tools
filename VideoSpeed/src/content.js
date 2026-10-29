import {normalizeSettings,shortcutAction,editingEvent,validRate,rankTargets} from './settings.js';
import {RateController} from './rate-controller.js';
import {MediaRegistry,mediaSignature,isMediaPreview,mediaCanInitialize} from './media-registry.js';
import {highlightMedia} from './media-highlight.js';
import {createRuntimeMessenger,isContextInvalidatedError} from './runtime.js';
import {VideoToast} from './video-toast.js';
import {InitialRateNotice} from './initial-rate-notice.js';
import {settingsForUrls} from './site-rules.js';
import {RateClient} from './rate-client.js';
import {TrustedRateInput} from './trusted-rate-input.js';
import {ActivityLease} from './activity-lease.js';
import {PendingMediaLease} from './pending-media-lease.js';
import {StartupHandshake} from './startup-handshake.js';
import {SelectionOrder} from './selection-order.js';
import {resolveLanguage,translate,translateMessage} from '../extension/i18n.js';
const SCOPE='video-control',VERSION='1.0.0',API=Symbol.for('video-control.api');
const previous=globalThis[API];
let reuse=false;
try{reuse=previous?.version===VERSION&&previous.alive?.();}catch(error){if(!isContextInvalidatedError(error))throw error;}
if(!reuse){
 try{previous?.dispose?.();}catch{}
 try{boot();}catch(error){if(!isContextInvalidatedError(error))throw error;}
}
function startSession(initialSettings,initialRate,send,alive,rateClient,{isFocused,isRecent,isLoading,loadingDeadline,onIdle,initialDocument=false,language='en'}){
 const qualityDelays=[250,600,1200,2400];
 const videoToast=new VideoToast(document);
 const shownNotice={key:null};
 const abort=new AbortController();
 let disposed=false,locale=resolveLanguage(language);
 const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:abort.signal});
 let settings=initialSettings,ready=true,reportTimer,activeId=null,hasTarget=false,lastRate=initialRate,requestSerial=0,picker=null,rememberedRate=null;
 const snapshotEpochKey=Symbol.for('video-control.snapshot-epoch'),snapshotEpoch=Math.max(Date.now(),Number(globalThis[snapshotEpochKey]||0)+1);globalThis[snapshotEpochKey]=snapshotEpoch;
 let preference=null,hasOtherFrames=false,snapshotRevision=0;const selectionOrder=new SelectionOrder();
 const states=new Map(),interactions=new WeakMap(),pending=new Map(),rateResponses=new Map();
 let trustedRateInput=null,registry,graceTimer=null,initialScan=true,documentPending=initialDocument&&document.readyState==='loading',focused=isFocused();
 const canDiscover=()=>initialScan||isRecent()||documentPending&&isLoading();
 const clearPending=video=>{video.removeAttribute('data-video-control-pending-until');video.removeAttribute('data-video-control-pending-key');};
 const pendingMarker=video=>Number(video.getAttribute('data-video-control-pending-until'))>Date.now()&&(!video.getAttribute('data-video-control-pending-key')||video.getAttribute('data-video-control-pending-key')===mediaSignature(video));
 const qualityDone=state=>!settings.qualityEnabled||['applied','requested','failed','preserved','disabled'].includes(state.quality.status)||state.attempts>qualityDelays.length;
 function eligible(video){
  if(!video?.isConnected||isMediaPreview(video))return false;
  if(isFocused())return true;
  const state=states.get(video.getAttribute('data-video-control-id'));if(!state)return false;
  if(!state.load.started){
   if(state.rate?.initialized&&qualityDone(state)&&state.video.readyState>=2&&(!state.backgroundApplied||state.settled))state.load.finish();
   else state.load.start(mediaSignature(video),Math.min(loadingDeadline(),Number(video.getAttribute('data-video-control-pending-until'))||Infinity));
  }
  const accepted=state.load.accepts(mediaSignature(video));
  if(accepted){
   for(const [name,value]of [['until',state.load.until],['key',state.load.key]])if(video.getAttribute('data-video-control-pending-'+name)!==String(value))video.setAttribute('data-video-control-pending-'+name,String(value));
  }else clearPending(video);
  return accepted;
 }
 const pendingUntil=()=>Math.max(0,...[...states.values()].filter(state=>eligible(state.video)).map(state=>state.load.until));
 const waiting=()=>documentPending&&isLoading()||pendingUntil()>Date.now();
 const report=()=>{if(disposed)return;if(!isRecent()&&!waiting()){onIdle();return;}if(!alive()){queueMicrotask(dispose);return;}const urgent=!activeId||!states.has(activeId);if(reportTimer){if(!urgent)return;clearTimeout(reportTimer);}reportTimer=setTimeout(()=>{reportTimer=null;if(!isRecent()&&!waiting()){onIdle();return;}const hint=rememberedRate;rememberedRate=null;send({action:'report',...snapshotPacket(),rememberedRate:hint}).then(response=>{if(hint)rateClient.acknowledge(hint.rateWriteId,response);});},urgent?0:120);};
 function finishPending(state){
  if(isFocused()||!state.rate?.initialized||!state.settled||!qualityDone(state)||state.video.paused||state.video.readyState<2||state.rate.repairTimer!==null)return;
  state.load.finish();clearPending(state.video);onIdle();
 }
 listen(document,'video-control:rate-result-v3',event=>{
  let data;try{data=JSON.parse(event.detail);}catch{return;}
  const job=rateResponses.get(data?.requestId);if(data?.owner===rateClient.sessionId&&job&&data.videoId===job.id&&event.composedPath().includes(job.video))job.result=data.result;
 },true);
 function rateOperation(video,id,operation){
  const requestId='r-'+(++requestSerial),job={video,id,result:null};rateResponses.set(requestId,job);
  try{
   const state=states.get(id),key=state?.rate?.mediaKey||mediaSignature(video);
   if(state&&state.rateKey!==key){state.rateKey=key;state.rateKeyToken=id+':k'+(++state.keySerial);}
   const payload={...operation,owner:rateClient.sessionId,videoId:id,requestId,mediaKey:state?.rateKeyToken||id,selected:id===activeId};
   video.dispatchEvent(new CustomEvent(operation.op==='apply'?'video-control:rate-request-v2':'video-control:rate-operation-v1',{detail:JSON.stringify(payload),bubbles:true,composed:true}));
   const result=job.result||{status:'unavailable',actualRate:null,defaultRate:null,error:'rate-bridge-unavailable'};
   if(['apply','adopt'].includes(operation.op)&&result.status==='ready'){
    const latest=rateOperation(video,id,{op:'read'});
    if(latest.status!=='ready')return latest;
    const matches=Math.abs(latest.actualRate-operation.rate)<1e-5&&(operation.maintainDefault===false||Math.abs(latest.defaultRate-operation.rate)<1e-5);
    if(!matches&&operation.maintainDefault!==false){
     const released=rateOperation(video,id,{op:'release',retain:true,reason:'unapplied-command'});
     return {...result,actualRate:released.actualRate,defaultRate:released.defaultRate,status:'mismatch'};
    }
    return {...result,actualRate:latest.actualRate,defaultRate:latest.defaultRate,status:matches?'ready':'mismatch'};
   }
   return result;
  }finally{rateResponses.delete(requestId);}
 }
 listen(document,'video-control:rate-observation-v1',event=>{
  let data;try{data=JSON.parse(event.detail);}catch{return;}
  const video=event.composedPath().find(node=>node?.tagName==='VIDEO'),id=video?.getAttribute('data-video-control-id');
  const state=id&&states.get(id);
  if(data?.owner===rateClient.sessionId&&state?.rate&&!isMediaPreview(video)&&id===data.videoId&&data.info?.mediaKey===state.rateKeyToken&&(data.info?.origin!=='user'||trustedRateInput?.consume(video,data.info))){if(data.info.origin==='user')state.notice?.cancel();state.rate.observe({...data.info,mediaKey:state.rateKey});}
 },true);
 registry=new MediaRegistry(document,(video,id)=>{
  const signature=mediaSignature(video),initializedKey=video.getAttribute('data-video-control-initialized')||'';
  const preserved=initializedKey===signature;
  const qualityPreserved=video.getAttribute('data-video-control-quality-initialized')===signature||preserved&&!pendingMarker(video);
  const state={video,load:new PendingMediaLease(),settled:preserved,backgroundApplied:false,settleTimer:null,quality:{status:qualityPreserved?'preserved':'pending'},attempts:0,qualityKey:qualityPreserved?signature:null,timer:null,revision:0,rateKey:null,rateKeyToken:'',keySerial:0};states.set(id,state);
  state.notice=new InitialRateNotice(video,{shown:shownNotice,identity:()=>state.rate?.mediaKey,canShow:()=>!disposed&&settings.enabled&&settings.defaultMode!=='off'&&id===activeId&&state.rate?.initialized&&eligible(video)&&mediaCanInitialize(video),show:()=>videoToast.show(video,video.playbackRate+'×')});
  state.rate=new RateController(video,{...settings,enabled:ready&&settings.enabled},{
   readRate:()=>rateOperation(video,id,{op:'read'}),
   writeRate:(_rate,options)=>rateOperation(video,id,options),
   releaseRate:options=>rateOperation(video,id,{op:'release',...options}),
   signature:()=>mediaSignature(video),canInitialize:()=>eligible(video)&&mediaCanInitialize(video),initializedKey,onInitialize:key=>{
    video.setAttribute('data-video-control-initialized',key);
    // Give the initial play/load callbacks one bounded settling period. It is
    // never renewed by page rate writes and never becomes ongoing background control.
    clearTimeout(state.settleTimer);state.settled=false;state.backgroundApplied=!isFocused();
    state.settleTimer=setTimeout(()=>{state.settleTimer=null;state.settled=true;finishPending(state);},500);
   },lastRate,selected:id===activeId,onChange:report,
   onDefaultApplied:()=>state.notice.request(),
   onRate:(rate,source)=>{
    lastRate=rate;const rateWriteId=rateClient.begin(rate),hint={id,rate,source,rateWriteId,rateSessionId:rateClient.sessionId};rememberedRate=hint;
    for(const item of states.values())if(item.rate)item.rate.lastRate=rate;
    send({action:'rememberRate',...hint}).then(response=>rateClient.acknowledge(rateWriteId,response));
   },
   onMedia:()=>queueMicrotask(()=>{
    if(disposed||!states.has(id))return;
    if(!isFocused()&&!eligible(video)){onIdle();return;}
    state.notice.wake();
    if(state.qualityKey!==state.rate.mediaKey){state.qualityKey=state.rate.mediaKey;state.attempts=0;state.revision++;clearTimeout(state.timer);state.timer=null;state.quality={status:'pending'};}
    queueQuality(video,id);finishPending(state);
   }),
  });
  for(const name of ['pause','play','ended','resize','loadedmetadata'])listen(video,name,report);
  state.onPlayback=()=>{state.notice.wake();queueQuality(video,id);finishPending(state);};
  state.onNoticeSource=()=>state.notice.cancelFrame();
  for(const name of ['play','playing'])listen(video,name,state.onPlayback);
  for(const name of ['loadstart','emptied'])listen(video,name,state.onNoticeSource);
  queueMicrotask(()=>{if(!disposed&&video.isConnected&&states.has(id))video.dispatchEvent(new Event('video-control:media-bind-v1',{bubbles:true,composed:true}));});
 },report,{exploring:isFocused(),allowMediaEvents:canDiscover,acceptVideo:video=>{
  if(isFocused())return true;
  if(!isRecent()&&!initialDocument&&!pendingMarker(video))return false;
  return pendingMarker(video)||!mediaSignature(video)||video.getAttribute('data-video-control-initialized')!==mediaSignature(video);
 }});
 initialScan=false;
 registry.onRemove=(id,video)=>{
  clearPending(video);
  const state=states.get(id);state?.notice.dispose();state?.rate.dispose({preserveDefault:!isFocused()&&settings.enabled});clearTimeout(state?.timer);clearTimeout(state?.settleTimer);states.delete(id);
  if(videoToast.video===video)videoToast.clear();
  if(id===activeId){activeId=null;hasTarget=false;marker({clear:true});report();}
  for(const name of ['pause','play','ended','resize','loadedmetadata'])video.removeEventListener(name,report);
  for(const name of ['play','playing'])video.removeEventListener(name,state?.onPlayback);
  for(const name of ['loadstart','emptied'])video.removeEventListener(name,state?.onNoticeSource);
 };
 trustedRateInput=new TrustedRateInput(document,{getRecords:()=>[...registry.videos].map(([id,video])=>({video,selected:id===activeId,mediaKey:states.get(id)?.rateKeyToken}))});
 trustedRateInput.start();
 globalThis[Symbol.for('video-control.identities')]={keys:registry.ids};
 const snapshot=(details=false,verify=false)=>registry.snapshot(states,interactions,{details,activeId,verify});
 const snapshotPacket=(verify=false,details=false)=>({videos:snapshot(details,verify),pendingUntil:pendingUntil(),snapshotEpoch,snapshotRevision:++snapshotRevision});
 const localTarget=(items,currentKey=activeId)=>rankTargets(items.map(item=>({...item,key:item.id})),preference,{currentKey})[0]||null;
 function marker(options){
  globalThis[Symbol.for('video-control.selection')]={videos:[...registry.videos.values()]};
  const result=highlightMedia(options);
  if(options.clear)videoToast.release();
  else if(options.renew)videoToast.renew();
  else if(result.highlighted)videoToast.hold(registry.videos.get(options.mediaKey));
  return result;
 }
 function queueQuality(video,id){
  const state=states.get(id);if(disposed||!state||!ready||id!==activeId||!state.rate.initialized&&!state.rate.initializationAttempts||!eligible(video)||!mediaCanInitialize(video))return;
  if(!settings.enabled||!settings.qualityEnabled){state.quality={status:'disabled'};return;}
  if(video.paused||video.ended||video.readyState<1||state.timer||state.attempts>qualityDelays.length||['applied','requested','failed','preserved'].includes(state.quality.status))return;
  state.timer=setTimeout(async()=>{
   state.timer=null;if(!video.isConnected||video.paused||video.ended||!settings.enabled||!settings.qualityEnabled||id!==activeId||!eligible(video)||!mediaCanInitialize(video))return;
   const generation=state.rate.mediaKey,revision=state.revision,requestId='q-'+Date.now()+'-'+(++requestSerial);state.attempts++;
   const result=await new Promise(resolve=>{
    const timer=setTimeout(()=>{pending.delete(requestId);resolve({status:'failed',reason:'bridge-timeout'});},1800);
    pending.set(requestId,{video,id,resolve,timer});
    video.setAttribute('data-video-control-quality-request',requestId);
    video.dispatchEvent(new CustomEvent('video-control:quality-request-v3',{detail:JSON.stringify({owner:rateClient.sessionId,requestId,videoId:id,mediaKey:generation,preferred:settings.preferredQuality,revision}),bubbles:true,composed:true}));
   });
   if(disposed||states.get(id)!==state||state.rate.mediaKey!==generation||state.revision!==revision)return;
   state.quality={...result,attempts:state.attempts};if(qualityDone(state))video.setAttribute('data-video-control-quality-initialized',generation);report();finishPending(state);
   // Retry discovery only. A submitted quality change is never submitted twice.
   if(['unsupported','unavailable'].includes(result.status)&&state.attempts<=qualityDelays.length){state.timer=setTimeout(()=>{state.timer=null;queueQuality(video,id);},qualityDelays[state.attempts-1]);}
  },0);
 }
 listen(document,'video-control:quality-result-v3',event=>{
  let data;try{data=JSON.parse(event.detail);}catch{return;}
  const job=pending.get(data?.requestId);if(data?.owner!==rateClient.sessionId||!job||data.videoId!==job.id||!event.composedPath().includes(job.video))return;
  const result=data.result;if(!result||!['applied','requested','unsupported','unavailable','failed','inspected'].includes(result.status))return;
  clearTimeout(job.timer);pending.delete(data.requestId);job.resolve(result);
 },true);
 function update(next,rate=lastRate){
  settings=normalizeSettings(next);updateLastRate(rate);
  for(const [id,video]of registry.videos){
   const state=states.get(id);state.rate.update(settings,lastRate);
   if(!settings.qualityEnabled){video.removeAttribute('data-video-control-quality-request');clearTimeout(state.timer);state.timer=null;state.quality={...state.quality,status:'disabled'};}
   if(state.quality.status==='pending')queueQuality(video,id);
   finishPending(state);
  }
  report();
 }
 function updateLastRate(rate){if(!validRate(rate))return;lastRate=Number(rate);for(const state of states.values())state.rate.lastRate=lastRate;}
 function updateActivity(){
  const next=isFocused();
  if(next!==focused){focused=next;clearTimeout(graceTimer);graceTimer=null;for(const state of states.values()){state.load.reset();clearPending(state.video);}}
  registry.setExploring(next);
  if(next)return true;
  for(const [id,video]of [...registry.videos])if(!eligible(video))registry.remove(id,video);
  if(isRecent()&&graceTimer===null)graceTimer=setTimeout(()=>{graceTimer=null;if(disposed)return;if(isRecent()&&!isFocused())registry.probe();onIdle();},2000);
  return isRecent()||waiting();
 }
 function act(id,command,value,language=locale){
  registry.prune();
  const video=registry.videos.get(id),state=states.get(id);if(!video||!state||!video.isConnected)throw Error("Video changed; select it again");
  if(!isFocused()||!eligible(video))throw Error("Return to the video tab first");
  if(!settings.enabled)throw Error("VideoSpeed is disabled");
  if(activeId!==id){activeId=id;hasTarget=true;for(const [key,item]of states)item.rate.select(key===id);}
  state.notice.cancel();const result=state.rate.command(command,value);interactions.set(video,Date.now());videoToast.show(video,result.rateStatus==='failed'?translateMessage(resolveLanguage(language),result.rateError):result.rate+'×');report();return result;
 }
 function handleKey(event){
  if(!event.isTrusted||!isFocused())return false;
  if(!alive()){dispose();return false;}
  const command=shortcutAction(event,settings.shortcuts);if(!ready||!settings.enabled||!command||editingEvent(event))return false;
  if(!hasTarget&&!snapshot().some(video=>video.visible)){
   if(isFocused())registry.scan(document,true);
   if(!snapshot().some(video=>video.visible))return false;
  }
  const packet=snapshotPacket(true),target=localTarget(packet.videos);
  if(!target&&!hasTarget)return false;
  event.preventDefault();event.stopImmediatePropagation();
  const video=registry.videos.get(activeId);
  if(!hasOtherFrames&&target?.id===activeId&&video&&states.has(activeId)&&eligible(video)){
   // The selected media and MAIN bridge are in this frame. Apply and paint
   // before waiting for the worker; remembering the choice stays asynchronous.
   try{act(activeId,command);}catch(error){videoToast.show(video,translateMessage(locale,error.message));}
  }else send({action:'command',command,reselect:true,...packet});
  return true;
 }
 listen(document,'pointerdown',event=>{
  if(picker||!isFocused())return;const video=registry.fromEvent(event);if(video){interactions.set(video,Date.now());send({action:'report',...snapshotPacket()});}
 },true);
 listen(document,'fullscreenchange',report,true);listen(window,'resize',report,{passive:true});
 let scrollTimer;listen(window,'scroll',()=>{if(!scrollTimer)scrollTimer=setTimeout(()=>{scrollTimer=null;report();},250);},{passive:true,capture:true});
 let routeQueued=false;
 function route(){if(routeQueued)return;routeQueued=true;queueMicrotask(()=>{routeQueued=false;if(disposed)return;for(const state of states.values())state.rate.sync();if(!isRecent())onIdle();report();});}
 listen(document,'video-control:media-ready-v1',event=>{const video=event.composedPath().find(node=>node?.tagName==='VIDEO');if(!video)return;registry.add(video,{mediaEvent:true});if(!eligible(video))return;const id=registry.ids.get(video),state=states.get(id);state?.rate.sync(true);if(state)queueQuality(video,id);report();},true);
 for(const name of ['popstate','hashchange','yt-navigate-finish','video-control:route'])listen(window,name,route,true);
 listen(window,'pagehide',()=>{clearTimeout(reportTimer);if(rememberedRate){send({action:'report',...snapshotPacket(),rememberedRate});rememberedRate=null;}marker({clear:true});send({action:'report',videos:[],snapshotEpoch,snapshotRevision:++snapshotRevision});});
 listen(window,'pageshow',report);
 listen(document,'video-control:shadow',event=>{for(const node of event.composedPath())if(node.shadowRoot){if(isFocused())registry.scan(node.shadowRoot);else if(canDiscover())registry.observe(node.shadowRoot);}},true);
 listen(document,'DOMContentLoaded',()=>{if(!documentPending)return;if(!isFocused()&&canDiscover())registry.probe();documentPending=false;onIdle();},{once:true});
 function cancelPick(){picker?.cancel();picker=null;}
 function startPick(language=locale){
  cancelPick();registry.scan(document,true);marker({clear:true});
  const overlay=document.createElement('div');Object.assign(overlay.style,{position:'fixed',zIndex:2147483646,border:'3px solid #2b85bf',background:'#2b85bf22',borderRadius:'5px',pointerEvents:'none',display:'none',boxSizing:'border-box'});
  const label=document.createElement('div');label.textContent=translate(resolveLanguage(language),'Select a video · Esc to cancel');Object.assign(label.style,{position:'fixed',top:'12px',left:'50%',transform:'translateX(-50%)',padding:'8px 14px',borderRadius:'8px',background:'#236fa7',color:'white',font:'13px system-ui',pointerEvents:'none',zIndex:2147483647});
  (document.fullscreenElement||document.documentElement).append(overlay);if(window===window.top)document.documentElement.append(label);
  const move=event=>{const video=registry.fromEvent(event);if(!video){overlay.style.display='none';return;}const r=video.getBoundingClientRect();Object.assign(overlay.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
  const click=event=>{const video=registry.fromEvent(event);if(!video)return;event.preventDefault();event.stopImmediatePropagation();const id=registry.ids.get(video);interactions.set(video,Date.now());cancelPick();send({action:'picked',id,...snapshotPacket(true)});};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();cancelPick();send({action:'cancelPick'});}};
  listen(document,'pointermove',move,true);listen(document,'click',click,true);listen(window,'keydown',key,true);
  const timer=setTimeout(()=>{cancelPick();send({action:'cancelPick'});},30000);
  picker={cancel(){clearTimeout(timer);overlay.remove();label.remove();document.removeEventListener('pointermove',move,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);}};
 }
 let inspectTask=null;
 const api={dispose,snapshot,snapshotPacket,clearSnapshot:()=>({videos:[],pendingUntil:0,snapshotEpoch,snapshotRevision:++snapshotRevision}),update,updateLastRate,updateActivity,handleKey,updateLanguage:value=>{locale=resolveLanguage(value);},diagnostics:()=>[...states].map(([id,state])=>({id,...state.rate.diagnostics(),key:state.rateKeyToken,pendingUntil:state.load.until,memory:rateClient.snapshot(),bridge:rateOperation(registry.videos.get(id),id,{op:'diagnostics'})})),refreshSnapshot:(deep=true)=>{
  if(deep&&isFocused()){registry.scan(document,true);registry.titleCache=new WeakMap();}
  const packet=snapshotPacket(true,true);
  // Identity/rate/geometry must not wait for an optional quality adapter.
  if(!inspectTask)inspectTask=api.refresh(false).then(()=>{if(!disposed)report();}).catch(()=>{}).finally(()=>{inspectTask=null;});
  return packet;
 },refresh:async(deep=true)=>{
  if(deep&&isFocused()){registry.scan(document,true);registry.titleCache=new WeakMap();}
  const items=snapshot(),id=activeId||items.find(item=>item.visible&&item.playing)?.id||items.find(item=>item.visible)?.id;
  const video=registry.videos.get(id),state=states.get(id);
  if(video&&state){
   const generation=state.rate.mediaKey,requestId='i-'+Date.now()+'-'+(++requestSerial);
   const result=await new Promise(resolve=>{
    const timer=setTimeout(()=>{pending.delete(requestId);resolve(null);},800);
    pending.set(requestId,{video,id,resolve,timer});
    video.dispatchEvent(new CustomEvent('video-control:quality-request-v3',{detail:JSON.stringify({owner:rateClient.sessionId,requestId,videoId:id,preferred:settings.preferredQuality,inspect:true}),bubbles:true,composed:true}));
   });
   if(result&&states.get(id)===state&&state.rate.mediaKey===generation)state.quality={...state.quality,adapter:result.adapter,availableHeights:result.availableHeights};
  }
  return snapshot(true);
 }};
 const receive=(message,_sender,respond)=>{
  if(message?.scope!==SCOPE)return;
  try{
   if(message.action==='activeTarget'){
    if(!selectionOrder.accept(message)){respond({ok:true,activeId,staleSelection:true});return;}
    registry.prune();
    if(message.id&&!registry.videos.has(message.id)){report();respond({ok:false,activeId:null,error:'Video changed; select it again'});return;}
    activeId=message.id||null;hasTarget=!!message.hasTarget;preference=message.preference||null;hasOtherFrames=message.hasOtherFrames===true;rateClient.accept(message);updateLastRate(rateClient.rate);
    for(const [id,state]of states){state.rate.lastRate=lastRate;state.rate.select(id===activeId);state.notice.wake();if(id!==activeId){clearTimeout(state.timer);state.timer=null;}}
    if(activeId){const video=registry.videos.get(activeId);queueQuality(video,activeId);}respond({ok:true,activeId});
   }
   else if(message.action==='highlight')respond({ok:true,...marker(message.options)});
   else if(message.action==='control'){
    const packet=snapshotPacket(true),target=localTarget(packet.videos,message.id);
    if(target?.id!==message.id){respond({ok:false,staleTarget:true,...packet});return;}
    respond({ok:true,result:act(message.id,message.command,message.value,message.language||locale)});
   }
   else if(message.action==='pick'){startPick(message.language);respond({ok:true});}
   else if(message.action==='cancelPick'){cancelPick();respond({ok:true});}
   else if(message.action==='snapshot')respond({ok:true,...snapshotPacket(message.verify===true)});
   else if(message.action==='refreshTarget')respond({ok:true,...api.refreshSnapshot(false)});
  }catch(error){respond({ok:false,error:error.message});}
 };
 function dispose({preserveDefault=false}={}){
  if(disposed)return;disposed=true;ready=false;abort.abort();
  clearTimeout(reportTimer);clearTimeout(scrollTimer);clearTimeout(graceTimer);videoToast.clear();cancelPick();
  for(const state of states.values()){clearTimeout(state.timer);clearTimeout(state.settleTimer);state.notice.dispose();state.rate?.dispose({preserveDefault});}
  for(const job of pending.values()){clearTimeout(job.timer);job.resolve(null);}pending.clear();
  trustedRateInput?.dispose();registry.dispose();marker({clear:true});document.getElementById('video-control-toast')?.remove();

 }
 updateActivity();report();return {...api,receive};
}



function boot(){
 const initialDocument=document.readyState==='loading';
 let disposed=false,session=null,settings=normalizeSettings({enabled:false}),lastRate=null,lifeline,configuration=0,pageUrl=window===window.top?location.href:'',contextReady=window===window.top,language='en',localPolicyKnown=false;
 const activity=new ActivityLease();let activityTimer=null,idleQueued=false,rateRefresh=null,bridgeReady=false,initialCatchupUsed=false;
 const isFocused=()=>activity.focused,isRecent=()=>activity.isRecent(),isLoading=()=>activity.isLoading();
 const rateClient=new RateClient(rate=>{lastRate=rate;session?.updateLastRate(rate);});
 let stopStorage=()=>{},stopMessages=()=>{},stopDisconnect=()=>{};
 delete globalThis[Symbol.for('video-control.recovering')];
 const messenger=createRuntimeMessenger(chrome.runtime,dispose),send=message=>messenger.send({scope:SCOPE,...message});
 function acceptActivity(value){
  if(!activity.accept(value))return false;
  clearTimeout(activityTimer);activityTimer=null;
  const now=Date.now(),deadlines=[!activity.focused?activity.until:0,activity.loadingUntil].filter(until=>until>now);
  if(deadlines.length)activityTimer=setTimeout(()=>{activityTimer=null;acceptActivity(activity);reconcile();},Math.min(...deadlines)-now);
  return true;
 }
 function onIdle(){
  if(disposed||idleQueued)return;idleQueued=true;
  queueMicrotask(()=>{idleQueued=false;if(!disposed)reconcile();});
 }
 function configure(next){
  if(disposed)return;configuration++;settings=normalizeSettings(next);
  reconcile();
 }
 let settingsReadSerial=0;
 async function readSavedSettings(){
  const serial=++settingsReadSerial,before=configuration;
  const data=await messenger.call(chrome.storage.local,'get','settings');
  if(disposed||!data||serial!==settingsReadSerial||configuration!==before)return;
  localPolicyKnown=true;configure(data.settings);
 }
 function reconcile(){
  if(disposed)return;
  if(!contextReady)return;
  const localSettings=settingsForUrls(settings,location.href,window===window.top?location.href:pageUrl);
  const recent=isRecent(),keep=localSettings.enabled&&session?.updateActivity(),enabled=localSettings.enabled&&validRate(lastRate)&&(recent||keep||!session&&!initialCatchupUsed&&isLoading());
  if(!enabled){
   bridgeReady=false;
   const previous=session;session=null;previous?.dispose({preserveDefault:localSettings.enabled&&!isFocused()});
   document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,enabled:false,suspended:localSettings.enabled&&localSettings.defaultMode!=='off'&&!isFocused()})}));
   if(previous)send({action:'report',...previous.clearSnapshot()});
   return;
  }
  bridgeReady=false;
  document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,enabled:true,exploring:isFocused(),waiting:isLoading(),qualityEnabled:localSettings.qualityEnabled})}));
  if(!bridgeReady){bridgeStartup.ensure({force:true,reason:'missing-page-bridge'});return;}
  if(session)session.update(localSettings,lastRate);
  else {const firstDocument=!initialCatchupUsed&&initialDocument;initialCatchupUsed=true;session=startSession(localSettings,lastRate,send,messenger.alive,rateClient,{isFocused,isRecent,isLoading,loadingDeadline:()=>activity.loadingUntil,onIdle,initialDocument:firstDocument,language});}
 }
 function acceptConfiguration(response){
  if(!response?.settings||!validRate(response.lastRate)||!Number.isSafeInteger(response.rateRevision)||response.rateRevision<0||!Number.isSafeInteger(response.activity?.revision)||response.activity.revision<0||typeof response.activity.focused!=='boolean'||!Number.isSafeInteger(response.activity.until)||response.activity.until<0)return false;
  language=resolveLanguage(response.language);session?.updateLanguage(language);rateClient.accept(response);
  acceptActivity(response.activity);
  if(!contextReady||configuration===0)pageUrl=response.pageUrl||pageUrl;contextReady=true;localPolicyKnown=true;
  if(configuration===0||response.configurationAtRequest===configuration)configure(response.settings);
  else {reconcile();return false;}
  return true;
 }
 const startup=new StartupHandshake({request:()=>{settingsReadSerial++;const at=configuration;return send({action:'settings'}).then(response=>response&&({...response,configurationAtRequest:at}));},accept:acceptConfiguration,alive:messenger.alive,
  mayRetry:()=>!disposed&&(isRecent()||isLoading()||document.visibilityState!=='hidden'),onError:error=>console.error('[VideoSpeed] startup failed',error)});
 const bridgeStartup=new StartupHandshake({request:()=>send({action:'repairBridge'}),accept:()=>{reconcile();return bridgeReady;},alive:messenger.alive,
  mayRetry:()=>!disposed&&(isRecent()||isLoading()||!!session),delays:[200,800],onError:error=>console.error('[VideoSpeed] page bridge failed',error)});
 const bridgeAcknowledged=event=>{
  let value;try{value=JSON.parse(event.detail);}catch{return;}
  if(value?.owner===rateClient.sessionId&&value.version===VERSION&&value.enabled===true){bridgeReady=true;bridgeStartup.acknowledge();}
 };
 document.addEventListener('video-control:bridge-ready-v1',bridgeAcknowledged,true);
 const wake=event=>{
  if(disposed||!isRecent()&&(initialCatchupUsed||!isLoading())&&document.visibilityState==='hidden')return;
  connectLifeline();
  if(event?.type==='pageshow'&&event.persisted){startup.ensure({force:true,reason:'page-restored'});return;}
  if(session){
   if(event?.type==='focus'&&event.target===window||event?.type==='visibilitychange'&&document.visibilityState==='visible')startup.ensure({force:true,reason:'focus-returned'});
   return;
  }
  if(startup.ready&&!settingsForUrls(settings,location.href,window===window.top?location.href:pageUrl).enabled)return;
  startup.ensure({force:startup.ready,reason:'page-event'});
 };
 for(const type of ['focus','pageshow'])window.addEventListener(type,wake,true);
 for(const type of ['visibilitychange','loadedmetadata','playing'])document.addEventListener(type,wake,true);
 const wakeKey=event=>{
  if(disposed||!event.isTrusted||editingEvent(event))return;
  if(session){if(session.handleKey(event)||isFocused()||!document.hasFocus())return;}
  const command=shortcutAction(event,settings.shortcuts);if(!command)return;
  const enabled=localPolicyKnown&&contextReady&&settingsForUrls(settings,location.href,window===window.top?location.href:pageUrl).enabled;
  if(localPolicyKnown&&contextReady&&!enabled)return;
  if(enabled){event.preventDefault();event.stopImmediatePropagation();}
  startup.ensure({force:true,reason:'shortcut'}).then(async ok=>{if(!session&&bridgeStartup.task)await bridgeStartup.task;if(enabled&&ok&&session&&settingsForUrls(settings,location.href,window===window.top?location.href:pageUrl).enabled)session.handleKey(event);});
 };
 window.addEventListener('keydown',wakeKey,true);
 Promise.resolve().then(()=>messenger.call(chrome.storage.local,'get','settings')).then(messenger.guard(data=>{if(configuration===0&&data){localPolicyKnown=true;configure(data.settings);}})).catch(()=>{});
 const initial=startup.ensure();
 const storageChanged=(changes,area)=>{
  if(area!=='local'||disposed)return;
  if(changes.popupLanguage){language=resolveLanguage(changes.popupLanguage.newValue);session?.updateLanguage(language);}
  if(rateClient.acceptStorageChanges(changes,area)==='refresh'&&!rateRefresh){
   rateRefresh=send({action:'settings'}).then(messenger.guard(response=>{if(response?.ok){rateClient.accept(response);if(acceptActivity(response.activity))reconcile();}})).finally(()=>{rateRefresh=null;});
  }
  if(changes.settings){localPolicyKnown=true;configure(changes.settings.newValue);}
 };
 const receive=(message,sender,respond)=>{
  if(message?.scope!==SCOPE)return;
  respond=messenger.guard(respond);
  if(message.action==='power'||message.action==='activity'){
   language=resolveLanguage(message.language);session?.updateLanguage(language);
   rateClient.accept(message);
   const accepted=acceptActivity(message.activity);
   if(accepted){pageUrl=message.pageUrl||pageUrl;contextReady=true;localPolicyKnown=true;}
   if(message.action==='power'){
    // A queued page message may predate several successful saves. Read the
    // committed value; a newer storage event or read supersedes this result.
    readSavedSettings().then(messenger.guard(()=>respond({ok:true,version:VERSION,enabled:!!session})),messenger.guard(error=>{startup.ensure({force:true,reason:'settings-read-failed'});respond({ok:false,error:error.message||'Could not read saved settings'});}));
    return true;
   }
   if(!accepted){respond({ok:true,version:VERSION,enabled:!!session});return;}
   if(configuration===0)configure(message.settings);else reconcile();
   respond({ok:true,version:VERSION,enabled:!!session});return;
  }
  if(session)return session.receive(message,sender,respond);
  respond(message.action==='control'||message.action==='pick'||message.action==='activeTarget'?{ok:false,error:"Video controls are not ready"}:{ok:true,videos:[],highlighted:false});
 };
 if(disposed)return;
 stopStorage=messenger.guard(()=>messenger.listen(chrome.storage.onChanged,storageChanged))()||(()=>{});
 if(disposed){stopStorage();return;}
 stopMessages=messenger.guard(()=>messenger.listen(chrome.runtime.onMessage,receive))()||(()=>{});
 if(disposed){stopStorage();stopMessages();return;}
 const ensureSession=async()=>{await initial;if(!session)await startup.ensure({force:true,reason:'refresh'});if(!session)await bridgeStartup.task;};
 const api={version:VERSION,alive:()=>!disposed&&messenger.alive(),enabled:()=>!!session,dispose,startup:()=>({...startup.snapshot(),bridge:bridgeStartup.snapshot()}),snapshot:()=>session?.snapshot()||[],diagnostics:()=>session?.diagnostics()||[],refreshSnapshot:async()=>{await ensureSession();return session?session.refreshSnapshot():{videos:[],pendingUntil:0};},refresh:async()=>{await ensureSession();return session?session.refresh():[];}};
 globalThis[API]=api;
 function connectLifeline(){
  if(disposed||lifeline)return;
  stopDisconnect();stopDisconnect=()=>{};
  const port=messenger.call(chrome.runtime,'connect',{name:'video-control-content'});if(!port||disposed)return;
  lifeline=port;
  stopDisconnect=messenger.listenDisconnect(port,()=>{if(lifeline===port){lifeline=null;stopDisconnect();stopDisconnect=()=>{};}});
 }
 connectLifeline();
 if(disposed){stopStorage();stopMessages();stopDisconnect();messenger.cleanup(()=>lifeline?.disconnect());}
 function dispose(){
  if(disposed)return;disposed=true;clearTimeout(activityTimer);session?.dispose();session=null;
  startup.dispose();bridgeStartup.dispose();document.removeEventListener('video-control:bridge-ready-v1',bridgeAcknowledged,true);
  for(const type of ['focus','pageshow'])window.removeEventListener(type,wake,true);
  for(const type of ['visibilitychange','loadedmetadata','playing'])document.removeEventListener(type,wake,true);
  window.removeEventListener('keydown',wakeKey,true);
  document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,release:true,enabled:false})}));
  stopStorage();stopMessages();stopDisconnect();messenger.cleanup(()=>lifeline?.disconnect());
  if(globalThis[API]?.dispose===dispose)delete globalThis[API];
 }
}
