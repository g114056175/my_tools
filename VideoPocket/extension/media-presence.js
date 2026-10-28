// Presence is independent of source availability. Paused/offscreen players
// remain valid; only retired DOM owners and hidden hover previews are removed.
export function isMediaPresent(video,target=globalThis){
 if(!video||video.isConnected===false)return false;
 if(video.ownerDocument&&target.document&&video.ownerDocument!==target.document)return false;
 let preview;
 try{
  const host=target.location?.hostname || new URL(target.location?.href||'').hostname;
  if(!/(^|\.)youtube\.com$/i.test(host))return true;
  preview=video.closest?.('ytd-video-preview,ytd-video-preview-renderer,ytm-video-preview,#video-preview,#inline-preview-player,.ytp-inline-preview-ui');
 }catch{return true;}
 if(!preview)return true;
 try{
  if(typeof video.checkVisibility==='function'&&!video.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
  const rect=video.getBoundingClientRect?.();if(rect&&(!(rect.width>0)||!(rect.height>0)))return false;
  for(let node=video,depth=0;node&&depth++<32;node=node.parentElement||node.getRootNode?.()?.host){
   const style=target.getComputedStyle?.(node);
   if(style&&(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.contentVisibility==='hidden'||Number(style.opacity)===0))return false;
  }
 }catch{}
 return true;
}

// Serialized by Chrome. Check existing player keys only; never fetch, parse
// metadata, or start discovery while keeping an already open menu current.
export function pageMediaPresence(keys=[]){
 const ids=globalThis[Symbol.for('video-pocket.identities')],observer=globalThis[Symbol.for('video-pocket.mediaObserver')],registry=globalThis[Symbol.for('video-pocket.selection')];
 if(!ids?.keys)return {checked:false};
 const requested=new Set(keys.map(String)),videos=new Set([...(registry?.videos||[]),...(observer?.videosSnapshot?.(256)||[]),...Array.from(document.querySelectorAll('video')).slice(0,256)]),present=[];
 const check=observer?.isPresent || globalThis[Symbol.for('video-pocket.sourceEvidence')]?.isMediaPresent;
 for(const video of videos){
  const key=String(ids.keys.get(video)??'');if(!requested.has(key))continue;
  if(video.isConnected===false||video.ownerDocument&&video.ownerDocument!==document)continue;
  try{if(check&&check(video)===false)continue;}catch{}
  present.push(key);
 }
 return {checked:true,present:[...new Set(present)]};
}
