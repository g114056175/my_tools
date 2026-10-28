import {applyPreferredQuality,inspectQuality} from './quality-adapters.js';
import {syncPlayerRate} from './player-rate.js';
import {isMediaPreview,mediaSignature,mediaCanInitialize} from './media-registry.js';
import {RateBridge} from './rate-bridge.js';
const marker=Symbol.for('video-control.page-bridge-v3');
const version='0.6.20',previous=globalThis[marker];
if(previous?.version!==version){
 try{if(previous?.dispose)previous.dispose();else previous?.stop?.();}catch{}
 let active=false,exploring=true,waiting=false,qualityEnabled=false,abort,restore=[],generation=0,rateBridge=null,bridgeOwner=null,refreshBindings=()=>{},bindTimer=null;
 const youtubePlayers=new Map(),retryTimers=new Map(),retryCounts=new WeakMap();
 const setAttributeIfChanged=(element,name,value)=>{value=String(value);if(element.getAttribute(name)===value)return false;element.setAttribute(name,value);return true;};
 const removeAttributeIfPresent=(element,name)=>{if(element.getAttribute(name)===null)return false;element.removeAttribute(name);return true;};
  const bindYouTubeTitle=video=>{
    if(isMediaPreview(video)||!exploring&&!video.getAttribute('data-video-control-id'))return;
    try{
      const player=video.closest('#movie_player,.html5-video-player');
      let data;try{data=player?.getVideoData?.();}catch{}
      let id=data?.video_id;try{id=id||player?.getPlayerResponse?.()?.videoDetails?.videoId;}catch{}
      const url=new URL(location.href);
      const routeId=/(^|\.)youtube\.com$/i.test(url.hostname)?url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]:null;
      if(routeId&&player){
        const ad=player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting'),ready=!ad&&id===routeId,key='yt:'+routeId;
        const changed=video.getAttribute('data-video-control-ready')!==String(ready)||video.getAttribute('data-video-control-ready-key')!==key||video.getAttribute('data-video-control-ad')!==String(ad);
        setAttributeIfChanged(video,'data-video-control-ready',String(ready));setAttributeIfChanged(video,'data-video-control-ready-key',key);setAttributeIfChanged(video,'data-video-control-ad',String(ad));
        if(!youtubePlayers.has(player)){
          const observer=new MutationObserver(()=>{const item=youtubePlayers.get(player);if(!item)return;const next=player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting');if(next!==item.ad){item.ad=next;const current=exploring?player.querySelector('video.html5-main-video')||item.video:item.video;retryCounts.delete(current);bindYouTubeTitle(current);}});
          observer.observe(player,{attributes:true,attributeFilter:['class']});youtubePlayers.set(player,{observer,ad,video});
        }
        else youtubePlayers.get(player).video=video;
        clearTimeout(retryTimers.get(video));retryTimers.delete(video);
        if((exploring||waiting)&&!ready&&!ad){const attempt=retryCounts.get(video)||0;if(attempt<6){retryCounts.set(video,attempt+1);const token=generation;retryTimers.set(video,setTimeout(()=>{retryTimers.delete(video);if(active&&generation===token&&video.isConnected)bindYouTubeTitle(video);},[80,160,320,640,1000,1500][attempt]));}}
        else retryCounts.delete(video);
        if(changed)video.dispatchEvent(new Event('video-control:media-ready-v1',{bubbles:true,composed:true}));
      }
      if(routeId&&id!==routeId){removeAttributeIfPresent(video,'data-video-control-title');removeAttributeIfPresent(video,'data-video-control-title-id');removeAttributeIfPresent(video,'data-video-control-content-id');return;}
      if(typeof id==='string'&&/^[\w-]{1,64}$/.test(id)){
        const identity='yt:'+id;
        if(video.getAttribute('data-video-control-content-id')!==identity)removeAttributeIfPresent(video,'data-video-control-title');
        setAttributeIfChanged(video,'data-video-control-content-id',identity);
        if(typeof data?.title==='string'&&data.title.trim()){setAttributeIfChanged(video,'data-video-control-title',data.title.trim().slice(0,200));setAttributeIfChanged(video,'data-video-control-title-id',identity);}
        else {removeAttributeIfPresent(video,'data-video-control-title');removeAttributeIfPresent(video,'data-video-control-title-id');}
      } else {removeAttributeIfPresent(video,'data-video-control-title');removeAttributeIfPresent(video,'data-video-control-title-id');removeAttributeIfPresent(video,'data-video-control-content-id');}
    }catch{}
  };

 const stop=({preserveDefaults=false}={})=>{
  rateBridge?.stop({preserveDefaults});if(!preserveDefaults)rateBridge=null;
  active=false;generation++;clearTimeout(bindTimer);bindTimer=null;abort?.abort();abort=null;refreshBindings=()=>{};
  for(const item of youtubePlayers.values())item.observer.disconnect();youtubePlayers.clear();for(const timer of retryTimers.values())clearTimeout(timer);retryTimers.clear();
  for(const undo of restore.reverse())undo();restore=[];
 };
 const start=()=>{
  if(active)return;active=true;generation++;abort=new AbortController();
  const listen=(target,type,handler)=>target.addEventListener(type,handler,{capture:true,signal:abort.signal});
  rateBridge??=new RateBridge(globalThis,{syncPlayerRate});
  rateBridge.start((video,info)=>{
   if(active&&video.getAttribute('data-video-control-id'))video.dispatchEvent(new CustomEvent('video-control:rate-observation-v1',{detail:JSON.stringify({owner:bridgeOwner,videoId:video.getAttribute('data-video-control-id'),info}),bubbles:true,composed:true}));
  });
  const bindAll=()=>{
   for(const [player,item]of youtubePlayers)if(!player.isConnected||isMediaPreview(item.video)||!exploring&&!item.video.getAttribute('data-video-control-id')){item.observer.disconnect();youtubePlayers.delete(player);}
   if(exploring)document.querySelectorAll('video').forEach(bindYouTubeTitle);
   else for(const item of youtubePlayers.values())bindYouTubeTitle(item.video);
  };
  refreshBindings=bindAll;
  const scheduleBind=()=>{if(bindTimer!==null)return;const token=generation;bindTimer=setTimeout(()=>{bindTimer=null;if(active&&generation===token)bindAll();},0);};
  for(const name of ['loadedmetadata','playing','durationchange'])listen(document,name,event=>{const video=event.composedPath().find(node=>node?.tagName==='VIDEO');if(video){retryCounts.delete(video);bindYouTubeTitle(video);}});
  listen(document,'video-control:media-bind-v1',event=>{const video=event.composedPath().find(node=>node?.tagName==='VIDEO');if(video?.getAttribute('data-video-control-id'))bindYouTubeTitle(video);});
  listen(window,'video-control:route',scheduleBind);listen(window,'yt-navigate-finish',scheduleBind);
  listen(document,'video-control:quality-request-v3',async event=>{
   let data;try{data=JSON.parse(event.detail);}catch{return;}
   if(!data||data.owner!==bridgeOwner||typeof data.requestId!=='string'||data.requestId.length>100||!Number.isFinite(data.preferred)||(data.preferred!==0&&data.preferred<144)||data.preferred>8640||(!data.inspect&&!qualityEnabled))return;
   const video=event.composedPath().find(node=>node?.tagName==='VIDEO');
   if(!video||isMediaPreview(video)||video.getAttribute('data-video-control-id')!==data.videoId)return;
   const token=generation;
   const isCurrent=()=>active&&token===generation&&qualityEnabled&&video.getAttribute('data-video-control-id')===data.videoId&&video.getAttribute('data-video-control-quality-request')===data.requestId&&mediaSignature(video)===data.mediaKey&&mediaCanInitialize(video);
   const value=data.inspect?inspectQuality(video,globalThis):await applyPreferredQuality(video,data.preferred,globalThis,{isCurrent});
   if(!active||token!==generation)return;
   const result={status:value.status,adapter:value.adapter,requestedHeight:value.requestedHeight,selectedHeight:value.selectedHeight,availableHeights:value.availableHeights?.slice(0,32)||[]};
   video.dispatchEvent(new CustomEvent('video-control:quality-result-v3',{detail:JSON.stringify({owner:bridgeOwner,requestId:data.requestId,videoId:data.videoId,result}),bubbles:true,composed:true}));
  });
  const rateOperation=event=>{
   let data;try{data=JSON.parse(event.detail);}catch{return;}
   if(!data||data.owner!==bridgeOwner||typeof data.requestId!=='string'||data.requestId.length>100||!['read','apply','adopt','release','diagnostics'].includes(data.op))return;
   if(['apply','adopt'].includes(data.op)&&(!Number.isFinite(data.rate)||data.rate<0.0625||data.rate>16))return;
   const video=event.composedPath().find(node=>node?.tagName==='VIDEO');
   if(!video||video.getAttribute('data-video-control-id')!==data.videoId||data.op!=='release'&&isMediaPreview(video))return;
   const result=data.op==='diagnostics'?{events:rateBridge.diagnostics(video)}:rateBridge.execute(video,data);
   video.dispatchEvent(new CustomEvent('video-control:rate-result-v3',{detail:JSON.stringify({owner:bridgeOwner,requestId:data.requestId,videoId:data.videoId,result}),bubbles:true,composed:true}));
  };
  listen(document,'video-control:rate-request-v2',rateOperation);listen(document,'video-control:rate-operation-v1',rateOperation);
  for(const name of ['pushState','replaceState']){
   const original=history[name],wrapped=function(...args){const previousHref=location.href,result=Reflect.apply(original,this,args);if(active&&location.href!==previousHref)window.dispatchEvent(new Event('video-control:route'));return result;};
   history[name]=wrapped;restore.push(()=>{if(history[name]===wrapped)history[name]=original;});
  }
  const original=Element.prototype.attachShadow,wrapped=function(...args){
   const root=Reflect.apply(original,this,args);
   if(active&&(exploring||waiting)&&args[0]?.mode==='open')queueMicrotask(()=>{if(active&&(exploring||waiting))this.dispatchEvent(new Event('video-control:shadow',{bubbles:true,composed:true}));});return root;
  };
  Element.prototype.attachShadow=wrapped;restore.push(()=>{if(Element.prototype.attachShadow===wrapped)Element.prototype.attachShadow=original;});
  bindAll();
 };
 const configure=event=>{
  let state;try{state=JSON.parse(event.detail);}catch{return;}
  if(state?.force===true&&state.enabled===false){stop();bridgeOwner=null;return;}
  const owner=typeof state?.owner==='string'&&state.owner.length>0&&state.owner.length<=128?state.owner:null;
  if(state?.release===true){if(owner&&owner===bridgeOwner)stop();return;}
  if(!owner&&bridgeOwner)return;
  if(owner&&owner!==bridgeOwner){stop();bridgeOwner=owner;}
  const changed=exploring!==(state?.exploring!==false);exploring=state?.exploring!==false;
  waiting=state?.waiting===true;
  if(!exploring&&!waiting){for(const timer of retryTimers.values())clearTimeout(timer);retryTimers.clear();}
  qualityEnabled=state?.qualityEnabled===true;if(state?.enabled===true){if(active&&changed)refreshBindings();else start();}else stop({preserveDefaults:state?.suspended===true});
  document.dispatchEvent(new CustomEvent('video-control:bridge-ready-v1',{detail:JSON.stringify({owner:bridgeOwner,version,enabled:active})}));
 };
 document.addEventListener('video-control:bridge-state-v4',configure,true);
 const api={version,active:()=>active,owner:()=>bridgeOwner,stop,dispose(){stop();document.removeEventListener('video-control:bridge-state-v4',configure,true);if(globalThis[marker]===api)delete globalThis[marker];}};
 globalThis[marker]=api;
}
