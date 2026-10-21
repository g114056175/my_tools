// Self-contained: Chrome serializes this function into the selected document.
export async function mediaTime(target={}){
 const fail=(message,code='SOURCE_CHANGED')=>Object.assign(new Error(message),{code});
 const identities=globalThis[Symbol.for('video-pocket.identities')];
 const roots=[document],videos=[];
 for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll('*')){if(el.tagName==='VIDEO')videos.push(el);if(el.shadowRoot)roots.push(el.shadowRoot);}
 const matches=videos.filter(v=>String(identities?.keys?.get(v)??'')===String(target.mediaKey??''));
 if(target.mediaKey==null||matches.length!==1)throw fail('影片已變更，請重新整理');
 const video=matches[0];
 const verify=()=>{
  if(video.isConnected===false)throw fail('影片已變更，請重新整理');
  let id='';try{id=String(globalThis[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video,root:document,pageUrl:location.href})?.identity?.id||'');}catch{}
  if(target.contentId&&id&&id!==String(target.contentId))throw fail('影片已變更，請重新整理');
  const src=video.currentSrc||video.src||'';
  if(!id&&target.sourceUrl&&src!==target.sourceUrl)throw fail('影片已變更，請重新整理');
 };
 verify();
 const duration=Number(video.duration);
 if(!Number.isFinite(duration)||duration<=0)throw fail('尚未取得影片長度','RANGE_UNSUPPORTED');
 if(target.time!==undefined){
  if(!Number.isFinite(target.time)||target.time<0||target.time>duration)throw fail('區間時間無效','RANGE_INVALID');
  if(Math.abs(video.currentTime-target.time)>.025)await new Promise((resolve,reject)=>{
   let timer;const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();};
   video.addEventListener('seeked',done,{once:true});timer=setTimeout(done,1500);
   try{video.currentTime=target.time;}catch(error){clearTimeout(timer);video.removeEventListener('seeked',done);reject(error);}
  });
 }
 verify();return {time:Number(video.currentTime),duration};
}
