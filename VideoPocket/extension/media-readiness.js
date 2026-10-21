export async function waitForMediaSource(target={}){
  const started=Date.now(),end=started+Math.min(3000,Math.max(0,Number(target.timeoutMs)||3000)),settled=started+Math.min(1000,Math.max(0,Number(target.settleMs)||0)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const identityOf=video=>{try{return globalThis[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video,root:document,pageUrl:location.href})?.identity || {};}catch{return {};}};
  let lastScan=-Infinity;
  const sourceReady=video=>{try{const observer=globalThis[Symbol.for('video-pocket.mediaObserver')];if(Date.now()-lastScan>=500){lastScan=Date.now();observer?.scanDocument?.();}const model=observer?.modelFor?.(video),sources=observer?.sourcesFor?.(video);return !!model||!!sources?.candidates?.some(candidate=>candidate.downloadable!==false&&candidate.url);}catch{return false;}};
  const identities=globalThis[Symbol.for('video-pocket.identities')],videos=()=>[...document.querySelectorAll('video')];
  while(true){
    const list=videos(),key=target.mediaKey==null?'':String(target.mediaKey),content=String(target.contentId||''),sameKey=list.filter(video=>String(identities?.keys?.get?.(video)??'')===key),sameContent=content?list.filter(video=>String(identityOf(video).id||'')===content):[];
    let candidates=sameKey;
    if(!candidates.length&&content&&sameContent.length===1)candidates=sameContent;
    if(content&&sameKey.some(video=>{const id=String(identityOf(video).id||'');return id&&id!==content})&&!sameContent.length)return {ready:false,changed:true};
    if(candidates.length>1&&content)candidates=candidates.filter(video=>String(identityOf(video).id||'')===content);
    if(candidates.length===1){const video=candidates[0],id=String(identityOf(video).id||'');if(content&&id&&id!==content)return {ready:false,changed:true};if(Date.now()>=settled&&sourceReady(video))return {ready:true,changed:false,mediaKey:identities?.keys?.get?.(video),contentId:id||content};}
    if(Date.now()>=end)return {ready:false,changed:false};
    await sleep(Math.min(150,Math.max(1,end-Date.now())));
  }
}
