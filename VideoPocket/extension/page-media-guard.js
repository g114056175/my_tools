export const lostPageMedia=()=>Object.assign(new Error('原影片已移除或變更，下載已停止'),{code:'PAGE_MEDIA_GONE'});

// Serialized into the exact originating document. Only an active transfer
// which requires page credentials uses this check; independent CDN downloads
// do not require the DOM player to remain on screen.
export async function pageMediaLease(target={}){
 if(target.mediaKey==null)return {valid:true,unbound:true};
 const ids=globalThis[Symbol.for('video-pocket.identities')],observer=globalThis[Symbol.for('video-pocket.mediaObserver')],evidence=globalThis[Symbol.for('video-pocket.sourceEvidence')];
 const started=Date.now(),deadline=started+Math.min(2000,Math.max(0,Number(target.timeoutMs) || 0));
 const present=video=>video?.isConnected!==false&&(!video.ownerDocument||video.ownerDocument===document)&&(observer?.isPresent||evidence?.isMediaPresent)?.(video)!==false;
 const identity=video=>{try{return String(evidence?.collectMediaEvidence?.({video,root:document,pageUrl:location.href})?.identity?.id || '');}catch{return '';}};
 const source=video=>String(video.currentSrc || video.src || video.querySelector?.('source')?.src || '');
 while(true){
  const registry=globalThis[Symbol.for('video-pocket.selection')],found=[...(registry?.videos||[]),...(observer?.videosSnapshot?.(256)||[]),...document.querySelectorAll('video')];
  if(!found.some(video=>present(video)&&String(ids?.keys?.get(video)??'')===String(target.mediaKey))&&typeof document.createTreeWalker==='function'){
   const roots=[document];let scanned=0;
   for(let i=0;i<roots.length&&i<16&&scanned<4096;i++){
    const root=roots[i];if(i)found.push(...root.querySelectorAll('video'));
    const walker=document.createTreeWalker(root,1);let node;
    while(scanned++<4096&&(node=walker.nextNode()))if(node.shadowRoot&&roots.length<16)roots.push(node.shadowRoot);
   }
  }
  const videos=[...new Set(found)].filter(present).slice(0,256);
  const exact=videos.filter(video=>String(ids?.keys?.get(video)??'')===String(target.mediaKey));
  if(exact.length===1){
   const video=exact[0],id=identity(video),src=source(video);
   if(target.contentId&&id&&id!==String(target.contentId))return {valid:false,changed:true};
   if(src&&(!target.playerUrl||src===target.playerUrl||target.contentId&&id===String(target.contentId)))return {valid:true};
   if(src&&target.playerUrl&&src!==target.playerUrl)return {valid:false,changed:true};
  }else if(exact.length>1)return {valid:false,changed:true};
  else if(target.contentId){
   // A framework may replace the node for the same explicit media identity.
   // Never use duration, proximity, title, or an unrelated available player.
   const matches=videos.slice(0,16).filter(video=>source(video)&&identity(video)===String(target.contentId));
   if(matches.length===1)return {valid:true};
  }
  if(Date.now()>=deadline)return {valid:false,missing:true};
  await new Promise(resolve=>setTimeout(resolve,Math.min(100,deadline-Date.now())));
 }
}

export function createPageMediaGuard({check,intervalMs=1000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 const cache=new Map(),pending=new Map();
 const keyOf=context=>JSON.stringify([context.tabId,context.documentId,String(context.mediaKey),context.contentId||'',context.playerUrl||'']);
 const bound=context=>Number.isInteger(context?.tabId)&&typeof context.documentId==='string'&&context.mediaKey!=null;
 const validate=async(context,force=false)=>{
  if(!bound(context))return;
  const key=keyOf(context),old=cache.get(key);
  if(!force&&old&&now()-old.time<intervalMs)return;
  let task=pending.get(key);
  if(!task){
   task=Promise.resolve().then(()=>check(context)).then(result=>{
    if(result?.valid!==true)throw lostPageMedia();
    cache.set(key,{time:now(),tabId:context.tabId});while(cache.size>64)cache.delete(cache.keys().next().value);
   }).finally(()=>{if(pending.get(key)===task)pending.delete(key);});pending.set(key,task);
  }
  return task;
 };
 const run=async(context,operation,cancel=async()=>{})=>{
  if(!bound(context))return operation();
  await validate(context);
  let stopped=false,timer=null,rejectWatch;
  const watch=new Promise((_,reject)=>{rejectWatch=reject;});
  const poll=async()=>{
   if(stopped)return;
   try{await validate(context);}catch(error){if(!stopped){stopped=true;void Promise.resolve().then(cancel).catch(()=>{});rejectWatch(error);}return;}
   if(!stopped)timer=setTimer(()=>void poll(),intervalMs);
  };
  timer=setTimer(()=>void poll(),intervalMs);
  try{return await Promise.race([Promise.resolve().then(operation).catch(async error=>{if(!stopped)await validate(context,true);throw error;}),watch]);}
  finally{stopped=true;if(timer!==null)clearTimer(timer);}
 };
 return {run,clearTab(tabId){for(const [key,value] of cache)if(value.tabId===tabId)cache.delete(key);}};
}
