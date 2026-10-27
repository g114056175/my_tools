import {normalizeSettings,validateSettings,rankTargets} from './settings.js';
import {disabledOnUrl} from './site-rules.js';
import {resolveLanguage,translate} from '../extension/i18n.js';
import {RateMemory,RateWriteLedger} from './rate-memory.js';
import {TabActivity,replayTabActivityEvents} from './tab-activity.js';
const SCOPE='video-control',VERSION='0.6.10',frames=new Map(),pinned=new Map(),ports=new Map(),contentPorts=new Set(),announced=new Map(),markerQueues=new Map(),markedTargets=new Map(),refreshTasks=new Map();
const keyOf=(frame,id)=>frame.frameId+':'+(frame.documentId||'')+':'+id;
const optionsOf=target=>target.documentId?{documentId:target.documentId}:{frameId:target.frameId};
const tabGenerations=new Map(),frameGenerations=new Map();let navigationSerial=0;
function tabGeneration(tabId){if(!tabGenerations.has(tabId))tabGenerations.set(tabId,++navigationSerial);return tabGenerations.get(tabId);}
const frameGeneration=(tabId,frameId)=>frameGenerations.get(tabId)?.get(frameId)||0;
const selectionDeliveries=new Map();
function clearSelectionDelivery(tabId){const delivery=selectionDeliveries.get(tabId);clearTimeout(delivery?.timer);selectionDeliveries.delete(tabId);}
function sendSelection(tabId,message,options){
 return new Promise(resolve=>{
  const timer=setTimeout(()=>resolve(null),1000);
  Promise.resolve().then(()=>chrome.tabs.sendMessage(tabId,message,options)).then(response=>{clearTimeout(timer);resolve(response);},()=>{clearTimeout(timer);resolve(null);});
 });
}
let settingsCache,settingsTask,powerSignature,powerQueue=Promise.resolve(),settingsWrites=Promise.resolve(),language=resolveLanguage(null);
const rateMemory=new RateMemory(chrome.storage.local);
const rateWriteLedger=new RateWriteLedger();
const tabActivity=new TabActivity(),activityNoticeQueues=new Map(),activityRestoreAttempts=new Set(),activityRestoreTasks=new Map();
let activityReady,activityInitialized=false,activityEventRevision=0,activityGeneration=0,activityEvents=[],activityWrites=Promise.resolve();
const titleFor=(settings,blocked=false)=>translate(language,!settings.enabled?"VideoSpeed (disabled)":blocked?"VideoSpeed (disabled on this site)":'VideoSpeed');
async function stored(){
 if(settingsCache)return settingsCache;
 if(!settingsTask)settingsTask=chrome.storage.local.get(['settings','popupLanguage']).then(data=>{
  settingsCache=normalizeSettings(data.settings);language=resolveLanguage(data.popupLanguage);
  queueMicrotask(()=>syncPower(settingsCache).catch(()=>{}));return settingsCache;
 }).finally(()=>{settingsTask=null;});
 return settingsTask;
}
const settingsReady=stored();
async function rateState(){await stored();return rateMemory.read();}
async function optionalRateState(){try{return await rateState();}catch{return null;}}
function saveActivity(){
 const snapshot=tabActivity.snapshot();
 activityWrites=activityWrites.catch(()=>{}).then(()=>chrome.storage.session.set({tabActivity:snapshot}));
 return activityWrites;
}
async function readFocusedContext(){
 const window=await chrome.windows.getLastFocused();
 if(!window?.focused||!Number.isInteger(window.id))return {windowId:null,tabId:null};
 const [tab]=await chrome.tabs.query({active:true,windowId:window.id});
 return {windowId:window.id,tabId:Number.isInteger(tab?.id)?tab.id:null};
}
function queueActivityEvent(event){
 activityEventRevision++;
 if(!activityInitialized){activityEvents.push(event);return;}
 applyActivityEvent(event);
}
function applyActivityEvent(event){
 if(event.type==='activated'){
  const cached=tabActivity.rememberActiveTab(event.windowId,event.tabId);
  if(event.windowId===tabActivity.focusedWindowId)activityGeneration++;
  const previousRevision=tabActivity.revision;
  const affected=tabActivity.setActiveTab(event.windowId,event.tabId,event.at);
  if(cached||tabActivity.revision!==previousRevision)saveActivity().catch(()=>{});
  for(const tabId of affected)notifyActivity(tabId);
  return;
 }
 activityGeneration++;
 const windowId=event.windowId===chrome.windows.WINDOW_ID_NONE?null:event.windowId;
 const previousRevision=tabActivity.revision;
 const affected=tabActivity.setFocusedWindow(windowId,event.at);
 if(tabActivity.revision!==previousRevision)saveActivity().catch(()=>{});
 for(const tabId of affected)notifyActivity(tabId);
 if(windowId===null)return;
 const generation=activityGeneration;
 chrome.tabs.query({active:true,windowId}).then(tabs=>{
  if(generation!==activityGeneration||tabActivity.focusedWindowId!==windowId)return;
  const tabId=tabs.find(tab=>Number.isInteger(tab.id))?.id;
  if(!Number.isInteger(tabId))return;
  const changed=tabActivity.setActiveTab(windowId,tabId,Date.now());
  if(changed.length){saveActivity().catch(()=>{});for(const id of changed)notifyActivity(id);}
 }).catch(()=>{});
}
async function initializeTabActivity(){
 const startedAt=Date.now(),windowAtStart=chrome.windows.getLastFocused().catch(()=>null);
 let session={};try{session=await chrome.storage.session.get('tabActivity');}catch{}
 tabActivity.restore(session.tabActivity);
 const initialWindow=await windowAtStart;
 let context;const affected=new Set(),buffered=[];
 for(;;){
  buffered.push(...activityEvents.splice(0));
  const revision=activityEventRevision;
  try{context=await readFocusedContext();}catch{context={windowId:null,tabId:null};}
  if(revision!==activityEventRevision)continue;
  const firstFocus=buffered.find(event=>event.type==='focus');
  let seedWindow=null;
  if(initialWindow?.focused&&Number.isInteger(initialWindow.id))seedWindow=initialWindow.id;
  else if(firstFocus?.windowId===chrome.windows.WINDOW_ID_NONE&&Number.isInteger(initialWindow?.id)&&buffered.some(event=>event.type==='activated'&&event.windowId===initialWindow.id&&event.at<=firstFocus.at))seedWindow=initialWindow.id;
  if(!firstFocus&&Number.isInteger(context.windowId))seedWindow=context.windowId;
  if(seedWindow!==null&&tabActivity.focusedWindowId!==seedWindow)for(const tabId of tabActivity.setFocusedWindow(seedWindow,buffered[0]?.at||startedAt))affected.add(tabId);
  for(const tabId of replayTabActivityEvents(tabActivity,buffered,{windowIdNone:chrome.windows.WINDOW_ID_NONE}))affected.add(tabId);
  for(const tabId of tabActivity.reconcile(context,Date.now()))affected.add(tabId);
  break;
 }
 if(Number.isInteger(tabActivity.focusedTabId))affected.add(tabActivity.focusedTabId);
 for(const [tabId,until]of tabActivity.untilByTab)if(until>Date.now())affected.add(tabId);
 activityInitialized=true;
 await saveActivity().catch(()=>{});
 return [...affected];
}
activityReady=initializeTabActivity();
activityReady.then(affected=>{for(const tabId of affected)notifyActivity(tabId);}).catch(()=>{});
chrome.tabs.onActivated.addListener(info=>queueActivityEvent({type:'activated',tabId:info.tabId,windowId:info.windowId,at:Date.now()}));
chrome.tabs.onCreated?.addListener(tab=>{if(tab.active)queueActivityEvent({type:'activated',tabId:tab.id,windowId:tab.windowId,at:Date.now()});});
chrome.windows.onFocusChanged.addListener(windowId=>queueActivityEvent({type:'focus',windowId,at:Date.now()}));
chrome.windows.onRemoved?.addListener(windowId=>{const at=Date.now();activityReady.then(()=>{for(const tabId of tabActivity.forgetWindow(windowId,at))notifyActivity(tabId);saveActivity().catch(()=>{});}).catch(()=>{});});
async function activityFor(tabId){await activityReady;return tabActivity.activity(tabId);}
let activityRecheck=null;
async function ensureStartupActivity(tabId){
 const activity=await activityFor(tabId);if(activity.focused)return;
 if(!activityRecheck){
  const revision=activityEventRevision;
  activityRecheck=readFocusedContext().then(context=>{
   if(revision!==activityEventRevision)return;
   const changed=tabActivity.reconcile(context,Date.now());
   if(changed.length){saveActivity().catch(()=>{});for(const id of changed)notifyActivity(id);}
  }).catch(()=>{}).finally(()=>{activityRecheck=null;});
 }
 await activityRecheck;
}
async function activityFields(tabId,pageUrl){
 const [settings,rate]=await Promise.all([stored(),optionalRateState()]);
 if(pageUrl===undefined)try{pageUrl=(await chrome.tabs.get(tabId)).url||'';}catch{pageUrl='';}
 return {activity:await activityFor(tabId),settings,pageUrl,language,...(rate?{lastRate:rate.lastRate,rateRevision:rate.rateRevision}:{})};
}
async function sendActivityUpdate(tabId){
 let tab;try{tab=await chrome.tabs.get(tabId);}catch{return;}
 const fields=await activityFields(tabId,tab.url||''),message={scope:SCOPE,action:'activity',...fields};
 try{const response=await chrome.tabs.sendMessage(tabId,message);if(response?.ok===true&&response.version===VERSION)return;}catch{}
 // New documents receive manifest scripts at document_start; do not queue an
 // idle-time recovery in front of later blur/focus notifications.
 if(tab.status==='loading'||activityRestoreAttempts.has(tabId)||!/^https?:/i.test(tab.url||''))return;
 activityRestoreAttempts.add(tabId);
 if(!activityRestoreTasks.has(tabId)){
  const task=restoreOpenTab(tabId).then(()=>notifyActivity(tabId)).catch(()=>{}).finally(()=>{if(activityRestoreTasks.get(tabId)===task)activityRestoreTasks.delete(tabId);});
  activityRestoreTasks.set(tabId,task);
 }
}
function notifyActivity(tabId){
 const pending=activityNoticeQueues.get(tabId);if(pending){pending.again=true;return pending.task;}
 const job={again:true,task:null};activityNoticeQueues.set(tabId,job);
 job.task=(async()=>{try{while(job.again){job.again=false;await sendActivityUpdate(tabId);}}catch{}finally{if(activityNoticeQueues.get(tabId)===job)activityNoticeQueues.delete(tabId);}})();
 return job.task;
}
async function pausedTarget(tabId){await powerQueue;const data=await chrome.storage.session.get('pausedTargets');return data.pausedTargets?.[tabId]||null;}
function syncPower(settings){
 powerQueue=powerQueue.catch(()=>{}).then(async()=>{
  const enabled=settings.enabled,signature=JSON.stringify([enabled,settings.disabledSites,settings.siteModes]);if(powerSignature===signature)return;powerSignature=signature;
  const cached=await chrome.storage.session.get('pausedTargets'),frozen={...cached.pausedTargets};
  const tabs=new Set([...frames.keys(),...[...contentPorts].map(port=>port.sender?.tab?.id),...[...ports.values()].map(item=>item.tabId)].filter(Number.isInteger));
  if(!enabled){
   for(const tabId of selectionDeliveries.keys())clearSelectionDelivery(tabId);
   for(const tabId of frames.keys()){const target=targetFor(tabId);if(target)frozen[tabId]=target;}
   await chrome.storage.session.set({pausedTargets:frozen});
   frames.clear();announced.clear();pinned.clear();
  }
  const rate=await optionalRateState();
  await Promise.allSettled([...tabs].map(tabId=>applyPagePolicy(tabId,undefined,settings,rate)));
  await chrome.action.setIcon({path:Object.fromEntries([16,32,48,128].map(size=>[size,'icons/'+(enabled?'':'off-')+size+'.png']))});
  await chrome.action.setTitle({title:titleFor(settings)});
  for(const [port,item]of ports)try{port.postMessage({action:'updated',tabId:item.tabId});}catch{}
 });return powerQueue;
}
async function applyPagePolicy(tabId,pageUrl,settings,rate){
 settings=settings||await stored();if(pageUrl===undefined)pageUrl=(await chrome.tabs.get(tabId)).url||'';
 const blocked=disabledOnUrl(pageUrl,settings.disabledSites,settings.siteModes),enabled=settings.enabled&&!blocked;
 if(!enabled){clearSelectionDelivery(tabId);frames.delete(tabId);announced.delete(tabId);pinned.delete(tabId);}
 if(rate===undefined)rate=await optionalRateState();
 const message={scope:SCOPE,action:'power',settings,pageUrl,language,activity:await activityFor(tabId)};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
 await chrome.tabs.sendMessage(tabId,message).catch(()=>{});
 await chrome.action.setIcon({tabId,path:Object.fromEntries([16,32,48,128].map(size=>[size,'icons/'+(enabled?'':'off-')+size+'.png']))});
 await chrome.action.setTitle({tabId,title:titleFor(settings,blocked)});
 for(const [port,item]of ports)if(item.tabId===tabId)try{port.postMessage({action:'updated',tabId});}catch{}
}
function itemsFor(tabId){return [...(frames.get(tabId)?.values()||[])].flatMap(frame=>frame.videos.map(video=>({...video,frameId:frame.frameId,documentId:frame.documentId,key:keyOf(frame,video.id)})));}
function targetFor(tabId){return rankTargets(itemsFor(tabId),pinned.get(tabId))[0]||null;}
function highlight(tabId,scroll=false,clear=false){
 const previous=markerQueues.get(tabId)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  const target=clear||!(await stored()).enabled?null:targetFor(tabId);
  if(!target||markedTargets.get(tabId)?.key!==target.key)await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'highlight',options:{clear:true}}).catch(()=>{});
  if(!target){markedTargets.delete(tabId);return;}
  const response=await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'highlight',options:{mediaKey:target.id,title:target.title,scrollIntoView:scroll}},optionsOf(target)).catch(()=>null);
  if(response?.highlighted)markedTargets.set(tabId,{key:target.key,title:target.title});else markedTargets.delete(tabId);
 });
 markerQueues.set(tabId,next);return next;
}
async function announce(tabId,force=false){
 if(!(await stored()).enabled)return;
 const target=targetFor(tabId),key=target?.key||'';
 const recipients=[...(frames.get(tabId)?.values()||[])],signature=JSON.stringify([key,recipients.map(frame=>[frame.frameId,frame.documentId])]);
 let delivery=selectionDeliveries.get(tabId);
 if(delivery?.signature!==signature){clearTimeout(delivery?.timer);delivery={signature,key,attempts:0,pending:false,timer:null};selectionDeliveries.set(tabId,delivery);}
 if((force||announced.get(tabId)!==key)&&!delivery.pending){
  clearTimeout(delivery.timer);delivery.timer=null;delivery.pending=true;delivery.attempts++;
  try{
   const rate=await optionalRateState();
   if(selectionDeliveries.get(tabId)!==delivery)return;
   const message={scope:SCOPE,action:'activeTarget',hasTarget:!!target};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
   const responses=await Promise.allSettled(recipients.map(async frame=>{
    const id=frame.documentId===target?.documentId&&frame.frameId===target?.frameId?target.id:null;
    const response=await sendSelection(tabId,{...message,id},optionsOf(frame));
    return response?.ok===true&&response.activeId===id;
   }));
   if(selectionDeliveries.get(tabId)!==delivery)return;
   if(responses.every(response=>response.status==='fulfilled'&&response.value===true)){announced.set(tabId,key);delivery.attempts=0;}
   else{
    if(announced.get(tabId)===key)announced.delete(tabId);
    if(delivery.attempts<3)delivery.timer=setTimeout(()=>{delivery.timer=null;if(selectionDeliveries.get(tabId)===delivery)announce(tabId,true).catch(()=>{});},delivery.attempts===1?100:400);
   }
  }finally{delivery.pending=false;}
 }
 if([...ports.values()].some(item=>item.tabId===tabId)&&(markedTargets.get(tabId)?.key!==key||markedTargets.get(tabId)?.title!==target?.title))highlight(tabId);
 for(const [port,item]of ports)if(item.tabId===tabId)try{port.postMessage({action:'updated',tabId});}catch{}
}
function record(tabId,frameId,documentId,videos){
 if(!frames.has(tabId))frames.set(tabId,new Map());
 const fresh=frames.get(tabId).get(frameId)?.documentId!==documentId;
 frames.get(tabId).set(frameId,{frameId,documentId,videos:Array.isArray(videos)?videos.slice(0,64):[]});announce(tabId,fresh);
}
async function refresh(tabId,force=false){
 const settings=await stored();if(!settings.enabled||disabledOnUrl((await chrome.tabs.get(tabId)).url,settings.disabledSites,settings.siteModes))return;
 const pending=refreshTasks.get(tabId);
 if(pending){if(!force||pending.force)return pending.task;await pending.task.catch(()=>{});return refresh(tabId,true);}
 const task=(async()=>{
  const generation=tabGeneration(tabId);
  const target=force?null:targetFor(tabId);
  if(target){
   const before=frames.get(tabId)?.get(target.frameId),frameVersion=frameGeneration(tabId,target.frameId);
   try{
    const result=await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'refreshTarget'},optionsOf(target));
    if(result?.ok&&Array.isArray(result.videos)&&result.videos.some(video=>video.id===target.id&&video.connected!==false)){
     if(tabGenerations.get(tabId)===generation&&frameGeneration(tabId,target.frameId)===frameVersion){if(frames.get(tabId)?.get(target.frameId)===before)record(tabId,target.frameId,target.documentId,result.videos);return;}
    }
   }catch{}
  }
  if(await refreshFrames(tabId)===false)await refreshFrames(tabId);
 })();
 const entry={task,force};refreshTasks.set(tabId,entry);
 try{return await task;}finally{if(refreshTasks.get(tabId)===entry)refreshTasks.delete(tabId);}
}
async function refreshFrames(tabId){
 const generation=tabGeneration(tabId),before=new Map(frames.get(tabId)||[]),frameVersions=new Map(frameGenerations.get(tabId)||[]);
 const probes=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,allFrames:true},world:'ISOLATED',func:version=>{
  if(/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname))return 'skip';
  const api=globalThis[Symbol.for('video-control.api')];
  try{if(api?.version===version&&api.alive())return true;}catch{}
  try{api?.dispose?.();}catch{}
  globalThis[Symbol.for('video-control.recovering')]=true;return false;
 },args:[VERSION]});
 const missing=probes.filter(frame=>frame.result===false).map(frame=>frame.frameId);
 if(missing.length){
  await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,frameIds:missing},world:'MAIN',files:['page-bridge.js']});
  await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,frameIds:missing},world:'ISOLATED',files:['content.js']});
 }
 const results=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,allFrames:true},world:'ISOLATED',func:async()=>{
  if(/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname))return [];
  const api=globalThis[Symbol.for('video-control.api')];
  if(!api?.alive?.())throw Error("Could not connect to the video");
  return await api.refresh();
 }});
 let liveFrames;try{liveFrames=await chrome.webNavigation.getAllFrames({tabId});}catch{}
 if(!(await stored()).enabled||tabGenerations.get(tabId)!==generation)return false;
 if(Array.isArray(liveFrames))for(const [frameId,entry]of before)if(!liveFrames.some(frame=>frame.frameId===frameId)&&frames.get(tabId)?.get(frameId)===entry)frames.get(tabId).delete(frameId);
 for(const item of results){
  // A live report received during this refresh is newer than its snapshot.
  if(frameGeneration(tabId,item.frameId)!==(frameVersions.get(item.frameId)||0)||frames.get(tabId)?.get(item.frameId)!==before.get(item.frameId))continue;
  record(tabId,item.frameId,item.documentId,item.result);
 }
 await announce(tabId);
 return true;
}
async function currentTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error("Open a page with a video first");return tab;}
async function dispatch(tabId,message,retry=true){
 const target=message.key?itemsFor(tabId).find(item=>item.key===message.key):targetFor(tabId);
 if(!target)throw Error("Video changed; select it again");
 const settings=await stored();
 if(!settings.enabled)throw Error("VideoSpeed is disabled");
 if(disabledOnUrl((await chrome.tabs.get(tabId)).url,settings.disabledSites,settings.siteModes))throw Error("Disabled on this site");
 let result;
 try{result=await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'control',id:target.id,command:message.command,value:message.value,language},optionsOf(target));}
 catch(error){if(!retry||message.key)throw error;await refresh(tabId,true);return dispatch(tabId,message,false);}
 if(!result?.ok)throw Error(result?.error||"Video did not respond; reload the page");
 const frame=frames.get(tabId)?.get(target.frameId);
 if(frame?.documentId===target.documentId){const video=frame.videos.find(item=>item.id===target.id);if(video)Object.assign(video,result.result);}
 return result.result;
}
function rateWriteAck(message,state,accepted){return {...state,rateSessionId:message.rateSessionId,rateWriteId:message.rateWriteId,accepted};}
async function currentRateWriteAck(message,accepted=false){return rateWriteAck(message,await rateState(),accepted);}
async function persistRateMessage(message,token,targetMatches){
 if(!token)return {};
 if(['stale','conflict'].includes(token.status))return currentRateWriteAck(message);
 if(token.status==='completed')return currentRateWriteAck(message,true);
 if(!targetMatches||!(await stored()).enabled)return currentRateWriteAck(message);
 const state=await rateMemory.remember(message.rate,message.source,{isCurrent:token.isCurrent});
 if(state&&token.complete())return rateWriteAck(message,state,true);
 return currentRateWriteAck(message);
}
function changeSettings(patch){
 settingsWrites=settingsWrites.catch(()=>{}).then(async()=>{
  const settings=validateSettings({...await stored(),...patch});settingsCache=settings;await chrome.storage.local.set({settings});await syncPower(settings);return settings;
 });return settingsWrites;
}
async function run(message,sender){
 await activityReady;
 if(message.action==='repairBridge'){
  const tabId=sender.tab?.id;if(!Number.isInteger(tabId))throw Error('Video page required');
  const settings=await stored(),activity=await activityFor(tabId);
  const frame=frames.get(tabId)?.get(sender.frameId||0),playing=frame?.documentId===sender.documentId&&frame?.videos.some(video=>video.playing&&video.connected!==false);
  if(!settings.enabled||disabledOnUrl(sender.tab.url,settings.disabledSites,settings.siteModes)||disabledOnUrl(sender.url,settings.disabledSites,settings.siteModes)||!activity.focused&&activity.until<=Date.now()&&!playing)throw Error('Video controls are not active on this page');
  await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,...(sender.documentId?{documentIds:[sender.documentId]}:{frameIds:[sender.frameId||0]})},world:'MAIN',files:['page-bridge.js']});
  return {};
 }
 if(message.action==='settings'){if(Number.isInteger(sender.tab?.id))await ensureStartupActivity(sender.tab.id);const settings=await stored(),rate=await rateState();return {settings,lastRate:rate.lastRate,rateRevision:rate.rateRevision,pageUrl:sender.tab?.url||'',language,activity:await activityFor(sender.tab?.id)};}
 if(message.action==='report'){
  const hint=message.rememberedRate,token=hint?rateWriteLedger.begin(hint,sender):null,settings=await stored();let targetMatches=false;
  if(settings.enabled&&sender.tab?.id&&!disabledOnUrl(sender.tab.url,settings.disabledSites,settings.siteModes)&&!disabledOnUrl(sender.url,settings.disabledSites,settings.siteModes)){
   record(sender.tab.id,sender.frameId,sender.documentId,message.videos);const target=targetFor(sender.tab.id);
   targetMatches=!!hint&&target?.id===hint.id&&target.frameId===sender.frameId&&target.documentId===sender.documentId;
  }
  return token?persistRateMessage(hint,token,targetMatches):{};
 }
 if(message.action==='rememberRate'){
  const token=rateWriteLedger.begin(message,sender);if(!token)return {};
  const target=targetFor(sender.tab?.id);
  const targetMatches=!!target&&target.id===message.id&&target.frameId===sender.frameId&&target.documentId===sender.documentId;
  return await persistRateMessage(message,token,targetMatches);
 }
 if(message.action==='picked'){
  if(!(await stored()).enabled)return {};
  if(!sender.tab?.id)return {};pinned.set(sender.tab.id,keyOf(sender,message.id));
  await chrome.tabs.sendMessage(sender.tab.id,{scope:SCOPE,action:'cancelPick'}).catch(()=>{});
  await announce(sender.tab.id);if(typeof chrome.action.openPopup==='function')await chrome.action.openPopup().catch(()=>{});return {};
 }
 const fromPage=sender.tab&&!sender.url?.startsWith(chrome.runtime.getURL(''));
 const tab=fromPage?sender.tab:Number.isInteger(message.tabId)?await chrome.tabs.get(message.tabId):await currentTab(),tabId=tab.id;
 if(message.action==='activity')return activityFields(tabId,tab.url||'');
 if(message.action==='getState'||message.action==='cachedState'){
  const settings=await stored(),pageUrl=tab.url||'',siteDisabled=disabledOnUrl(pageUrl,settings.disabledSites,settings.siteModes);
  if(message.action==='getState'&&settings.enabled&&!siteDisabled)try{await refresh(tabId,message.refresh===true);}catch{}
  const target=siteDisabled?null:settings.enabled?targetFor(tabId):await pausedTarget(tabId),rate=await rateState();return {tabId,pageUrl,siteDisabled,settings,loading:tab.status==='loading',lastRate:rate.lastRate,rateRevision:rate.rateRevision,videos:target?[target]:[],target};
 }
 if(message.action==='updateSettings'){
  const fields=['enabled','preferredRate','defaultMode','customRate','qualityEnabled','preferredQuality','steps','shortcuts','disabledSites','siteModes'];
  const patch=Object.fromEntries(Object.entries(message.patch||{}).filter(([key])=>fields.includes(key)));
  return {settings:await changeSettings(patch)};
 }
 if(message.action==='setEnabled')return {settings:await changeSettings({enabled:message.enabled===true})};
 if(message.action==='saveSettings')return {settings:await changeSettings(validateSettings(message.settings))};
 const settings=await stored();
 if(!settings.enabled)throw Error("VideoSpeed is disabled");
 if(disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes))throw Error("Disabled on this site");
 if(message.action==='select'){
  if(!itemsFor(tabId).some(item=>item.key===message.key))throw Error("Video changed; select it again");
  pinned.set(tabId,message.key);await announce(tabId);await highlight(tabId,true);return {};
 }
 if(message.action==='pick'){await refresh(tabId,true);await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'pick',language:resolveLanguage(message.language||language)});return {};}
 if(message.action==='cancelPick'){await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'cancelPick'}).catch(()=>{});return {};}
 if(message.action==='command'){if(!targetFor(tabId))await refresh(tabId);return {result:await dispatch(tabId,message)};}
 throw Error("Unsupported action");
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.scope!==SCOPE)return;
 run(message,sender).then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message||"Operation failed"}));return true;
});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name==='video-control-content'){contentPorts.add(port);port.onDisconnect.addListener(()=>contentPorts.delete(port));return;}
 if(port.name!=='video-control-popup')return;
 const item={tabId:null};ports.set(port,item);
 port.onMessage.addListener(message=>{
  if(message.action==='watch'&&Number.isInteger(message.tabId)){const changed=item.tabId!==message.tabId;item.tabId=message.tabId;if(changed&&settingsCache?.enabled)highlight(item.tabId);}
  if(message.action==='renew'&&item.tabId&&settingsCache?.enabled){
   const target=targetFor(item.tabId);
   if(target)chrome.tabs.sendMessage(item.tabId,{scope:SCOPE,action:'highlight',options:{renew:true}},optionsOf(target)).then(result=>{if(!result?.highlighted)highlight(item.tabId);}).catch(()=>{});
  }
 });
 port.onDisconnect.addListener(()=>{ports.delete(port);if(item.tabId&&![...ports.values()].some(other=>other.tabId===item.tabId))highlight(item.tabId,false,true);});
});
function forgetTab(tabId){
 clearSelectionDelivery(tabId);
 tabGenerations.set(tabId,++navigationSerial);
 frameGenerations.delete(tabId);
 frames.delete(tabId);pinned.delete(tabId);announced.delete(tabId);markedTargets.delete(tabId);markerQueues.delete(tabId);
 rateWriteLedger.forgetTab(tabId);
 powerQueue=powerQueue.catch(()=>{}).then(async()=>{const data=await chrome.storage.session.get('pausedTargets'),frozen={...data.pausedTargets};if(Object.hasOwn(frozen,tabId)){delete frozen[tabId];await chrome.storage.session.set({pausedTargets:frozen});}});
}
function forgetActivityTab(tabId){
 activityRestoreAttempts.delete(tabId);activityRestoreTasks.delete(tabId);activityNoticeQueues.delete(tabId);
 if(tabActivity.forget(tabId))saveActivity().catch(()=>{});
}
chrome.tabs.onRemoved.addListener(tabId=>{forgetTab(tabId);activityReady.then(()=>forgetActivityTab(tabId)).catch(()=>{});tabGenerations.delete(tabId);});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading'){forgetTab(tabId);activityRestoreAttempts.delete(tabId);}if(change.status==='complete')activityFor(tabId).then(activity=>{if(activity.focused||activity.until>Date.now())notifyActivity(tabId);}).catch(()=>{});if(change.url)applyPagePolicy(tabId,change.url).catch(()=>{});});
async function frameRoute(details){
 if(details.frameId===0||details.tabId<0)return;
 const settings=await stored();if(!settings.enabled)return;
 const tab=await chrome.tabs.get(details.tabId),blocked=disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes)||disabledOnUrl(details.url,settings.disabledSites,settings.siteModes);
 if(blocked){frames.get(details.tabId)?.delete(details.frameId);await announce(details.tabId,true);}
 const rate=await optionalRateState(),message={scope:SCOPE,action:'power',settings,pageUrl:tab.url||'',language,activity:await activityFor(details.tabId)};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
 await chrome.tabs.sendMessage(details.tabId,message,details.documentId?{documentId:details.documentId}:{frameId:details.frameId}).catch(()=>{});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(details=>frameRoute(details).catch(()=>{}));
chrome.webNavigation.onReferenceFragmentUpdated.addListener(details=>frameRoute(details).catch(()=>{}));
chrome.webNavigation.onCommitted.addListener(details=>{if(details.frameId>0){if(!frameGenerations.has(details.tabId))frameGenerations.set(details.tabId,new Map());frameGenerations.get(details.tabId).set(details.frameId,++navigationSerial);frames.get(details.tabId)?.delete(details.frameId);announce(details.tabId,true).catch(()=>{});}});


chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local')rateMemory.observeChanges(changes,area).catch(()=>{});
 if(area==='local'&&changes.settings){settingsCache=normalizeSettings(changes.settings.newValue);syncPower(settingsCache).catch(()=>{});}
 if(area==='local'&&changes.popupLanguage){
  language=resolveLanguage(changes.popupLanguage.newValue);
  stored().then(async settings=>{await chrome.action.setTitle({title:titleFor(settings)});const tabs=new Set([...frames.keys(),...[...contentPorts].map(port=>port.sender?.tab?.id),...[...ports.values()].map(item=>item.tabId)].filter(Number.isInteger));await Promise.allSettled([...tabs].map(async tabId=>{const tab=await chrome.tabs.get(tabId);await chrome.action.setTitle({tabId,title:titleFor(settings,disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes))});}));}).catch(()=>{});
 }
});

async function restoreOpenTab(tabId){
 const frames=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,allFrames:true},world:'ISOLATED',func:version=>{
  if(/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname))return false;
  const api=globalThis[Symbol.for('video-control.api')];
  try{if(api?.version===version&&api.alive())return false;}catch{}
  try{api?.dispose?.();}catch{}
  document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4',{detail:JSON.stringify({enabled:false,force:true})}));
  globalThis[Symbol.for('video-control.recovering')]=true;
  return true;
 },args:[VERSION]});
 const frameIds=frames.filter(frame=>frame.result===true).map(frame=>frame.frameId);
 if(!frameIds.length)return;
 await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,frameIds},world:'MAIN',files:['page-bridge.js']});
 await chrome.scripting.executeScript({injectImmediately:true,target:{tabId,frameIds},world:'ISOLATED',files:['content.js']});
}
async function restoreOpenTabs(){
 // 僅在更新時被動接管既有分頁，不執行影片深查。
 await stored();
 const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
 for(let index=0;index<tabs.length;index+=4)await Promise.allSettled(tabs.slice(index,index+4).map(tab=>restoreOpenTab(tab.id)));
}
chrome.runtime.onInstalled.addListener(details=>{if(details.reason==='update')restoreOpenTabs().catch(()=>{});});
settingsReady.catch(()=>{});
