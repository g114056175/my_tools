import {normalizeSettings,validateSettings,rankTargets} from './settings.js';
import {disabledOnUrl} from './site-rules.js';
import {resolveLanguage,translate} from './i18n.js';
import {RateMemory,RateWriteLedger} from './rate-memory.js';
const SCOPE='video-control',VERSION='0.6.6',frames=new Map(),pinned=new Map(),ports=new Map(),contentPorts=new Set(),announced=new Map(),markerQueues=new Map(),refreshTasks=new Map();
const keyOf=(frame,id)=>frame.frameId+':'+(frame.documentId||'')+':'+id;
const optionsOf=target=>target.documentId?{documentId:target.documentId}:{frameId:target.frameId};
let settingsCache,powerSignature,powerQueue=Promise.resolve(),settingsWrites=Promise.resolve(),language=resolveLanguage(null,chrome.i18n.getUILanguage());
const rateMemory=new RateMemory(chrome.storage.local);
const rateWriteLedger=new RateWriteLedger();
const titleFor=(settings,blocked=false)=>translate(language,!settings.enabled?'VideoSpeed（已關閉）':blocked?'VideoSpeed（此網站已停用）':'VideoSpeed');
const settingsReady=chrome.storage.local.get(['settings','popupLanguage']).then(data=>{settingsCache=normalizeSettings(data.settings);language=resolveLanguage(data.popupLanguage,chrome.i18n.getUILanguage());});
async function stored(){await settingsReady;return settingsCache;}
async function rateState(){await settingsReady;return rateMemory.read();}
async function optionalRateState(){try{return await rateState();}catch{return null;}}
async function pausedTarget(tabId){await powerQueue;const data=await chrome.storage.session.get('pausedTargets');return data.pausedTargets?.[tabId]||null;}
function syncPower(settings){
 powerQueue=powerQueue.catch(()=>{}).then(async()=>{
  const enabled=settings.enabled,signature=JSON.stringify([enabled,settings.disabledSites,settings.siteModes]);if(powerSignature===signature)return;powerSignature=signature;
  const cached=await chrome.storage.session.get('pausedTargets'),frozen={...cached.pausedTargets};
  const tabs=new Set([...frames.keys(),...[...contentPorts].map(port=>port.sender?.tab?.id),...[...ports.values()].map(item=>item.tabId)].filter(Number.isInteger));
  if(!enabled){
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
 if(!enabled){frames.delete(tabId);announced.delete(tabId);pinned.delete(tabId);}
 if(rate===undefined)rate=await optionalRateState();
 const message={scope:SCOPE,action:'power',settings,pageUrl};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
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
  await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'highlight',options:{clear:true}}).catch(()=>{});
  if(!target)return;
  await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'highlight',options:{mediaKey:target.id,title:target.title,scrollIntoView:scroll}},optionsOf(target)).catch(()=>{});
 });
 markerQueues.set(tabId,next);return next;
}
async function announce(tabId,force=false){
 if(!(await stored()).enabled)return;
 const target=targetFor(tabId),key=target?.key||'';
 if(force||announced.get(tabId)!==key){
  announced.set(tabId,key);const rate=await optionalRateState();
  if(announced.get(tabId)!==key)return;
  const message={scope:SCOPE,action:'activeTarget',hasTarget:!!target};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
  await Promise.allSettled([...(frames.get(tabId)?.values()||[])].map(frame=>chrome.tabs.sendMessage(tabId,{...message,id:frame.documentId===target?.documentId&&frame.frameId===target?.frameId?target.id:null},optionsOf(frame))));
  if([...ports.values()].some(item=>item.tabId===tabId))highlight(tabId);
 }
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
  const target=force?null:targetFor(tabId);
  if(target){
   try{
    const result=await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'refreshTarget'},optionsOf(target));
    if(result?.ok&&Array.isArray(result.videos)&&result.videos.some(video=>video.id===target.id&&video.connected!==false)){
     record(tabId,target.frameId,target.documentId,result.videos);return;
    }
   }catch{}
  }
  return refreshFrames(tabId);
 })();
 const entry={task,force};refreshTasks.set(tabId,entry);
 try{return await task;}finally{if(refreshTasks.get(tabId)===entry)refreshTasks.delete(tabId);}
}
async function refreshFrames(tabId){
 const probes=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:version=>{
  if(/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname))return 'skip';
  const api=globalThis[Symbol.for('video-control.api')];
  try{if(api?.version===version&&api.alive())return true;}catch{}
  try{api?.dispose?.();}catch{}
  globalThis[Symbol.for('video-control.recovering')]=true;return false;
 },args:[VERSION]});
 const missing=probes.filter(frame=>frame.result===false).map(frame=>frame.frameId);
 if(missing.length){
  await chrome.scripting.executeScript({target:{tabId,frameIds:missing},world:'MAIN',files:['page-bridge.js']});
  await chrome.scripting.executeScript({target:{tabId,frameIds:missing},world:'ISOLATED',files:['content.js']});
 }
 const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:async()=>{
  if(/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname))return [];
  const api=globalThis[Symbol.for('video-control.api')];
  if(!api?.alive?.())throw Error('影片控制未能連線');
  return await api.refresh();
 }});
 if(!(await stored()).enabled)return;
 frames.set(tabId,new Map());
 for(const item of results)frames.get(tabId).set(item.frameId,{frameId:item.frameId,documentId:item.documentId,videos:Array.isArray(item.result)?item.result:[]});
 await announce(tabId,true);
}
async function currentTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('請先開啟有影片的網頁');return tab;}
async function dispatch(tabId,message,retry=true){
 const target=message.key?itemsFor(tabId).find(item=>item.key===message.key):targetFor(tabId);
 if(!target)throw Error('影片已切換，請重新選取');
 const settings=await stored();
 if(!settings.enabled)throw Error('VideoSpeed 已關閉');
 if(disabledOnUrl((await chrome.tabs.get(tabId)).url,settings.disabledSites,settings.siteModes))throw Error('此網站已停用');
 let result;
 try{result=await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'control',id:target.id,command:message.command,value:message.value},optionsOf(target));}
 catch(error){if(!retry||message.key)throw error;await refresh(tabId,true);return dispatch(tabId,message,false);}
 if(!result?.ok)throw Error(result?.error||'影片未回應，請重新整理網頁');
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
 if(message.action==='settings'){const settings=await stored(),rate=await rateState();return {settings,lastRate:rate.lastRate,rateRevision:rate.rateRevision,pageUrl:sender.tab?.url||''};}
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
 if(message.action==='getState'||message.action==='cachedState'){
  const settings=await stored(),pageUrl=tab.url||'',siteDisabled=disabledOnUrl(pageUrl,settings.disabledSites,settings.siteModes);
  if(message.action==='getState'&&settings.enabled&&!siteDisabled)try{await refresh(tabId,message.refresh===true);}catch{}
  const target=siteDisabled?null:settings.enabled?targetFor(tabId):await pausedTarget(tabId),rate=await rateState();return {tabId,pageUrl,siteDisabled,settings,lastRate:rate.lastRate,rateRevision:rate.rateRevision,videos:target?[target]:[],target};
 }
 if(message.action==='updateSettings'){
  const fields=['enabled','preferredRate','defaultMode','customRate','qualityEnabled','preferredQuality','steps','shortcuts','disabledSites','siteModes'];
  const patch=Object.fromEntries(Object.entries(message.patch||{}).filter(([key])=>fields.includes(key)));
  return {settings:await changeSettings(patch)};
 }
 if(message.action==='setEnabled')return {settings:await changeSettings({enabled:message.enabled===true})};
 if(message.action==='saveSettings')return {settings:await changeSettings(validateSettings(message.settings))};
 const settings=await stored();
 if(!settings.enabled)throw Error('VideoSpeed 已關閉');
 if(disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes))throw Error('此網站已停用');
 if(message.action==='select'){
  if(!itemsFor(tabId).some(item=>item.key===message.key))throw Error('影片已切換，請重新選取');
  pinned.set(tabId,message.key);await announce(tabId);await highlight(tabId,true);return {};
 }
 if(message.action==='pick'){await refresh(tabId,true);await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'pick',language:message.language});return {};}
 if(message.action==='cancelPick'){await chrome.tabs.sendMessage(tabId,{scope:SCOPE,action:'cancelPick'}).catch(()=>{});return {};}
 if(message.action==='command'){if(!targetFor(tabId))await refresh(tabId);return {result:await dispatch(tabId,message)};}
 throw Error('不支援的操作');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message?.scope!==SCOPE)return;
 run(message,sender).then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message||'操作失敗'}));return true;
});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name==='video-control-content'){contentPorts.add(port);port.onDisconnect.addListener(()=>contentPorts.delete(port));return;}
 if(port.name!=='video-control-popup')return;
 const item={tabId:null};ports.set(port,item);
 port.onMessage.addListener(message=>{
  if(message.action==='watch'&&Number.isInteger(message.tabId)){item.tabId=message.tabId;if(settingsCache?.enabled)highlight(item.tabId);}
  if(message.action==='renew'&&item.tabId&&settingsCache?.enabled){
   const target=targetFor(item.tabId);
   if(target)chrome.tabs.sendMessage(item.tabId,{scope:SCOPE,action:'highlight',options:{renew:true}},optionsOf(target)).then(result=>{if(!result?.highlighted)highlight(item.tabId);}).catch(()=>{});
  }
 });
 port.onDisconnect.addListener(()=>{ports.delete(port);if(item.tabId&&![...ports.values()].some(other=>other.tabId===item.tabId))highlight(item.tabId,false,true);});
});
function forgetTab(tabId){
 frames.delete(tabId);pinned.delete(tabId);announced.delete(tabId);markerQueues.delete(tabId);
 rateWriteLedger.forgetTab(tabId);
 powerQueue=powerQueue.catch(()=>{}).then(async()=>{const data=await chrome.storage.session.get('pausedTargets'),frozen={...data.pausedTargets};if(Object.hasOwn(frozen,tabId)){delete frozen[tabId];await chrome.storage.session.set({pausedTargets:frozen});}});
}
chrome.tabs.onRemoved.addListener(forgetTab);
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')forgetTab(tabId);if(change.url)applyPagePolicy(tabId,change.url).catch(()=>{});});
async function frameRoute(details){
 if(details.frameId===0||details.tabId<0)return;
 const settings=await stored();if(!settings.enabled)return;
 const tab=await chrome.tabs.get(details.tabId),blocked=disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes)||disabledOnUrl(details.url,settings.disabledSites,settings.siteModes);
 if(blocked){frames.get(details.tabId)?.delete(details.frameId);await announce(details.tabId,true);}
 const rate=await optionalRateState(),message={scope:SCOPE,action:'power',settings,pageUrl:tab.url||''};if(rate)Object.assign(message,{lastRate:rate.lastRate,rateRevision:rate.rateRevision});
 await chrome.tabs.sendMessage(details.tabId,message,details.documentId?{documentId:details.documentId}:{frameId:details.frameId}).catch(()=>{});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(details=>frameRoute(details).catch(()=>{}));
chrome.webNavigation.onReferenceFragmentUpdated.addListener(details=>frameRoute(details).catch(()=>{}));
chrome.webNavigation.onCommitted.addListener(details=>{if(details.frameId>0){frames.get(details.tabId)?.delete(details.frameId);announce(details.tabId,true).catch(()=>{});}});


chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local')rateMemory.observeChanges(changes,area).catch(()=>{});
 if(area==='local'&&changes.settings){settingsCache=normalizeSettings(changes.settings.newValue);syncPower(settingsCache).catch(()=>{});}
 if(area==='local'&&changes.popupLanguage){
  language=resolveLanguage(changes.popupLanguage.newValue,chrome.i18n.getUILanguage());
  stored().then(async settings=>{await chrome.action.setTitle({title:titleFor(settings)});const tabs=new Set([...frames.keys(),...[...contentPorts].map(port=>port.sender?.tab?.id),...[...ports.values()].map(item=>item.tabId)].filter(Number.isInteger));await Promise.allSettled([...tabs].map(async tabId=>{const tab=await chrome.tabs.get(tabId);await chrome.action.setTitle({tabId,title:titleFor(settings,disabledOnUrl(tab.url,settings.disabledSites,settings.siteModes))});}));}).catch(()=>{});
 }
});

async function restoreOpenTab(tabId){
 const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:version=>{
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
 await chrome.scripting.executeScript({target:{tabId,frameIds},world:'MAIN',files:['page-bridge.js']});
 await chrome.scripting.executeScript({target:{tabId,frameIds},world:'ISOLATED',files:['content.js']});
}
async function restoreOpenTabs(){
 // 僅在更新時被動接管既有分頁，不執行影片深查。
 await settingsReady;
 const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
 for(let index=0;index<tabs.length;index+=4)await Promise.allSettled(tabs.slice(index,index+4).map(tab=>restoreOpenTab(tab.id)));
}
chrome.runtime.onInstalled.addListener(details=>{if(details.reason==='update')restoreOpenTabs().catch(()=>{});});
settingsReady.then(()=>syncPower(settingsCache)).catch(()=>{});
