import {normalizeSettings,shortcutAction,editingEvent,validRate} from './settings.js';
import {RateController} from './rate-controller.js';
import {MediaRegistry,mediaSignature,mediaPreviewInfo,mediaCanInitialize} from './media-registry.js';
import {highlightMedia} from './media-highlight.js';
import {createRuntimeMessenger} from './runtime.js';
import {VideoToast} from './video-toast.js';
import {settingsForUrls} from './site-rules.js';
import {RateClient} from './rate-client.js';
import {TrustedRateInput} from './trusted-rate-input.js';
import {ActivityLease} from './activity-lease.js';
const SCOPE='video-control',VERSION='0.6.7',API=Symbol.for('video-control.api');
const previous=globalThis[API];
if(previous?.version!==VERSION||!previous?.alive?.()){try{previous?.dispose?.();}catch{}boot();}
function startSession(initialSettings,initialRate,send,alive,rateClient,{isRecent,onIdle}){
 const qualityDelays=[250,600,1200,2400];
 const videoToast=new VideoToast(document);
 const abort=new AbortController();
 let disposed=false;
 const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:abort.signal});
 let settings=initialSettings,ready=true,reportTimer,activeId=null,hasTarget=false,lastRate=initialRate,requestSerial=0,picker=null,rememberedRate=null;
 const states=new Map(),interactions=new WeakMap(),pending=new Map(),rateResponses=new Map();
 let trustedRateInput=null,retained=new WeakMap();
 const eligible=video=>video.isConnected&&(isRecent()||retained.get(video)===mediaSignature(video)&&!video.paused&&!video.ended);
 const hasRetained=()=>[...registry.videos.values()].some(eligible);
 const report=()=>{if(disposed)return;if(!isRecent()&&!hasRetained()){onIdle();return;}if(!alive()){queueMicrotask(dispose);return;}if(reportTimer)return;reportTimer=setTimeout(()=>{reportTimer=null;if(!isRecent()&&!hasRetained()){onIdle();return;}const hint=rememberedRate;rememberedRate=null;send({action:'report',videos:snapshot(),rememberedRate:hint}).then(response=>{if(hint)rateClient.acknowledge(hint.rateWriteId,response);});},120);};
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
  if(data?.owner===rateClient.sessionId&&state?.rate&&id===data.videoId&&data.info?.mediaKey===state.rateKeyToken&&(data.info?.origin!=='user'||trustedRateInput?.consume(video,data.info)))state.rate.observe({...data.info,mediaKey:state.rateKey});
 },true);
 const registry=new MediaRegistry(document,(video,id)=>{
  const preview=mediaPreviewInfo(video),signature=mediaSignature(video),initializedKey=preview?'':video.getAttribute('data-video-control-initialized')||'';
  const preserved=initializedKey===signature;
  const state={quality:{status:preserved?'preserved':'pending'},attempts:0,qualityKey:preserved?signature:null,timer:null,revision:0,rateKey:null,rateKeyToken:'',keySerial:0};states.set(id,state);
  state.rate=new RateController(video,{...settings,enabled:ready&&settings.enabled},{
   readRate:()=>rateOperation(video,id,{op:'read'}),
   writeRate:(_rate,options)=>rateOperation(video,id,options),
   releaseRate:()=>rateOperation(video,id,{op:'release'}),
   signature:()=>mediaSignature(video),isPreview:()=>!!mediaPreviewInfo(video),canInitialize:()=>eligible(video)&&mediaCanInitialize(video),initializedKey,onInitialize:key=>video.setAttribute('data-video-control-initialized',key),lastRate,selected:id===activeId,onChange:report,
   onDefaultApplied:()=>{state.initialRateNotice=mediaSignature(video);showInitialRate(video,id);},
   onRate:(rate,source)=>{
    lastRate=rate;const rateWriteId=rateClient.begin(rate),hint={id,rate,source,rateWriteId,rateSessionId:rateClient.sessionId};rememberedRate=hint;
    for(const item of states.values())if(item.rate)item.rate.lastRate=rate;
    send({action:'rememberRate',...hint}).then(response=>rateClient.acknowledge(rateWriteId,response));
   },
   onMedia:()=>queueMicrotask(()=>{
    if(disposed||!states.has(id))return;
    if(!isRecent()&&!eligible(video)){onIdle();return;}
    if(state.initialRateNotice!==state.rate.mediaKey)state.initialRateNotice=null;
    if(state.qualityKey!==state.rate.mediaKey){state.qualityKey=state.rate.mediaKey;state.attempts=0;state.revision++;clearTimeout(state.timer);state.timer=null;state.quality={status:'pending'};}
    queueQuality(video,id);
   }),
  });
  for(const name of ['pause','play','ended','resize','loadedmetadata'])listen(video,name,report);
  state.onPlayback=()=>showInitialRate(video,id);
  for(const name of ['play','playing'])listen(video,name,state.onPlayback);
 },report);
 registry.onRemove=(id,video)=>{
  const state=states.get(id);state?.rate.dispose();clearTimeout(state?.timer);states.delete(id);
  for(const name of ['pause','play','ended','resize','loadedmetadata'])video.removeEventListener(name,report);
  for(const name of ['play','playing'])video.removeEventListener(name,state?.onPlayback);
 };
 trustedRateInput=new TrustedRateInput(document,{getRecords:()=>[...registry.videos].map(([id,video])=>({video,selected:id===activeId,mediaKey:states.get(id)?.rateKeyToken}))});
 trustedRateInput.start();
 globalThis[Symbol.for('video-control.identities')]={keys:registry.ids};
 const snapshot=(details=false)=>registry.snapshot(states,interactions,{details,activeId});
 function showInitialRate(video,id){
  const state=states.get(id);
  if(!state?.initialRateNotice||disposed||!settings.enabled||id!==activeId||video.paused||video.ended||video.readyState<2)return;
  if(state.initialRateNotice!==mediaSignature(video)){state.initialRateNotice=null;return;}
  state.initialRateNotice=null;videoToast.show(video,video.playbackRate+'×');
 }
 function marker(options){
  globalThis[Symbol.for('video-control.selection')]={videos:[...registry.videos.values()]};
  const result=highlightMedia(options);
  if(options.clear)videoToast.release();
  else if(options.renew)videoToast.renew();
  else if(result.highlighted)videoToast.hold(registry.videos.get(options.mediaKey));
  return result;
 }
 function queueQuality(video,id){
  const state=states.get(id);if(disposed||!state||!ready||id!==activeId||!state.rate.initialized||!eligible(video)||!mediaCanInitialize(video))return;
  if(mediaPreviewInfo(video)){state.quality={status:'preview'};return;}
  if(!settings.enabled||!settings.qualityEnabled){state.quality={status:'disabled'};return;}
  if(video.readyState<1||state.timer||state.attempts>qualityDelays.length||['applied','requested','failed','preserved'].includes(state.quality.status))return;
  state.timer=setTimeout(async()=>{
   state.timer=null;if(!video.isConnected||!settings.enabled||!settings.qualityEnabled||id!==activeId||!eligible(video)||!mediaCanInitialize(video))return;
   const generation=state.rate.mediaKey,revision=state.revision,requestId='q-'+Date.now()+'-'+(++requestSerial);state.attempts++;
   const result=await new Promise(resolve=>{
    const timer=setTimeout(()=>{pending.delete(requestId);resolve({status:'failed',reason:'bridge-timeout'});},1800);
    pending.set(requestId,{video,id,resolve,timer});
    video.dispatchEvent(new CustomEvent('video-control:quality-request-v3',{detail:JSON.stringify({owner:rateClient.sessionId,requestId,videoId:id,preferred:settings.preferredQuality,revision}),bubbles:true,composed:true}));
   });
   if(disposed||states.get(id)!==state||state.rate.mediaKey!==generation||state.revision!==revision)return;
   state.quality={...result,attempts:state.attempts};report();
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
   if(!settings.qualityEnabled){clearTimeout(state.timer);state.timer=null;state.quality={...state.quality,status:'disabled'};}
   if(state.quality.status==='pending')queueQuality(video,id);
  }
  report();
 }
 function updateLastRate(rate){if(!validRate(rate))return;lastRate=Number(rate);for(const state of states.values())state.rate.lastRate=lastRate;}
 function updateActivity(){
  if(isRecent()){retained=new WeakMap();registry.setExploring(true);return true;}
  if(registry.exploring){
   for(const [id,video]of registry.videos){const rate=states.get(id)?.rate,key=mediaSignature(video);if(rate?.initialized&&rate.mediaKey===key&&!video.paused&&!video.ended)retained.set(video,key);}
   registry.setExploring(false);
  }
  for(const [id,video]of [...registry.videos])if(!eligible(video))registry.remove(id,video);
  return hasRetained();
 }
 function act(id,command,value){
  const video=registry.videos.get(id),state=states.get(id);if(!video||!state||!video.isConnected)throw Error('影片已切換，請重新選取');
  if(!eligible(video))throw Error('請先切回影片分頁');
  if(!settings.enabled)throw Error('VideoSpeed 已關閉');
  const result=state.rate.command(command,value);state.initialRateNotice=null;interactions.set(video,Date.now());videoToast.show(video,result.rateStatus==='failed'?result.rateError:result.rate+'×');report();return result;
 }
 listen(window,'keydown',event=>{
  if(!event.isTrusted)return;
  if(!alive()){dispose();return;}
  const command=shortcutAction(event,settings.shortcuts);if(!ready||!settings.enabled||!command||editingEvent(event)||(!hasTarget&&!snapshot().some(video=>video.visible)))return;
  event.preventDefault();event.stopImmediatePropagation();send({action:'command',command});
 },true);
 listen(document,'pointerdown',event=>{
  if(picker)return;const video=registry.fromEvent(event);if(video){interactions.set(video,Date.now());send({action:'report',videos:snapshot()});}
 },true);
 listen(document,'fullscreenchange',report,true);listen(window,'resize',report,{passive:true});
 let scrollTimer;listen(window,'scroll',()=>{if(!scrollTimer)scrollTimer=setTimeout(()=>{scrollTimer=null;report();},250);},{passive:true,capture:true});
 let routeQueued=false;
 function route(){if(routeQueued)return;routeQueued=true;queueMicrotask(()=>{routeQueued=false;if(disposed)return;for(const state of states.values())state.rate.sync();if(!isRecent())onIdle();report();});}
 listen(document,'video-control:media-ready-v1',event=>{const video=event.composedPath().find(node=>node?.tagName==='VIDEO');if(!video||!eligible(video))return;registry.add(video);const id=registry.ids.get(video),state=states.get(id);state?.rate.sync(true);if(state)queueQuality(video,id);report();},true);
 for(const name of ['popstate','hashchange','yt-navigate-finish','video-control:route'])listen(window,name,route,true);
 listen(window,'pagehide',()=>{clearTimeout(reportTimer);if(rememberedRate){send({action:'report',videos:snapshot(),rememberedRate});rememberedRate=null;}marker({clear:true});send({action:'report',videos:[]});});
 listen(window,'pageshow',report);
 listen(document,'video-control:shadow',event=>{for(const node of event.composedPath())if(node.shadowRoot)registry.scan(node.shadowRoot);},true);
 function cancelPick(){picker?.cancel();picker=null;}
 function startPick(language='zh-Hant'){
  cancelPick();registry.scan(document,true);marker({clear:true});
  const overlay=document.createElement('div');Object.assign(overlay.style,{position:'fixed',zIndex:2147483646,border:'3px solid #2b85bf',background:'#2b85bf22',borderRadius:'5px',pointerEvents:'none',display:'none',boxSizing:'border-box'});
  const label=document.createElement('div');label.textContent=language==='en'?'Select a video · Esc to cancel':'點選影片 · Esc 取消';Object.assign(label.style,{position:'fixed',top:'12px',left:'50%',transform:'translateX(-50%)',padding:'8px 14px',borderRadius:'8px',background:'#236fa7',color:'white',font:'13px system-ui',pointerEvents:'none',zIndex:2147483647});
  (document.fullscreenElement||document.documentElement).append(overlay);if(window===window.top)document.documentElement.append(label);
  const move=event=>{const video=registry.fromEvent(event);if(!video){overlay.style.display='none';return;}const r=video.getBoundingClientRect();Object.assign(overlay.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
  const click=event=>{const video=registry.fromEvent(event);if(!video)return;event.preventDefault();event.stopImmediatePropagation();const id=registry.ids.get(video);interactions.set(video,Date.now());cancelPick();send({action:'picked',id});};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();cancelPick();send({action:'cancelPick'});}};
  listen(document,'pointermove',move,true);listen(document,'click',click,true);listen(window,'keydown',key,true);
  const timer=setTimeout(()=>{cancelPick();send({action:'cancelPick'});},30000);
  picker={cancel(){clearTimeout(timer);overlay.remove();label.remove();document.removeEventListener('pointermove',move,true);document.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);}};
 }
 const api={dispose,snapshot,update,updateLastRate,updateActivity,diagnostics:()=>[...states].map(([id,state])=>({id,...state.rate.diagnostics(),key:state.rateKeyToken,memory:rateClient.snapshot(),bridge:rateOperation(registry.videos.get(id),id,{op:'diagnostics'})})),refresh:async(deep=true)=>{
  if(deep&&isRecent()){registry.scan(document,true);registry.titleCache=new WeakMap();}
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
    activeId=message.id||null;hasTarget=!!message.hasTarget;rateClient.accept(message);updateLastRate(rateClient.rate);
    for(const [id,state]of states){state.rate.lastRate=lastRate;state.rate.select(id===activeId);if(id!==activeId){clearTimeout(state.timer);state.timer=null;}}
    if(activeId){const video=registry.videos.get(activeId);queueQuality(video,activeId);showInitialRate(video,activeId);}respond({ok:true});
   }
   else if(message.action==='highlight')respond({ok:true,...marker(message.options)});
   else if(message.action==='control')respond({ok:true,result:act(message.id,message.command,message.value)});
   else if(message.action==='pick'){startPick(message.language);respond({ok:true});}
   else if(message.action==='cancelPick'){cancelPick();respond({ok:true});}
   else if(message.action==='snapshot')respond({ok:true,videos:snapshot()});
   else if(message.action==='refreshTarget'){api.refresh(false).then(videos=>respond({ok:true,videos}),error=>respond({ok:false,error:error.message}));return true;}
  }catch(error){respond({ok:false,error:error.message});}
 };
 function dispose(){
  if(disposed)return;disposed=true;ready=false;abort.abort();
  clearTimeout(reportTimer);clearTimeout(scrollTimer);videoToast.clear();cancelPick();
  for(const state of states.values()){clearTimeout(state.timer);state.rate?.dispose();}
  for(const job of pending.values()){clearTimeout(job.timer);job.resolve(null);}pending.clear();
  trustedRateInput?.dispose();registry.dispose();marker({clear:true});document.getElementById('video-control-toast')?.remove();

 }
 report();return {...api,receive};
}



function boot(){
 let disposed=false,session=null,settings=normalizeSettings({enabled:false}),lastRate=null,lifeline,configuration=0,pageUrl=window===window.top?location.href:'',contextReady=window===window.top;
 const activity=new ActivityLease();let activityTimer=null,idleQueued=false,rateRefresh=null;
 const isRecent=()=>activity.isRecent();
 const rateClient=new RateClient(rate=>{lastRate=rate;session?.updateLastRate(rate);});
 let stopStorage=()=>{},stopMessages=()=>{},stopDisconnect=()=>{};
 delete globalThis[Symbol.for('video-control.recovering')];
 const messenger=createRuntimeMessenger(chrome.runtime,dispose),send=message=>messenger.send({scope:SCOPE,...message});
 function acceptActivity(value){
  if(!activity.accept(value))return false;
  clearTimeout(activityTimer);activityTimer=null;
  if(!activity.focused&&activity.until>Date.now())activityTimer=setTimeout(()=>{activityTimer=null;if(isRecent())acceptActivity(activity);reconcile();},activity.until-Date.now());
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
 function reconcile(){
  if(disposed)return;
  if(!contextReady)return;
  const localSettings=settingsForUrls(settings,location.href,window===window.top?location.href:pageUrl);
  const recent=isRecent(),keep=localSettings.enabled&&session?.updateActivity(),enabled=localSettings.enabled&&validRate(lastRate)&&(recent||keep);
  if(!enabled){
   const previous=session;session=null;previous?.dispose();
   document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,enabled:false})}));
   if(previous)send({action:'report',videos:[]});
   return;
  }
  document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,enabled:true,exploring:recent,qualityEnabled:localSettings.qualityEnabled})}));
  if(session)session.update(localSettings,lastRate);
  else session=startSession(localSettings,lastRate,send,messenger.alive,rateClient,{isRecent,onIdle});
 }
 const initial=send({action:'settings'}).then(messenger.guard(response=>{if(response?.ok){rateClient.accept(response);if(!acceptActivity(response.activity))return;if(!contextReady||configuration===0)pageUrl=response.pageUrl||pageUrl;contextReady=true;configure(configuration===0?response.settings:settings);}}));
 const storageChanged=(changes,area)=>{
  if(area!=='local'||disposed)return;
  if(rateClient.acceptStorageChanges(changes,area)==='refresh'&&!rateRefresh){
   rateRefresh=send({action:'settings'}).then(messenger.guard(response=>{if(response?.ok){rateClient.accept(response);if(acceptActivity(response.activity))reconcile();}})).finally(()=>{rateRefresh=null;});
  }
  if(changes.settings)configure(changes.settings.newValue);
 };
 const receive=(message,sender,respond)=>{
  if(message?.scope!==SCOPE)return;
  if(message.action==='power'||message.action==='activity'){
   rateClient.accept(message);
   if(!acceptActivity(message.activity)){respond({ok:true,version:VERSION,enabled:!!session});return;}
   pageUrl=message.pageUrl||pageUrl;contextReady=true;
   if(message.action==='power'||configuration===0)configure(message.settings);else reconcile();
   respond({ok:true,version:VERSION,enabled:!!session});return;
  }
  if(session)return session.receive(message,sender,respond);
  respond(message.action==='control'||message.action==='pick'?{ok:false,error:'VideoSpeed 已關閉'}:{ok:true,videos:[],highlighted:false});
 };
 if(disposed)return;
 stopStorage=messenger.guard(()=>messenger.listen(chrome.storage.onChanged,storageChanged))()||(()=>{});
 if(disposed){stopStorage();return;}
 stopMessages=messenger.guard(()=>messenger.listen(chrome.runtime.onMessage,receive))()||(()=>{});
 if(disposed){stopStorage();stopMessages();return;}
 const api={version:VERSION,alive:()=>!disposed&&messenger.alive(),enabled:()=>!!session,dispose,snapshot:()=>session?.snapshot()||[],diagnostics:()=>session?.diagnostics()||[],refresh:async()=>{await initial;return session?session.refresh():[];}};
 globalThis[API]=api;
 lifeline=messenger.guard(()=>messenger.call(chrome.runtime,'connect',{name:'video-control-content'}))();
 if(lifeline&&!disposed)stopDisconnect=messenger.guard(()=>messenger.listen(lifeline.onDisconnect,()=>{if(!messenger.alive())messenger.invalidate();else lifeline=null;}))()||(()=>{});
 if(disposed){stopStorage();stopMessages();stopDisconnect();messenger.cleanup(()=>lifeline?.disconnect());}
 function dispose(){
  if(disposed)return;disposed=true;clearTimeout(activityTimer);session?.dispose();session=null;
  document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({owner:rateClient.sessionId,release:true,enabled:false})}));
  stopStorage();stopMessages();stopDisconnect();messenger.cleanup(()=>lifeline?.disconnect());
  if(globalThis[API]?.dispose===dispose)delete globalThis[API];
 }
}
