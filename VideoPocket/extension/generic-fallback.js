// Independent player routes. Keep platform detection here separate from
// the vocabulary and model stores used by the existing discovery pipeline.
const protectedDomains=['youtube.com','youtu.be','youtube-nocookie.com','bilibili.com','b23.tv','x.com','twitter.com','facebook.com','fb.watch','instagram.com','threads.net','threads.com','tiktok.com','twitch.tv','reddit.com','redd.it','dailymotion.com','dai.ly','vimeo.com','anime1.me','gamer.com.tw'];
const protectedSites=new Set(['youtube','bilibili','facebook','instagram','threads','tiktok','twitch','twitch-clip','reddit','x','twitter','dailymotion','vimeo','anime1']);
export function genericPageUrl(raw){
 try{
  const page=new URL(raw);
  if(!/^https?:$/.test(page.protocol)||page.username||page.password)return false;
  return !protectedDomains.some(domain=>page.hostname===domain||page.hostname.endsWith('.'+domain));
 }catch{return false;}
}
export function genericFallbackEligible(descriptor={}){
 if(descriptor.drm||protectedSites.has(descriptor.platform?.site))return false;
 if(!Number.isInteger(descriptor.tabId)||descriptor.tabId<0||!Number.isInteger(descriptor.frameId)||descriptor.frameId<0||typeof descriptor.documentId!=='string'||!descriptor.documentId||descriptor.mediaKey==null)return false;
 return genericPageUrl(descriptor.referer);
}

// Only URLs obtained from the selected player's own metadata may be delegated.
// Never search neighbouring iframes or follow arbitrary page redirects.
export function genericEmbedPlatform(raw){
 let u;try{u=new URL(raw);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password)return null;
 const host=u.hostname.toLowerCase(),clip=/^[A-Za-z0-9_-]{3,180}$/;
 if(host==='clips.twitch.tv'){
  const slug=u.pathname==='/embed'?u.searchParams.get('clip'):u.pathname.match(/^\/([^/]+)\/?$/)?.[1];
  return clip.test(slug || '')&&slug!=='embed'?{site:'twitch-clip',slug}:null;
 }
 if(host==='player.twitch.tv'){
  const id=(u.searchParams.get('video') || '').replace(/^v/,'');
  return /^\d{1,24}$/.test(id)?{site:'twitch',id}:null;
 }
 if(host==='www.twitch.tv'||host==='twitch.tv'){
  const slug=u.pathname.match(/^\/[^/]+\/clip\/([^/]+)\/?$/)?.[1],id=u.pathname.match(/^\/videos\/(\d{1,24})\/?$/)?.[1];
  if(slug&&clip.test(slug))return {site:'twitch-clip',slug};
  if(id)return {site:'twitch',id};
 }
 if(host==='www.dailymotion.com'||host==='dailymotion.com'||host==='geo.dailymotion.com'){
  const id=u.pathname.match(/^\/(?:embed\/)?video\/([A-Za-z0-9_-]{3,128})(?:\/|$)/)?.[1] || (host==='geo.dailymotion.com'?u.searchParams.get('video'):null);
  if(/^[A-Za-z0-9_-]{3,128}$/.test(id || ''))return {site:'dailymotion',id};
 }
 return null;
}

const cancelled=()=>Object.assign(new Error('已取消'),{code:'CANCELLED',userCancelled:true});
const changed=()=>Object.assign(new Error('影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});

// Only one explicitly owned source can bypass the broad document scan.
// Video.js and multi-version probing keep their existing order.
export function earlyPlayerPlatform(descriptor,proposal,hash){
 if(!genericFallbackEligible(descriptor)||descriptor.platform||descriptor.linkedMedia||!proposal?.valid||!['jwplayer','json-ld'].includes(proposal.parser))return null;
 const binding=proposal.binding,candidates=proposal.candidates;
 if(!binding||binding.mediaKey!==descriptor.mediaKey||binding.pageUrl!==descriptor.referer||!/^blob:/i.test(binding.source||'')||!binding.fingerprint||!Number.isFinite(proposal.duration)||proposal.duration<=0||!Array.isArray(candidates)||candidates.length!==1)return null;
 const item=candidates[0];if(!['hls','dash','progressive'].includes(item.kind))return null;
 try{const u=new URL(item.url);if(!/^https?:$/.test(u.protocol)||u.username||u.password)return null;}catch{return null;}
 const base={tabId:descriptor.tabId,frameId:descriptor.frameId,documentId:descriptor.documentId,mediaKey:descriptor.mediaKey,referer:descriptor.referer};
 const group={kind:'player',id:hash(binding.fingerprint),scope:{tabId:base.tabId,frameId:base.frameId,documentId:base.documentId}};
 return {site:'network-media',binding:'generic-early',expectedDuration:proposal.duration,versions:[{...item,candidateGroup:group}],...(typeof proposal.metadata?.title==='string'?{title:proposal.metadata.title}:{}),earlyPlan:{descriptor:base,binding,parser:proposal.parser,mode:'early'}};
}

export function createGenericFallback({primary,collect,validate,forget,cancelPrimary,classify,hash,timeoutMs=10000}){
 const active=new Map(),cancelledIds=new Set();
 const cancel=id=>{
  if(typeof id!=='string')return;
  const controller=active.get(id);
  if(controller)controller.abort(cancelled());
  else {cancelledIds.add(id);while(cancelledIds.size>50)cancelledIds.delete(cancelledIds.values().next().value);}
 };
 const inspect=async(descriptor,inspectionId,{skipFallback=false}={})=>{
  let originalError;
  const prepared=descriptor.platform?.binding==='generic-early'?descriptor.platform.earlyPlan:null;
  const owner=prepared?.descriptor || descriptor;
  if(prepared){
   if(['tabId','frameId','documentId','mediaKey','referer'].some(key=>owner[key]!==descriptor[key]))throw changed();
   const proposal={valid:true,parser:prepared.parser,binding:prepared.binding,duration:descriptor.platform.expectedDuration,candidates:descriptor.platform.versions};
   if(!earlyPlayerPlatform(owner,proposal,hash))throw changed();
   originalError=Object.assign(new Error('尚未取得此影片來源'),{code:'SOURCE_UNAVAILABLE'});
  }else{
  // Success returns the exact result object. It does not collect, probe,
  // validate, mutate or spend any budget in the new route.
  try{return {result:await primary(descriptor,inspectionId),descriptor};}
  catch(error){
   if(skipFallback||classify(error).code!=='SOURCE_UNAVAILABLE'||Number(error.status||error.httpStatus)>=400||!genericFallbackEligible(descriptor)){cancelledIds.delete(inspectionId);throw error;}
   originalError=error;
  }
  }
  if(cancelledIds.delete(inspectionId))throw cancelled();
  const controller=new AbortController(),signal=controller.signal;
  active.set(inspectionId,controller);
  let recovered,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort(new DOMException('探索逾時','TimeoutError'));},timeoutMs);
  const abort=()=>{void Promise.resolve().then(()=>cancelPrimary(inspectionId)).catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  const bounded=promise=>new Promise((resolve,reject)=>{
   if(signal.aborted){reject(signal.reason);return;}
   const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});
   Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
  try{
   const proposal=prepared?{binding:prepared.binding,candidates:descriptor.platform.versions,duration:descriptor.platform.expectedDuration}:await bounded(collect(descriptor,signal));signal.throwIfAborted();
   if(!proposal?.binding||!Array.isArray(proposal.candidates)||!proposal.candidates.length)throw originalError;
   if(!await bounded(validate(owner,proposal.binding,signal,prepared?.mode)))throw changed();
   signal.throwIfAborted();
   const direct=proposal.candidates.filter(item=>item.url&&['hls','dash','progressive'].includes(item.kind)).slice(0,6);
   const embedded=proposal.candidates.filter(item=>item.embedUrl).map(item=>genericEmbedPlatform(item.embedUrl)).filter(Boolean);
   let platform;
   if(direct.length&&Number.isFinite(proposal.duration)&&proposal.duration>0){
    const group={kind:'player',id:hash(proposal.binding.fingerprint),scope:{tabId:descriptor.tabId,frameId:descriptor.frameId,documentId:descriptor.documentId}};
    platform={site:'network-media',expectedDuration:proposal.duration,versions:direct.map(item=>({...item,candidateGroup:group}))};
   }else if(embedded.length===1)platform=embedded[0];
   if(!platform)throw originalError;
   const candidate={...descriptor,url:undefined,sourceType:undefined,linkedMedia:undefined,platform};
   const pending=primary(candidate,inspectionId);
   void Promise.resolve(pending).then(value=>{if(signal.aborted&&value?.id)return forget(value.id);}).catch(()=>{});
   recovered=await bounded(pending);signal.throwIfAborted();
   if(!await bounded(validate(owner,proposal.binding,signal,prepared?.mode)))throw changed();
   signal.throwIfAborted();
   return {result:recovered,descriptor:candidate,genericPlan:{descriptor:owner,binding:proposal.binding,...(prepared?{mode:prepared.mode}:{})}};
  }catch(error){
   if(recovered?.id)await forget(recovered.id).catch(()=>{});
   if(signal.aborted&&!timedOut)throw signal.reason;
   if(timedOut&&prepared)throw Object.assign(new Error('來源讀取逾時'),{code:'NETWORK_TIMEOUT'});
   if(['SOURCE_CHANGED','CANCELLED','DRM_UNSUPPORTED','HTTP_AUTH','HTTP_RATE_LIMIT'].includes(classify(error).code))throw error;
   throw originalError;
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',abort);active.delete(inspectionId);cancelledIds.delete(inspectionId);
  }
 };
 return {inspect,cancel};
}
