import {parseSubtitles} from './subtitles.js';

// Only the recovery path controls captions. Keep both the direct read and all
// other platforms unchanged; serialize recovery because caption state is per tab.
export function createYoutubeCaptionReader({read,command,request,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),waitMs=4000}){
 const queues=new Map();
 const codedError=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
 return async function capture(input){
  let failure;
  try{return await read(input);}catch(error){failure=error;}
  const selector=input.selector || {};
  if(selector.pageSource!=='youtube-page'||!['YT_FILE_EMPTY','YT_FILE_HTTP','YT_FILE_NETWORK','YT_TIMEOUT','YT_SOURCE_UNAVAILABLE','YT_FILE_INVALID'].includes(failure?.code)||failure.status===429||failure.status>=500)throw failure;
  const key=Number(input.tabId),previous=queues.get(key) || Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   const token=crypto.randomUUID(),since=now();let attempted=false,started=false,value,errorToThrow,restoreWarning=false,suppressWarning=false,emptyResponse=false;
   try{
    attempted=true;
    let result;
    try{result=await command(input,{action:'start',token,language:input.language,automatic:!!input.automatic,selector});}
    catch(error){if(error?.code==='SOURCE_CHANGED')throw error;throw codedError('YT_RECOVERY_UNAVAILABLE','YouTube 字幕補救無法啟動');}
    if(result?.changed)throw codedError('SOURCE_CHANGED','影片已變更，請更新影片資訊');
    if(!result?.started)throw codedError('YT_RECOVERY_UNAVAILABLE','YouTube 字幕補救無法啟動');
    started=true;
    const fromRaw=raw=>{
     if(typeof raw!=='string')throw codedError('YT_FILE_INVALID','YouTube 字幕回應格式錯誤');
     const text=raw.replace(/^\uFEFF/,'').trimStart();
     if(!text){emptyResponse=true;return null;}
     let recognized=false;
     if(text.startsWith('{')){
      try{const parsed=JSON.parse(text);recognized=Array.isArray(parsed?.events)||Array.isArray(parsed?.body)||Array.isArray(parsed?.data?.body);}catch(error){throw codedError('YT_FILE_INVALID','YouTube 字幕回應格式錯誤',{cause:error});}
     }else recognized=/^<(?:\?xml\b|transcript\b|timedtext\b|tt\b|text\b|p\b)/i.test(text)||/^WEBVTT(?:\s|$)/i.test(text)||/(?:^|\n)\s*(?:\d+:)?\d{2}:\d{2}[.,]\d{3}\s+-->/m.test(text);
     if(!recognized)throw codedError('YT_FILE_INVALID','YouTube 字幕回應格式錯誤');
     let cues;try{cues=parseSubtitles(raw);}catch(error){throw codedError('YT_FILE_INVALID','YouTube 字幕回應格式錯誤',{cause:error});}
     if(!cues.length)emptyResponse=true;
     return cues.length?{cues,language:input.language,automatic:!!input.automatic,source:'播放器字幕檔'}:null;
    };
    const acceptState=state=>{
     if(state?.changed)throw codedError('SOURCE_CHANGED','影片已變更，請更新影片資訊');
     if(state?.cancelled){if(state.manual)throw codedError('CANCELLED','已取消',{userCancelled:true});throw codedError('YT_RECOVERY_UNAVAILABLE','YouTube 字幕補救已中止');}
     if(state?.failure?.code==='YT_FILE_HTTP'){
      const status=Number(state.failure.status);throw codedError('YT_FILE_HTTP','YouTube 字幕 HTTP 失敗',Number.isInteger(status)&&status>=100&&status<=599?{status}:{});
     }
     if(state?.failure?.code==='YT_FILE_NETWORK')throw codedError('YT_FILE_NETWORK','YouTube 字幕連線失敗');
     if(state?.failure?.code==='YT_TIMEOUT')throw codedError('YT_TIMEOUT','YouTube 字幕讀取逾時');
     if(state?.failure?.code==='YT_FILE_INVALID')throw codedError('YT_FILE_INVALID','YouTube 字幕回應格式錯誤');
     if(state?.hasResponse===true||Object.hasOwn(state||{},'raw'))return fromRaw(state.raw);
     return null;
    };
    const deadline=now()+waitMs;let freshUrl;
    while(now()<deadline){
     const state=await command(input,{action:'poll',token});
     const captured=acceptState(state);if(captured){value=captured;break;}
     freshUrl ||= await request(input,since);
     // Allow the native response to finish before considering a replay.
     await sleep(100);
    }
    if(!value){
     const state=await command(input,{action:'poll',token});
     value=acceptState(state);
    }
    if(!value&&freshUrl){const replay=await read({...input,selector:{...selector,captionUrl:freshUrl}});if(replay?.cues?.length)value=replay;else throw codedError('YT_FILE_EMPTY','YouTube 字幕回傳空內容');}
    if(!value)throw codedError(emptyResponse?'YT_FILE_EMPTY':'YT_TIMEOUT',emptyResponse?'YouTube 字幕回傳空內容':'YouTube 字幕讀取逾時');
   }catch(error){
    if(error?.code==='SOURCE_CHANGED'){suppressWarning=true;errorToThrow=error;}
    else if(error?.code==='CANCELLED'||error?.userCancelled){suppressWarning=true;errorToThrow=error;}
    else if(!started){errorToThrow=error?.code==='SOURCE_CHANGED'?error:codedError('YT_RECOVERY_UNAVAILABLE','YouTube 字幕補救無法啟動');}
    else errorToThrow=error;
   }finally{
    if(attempted){
     let finished;
     try{finished=await command(input,{action:'finish',token});}catch{finished=null;}
     if(value&&started&&!suppressWarning&&!finished?.cancelled&&!finished?.changed&&finished?.restored!==true)restoreWarning=true;
    }
   }
   if(errorToThrow)throw errorToThrow;
   return restoreWarning?{...value,warningCode:'YT_RESTORE_UNCONFIRMED'}:value;
  });
  queues.set(key,task);
  try{return await task;}finally{if(queues.get(key)===task)queues.delete(key);}
 };
}

// Serialized into the selected document's MAIN world. No imports or extension
// APIs here. Temporary hooks capture only the exact selected caption response.
export async function youtubeCaptionAssist(options){
 const key=Symbol.for('video-pocket.youtube-caption-assist');
 const norm=value=>String(value || '').replace(/-orig$/,'').replace(/_/g,'-').toLowerCase();
 const videoId=()=>{const url=new URL(location.href);return url.searchParams.get('v') || url.pathname.split('/shorts/')[1]?.split('/')[0];};
 const player=document.querySelector('#movie_player');
 const current=window[key];
 if(options.action!=='start'){
  if(!current||current.token!==options.token)return {cancelled:true};
  if(options.action==='finish')return {finished:true,...await current.finish()};
  if(!current.same()){await current.finish(false);return {changed:true};}
  if(current.cancelled||current.phase!=='capturing')return {cancelled:true,manual:!!current.cancelled};
  if(!current.hasResponse&&!current.failure)await current.reload?.();
  if(!current.same()){await current.finish(false);return {changed:true};}
  if(current.cancelled||current.phase!=='capturing')return {cancelled:true,manual:!!current.cancelled};
  if(current.failure){const failure=current.failure;current.failure=null;return {failure};}
  if(current.hasResponse){const raw=current.raw;current.raw=null;current.hasResponse=false;return {hasResponse:true,raw};}
  return {waiting:true};
 }
 if(current)return {started:false};
 const selector=options.selector || {},expectedId=selector.videoId;
 let response;try{response=player?.getPlayerResponse?.();}catch{}
 if(!/^[\w-]{11}$/.test(expectedId || '')||videoId()!==expectedId||response?.videoDetails?.videoId!==expectedId)return {started:false,changed:true};
 if(!['getOption','setOption','loadModule','unloadModule'].every(name=>typeof player?.[name]==='function'))return {started:false};
 const video=player.querySelector('video'),identity=window[Symbol.for('video-pocket.identities')];
 if(!video||(selector.mediaKey!=null&&identity?.keys?.get(video)!==selector.mediaKey)||(selector.mediaUrl&&(video.currentSrc || video.src || video.querySelector?.('source')?.src || '')!==selector.mediaUrl))return {started:false,changed:true};
 const tracks=response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
 const params=raw=>{try{const url=new URL(raw),encoded=url.pathname.match(/\/tts_params\/([^/]+)/)?.[1];return encoded?new URLSearchParams(decodeURIComponent(encoded)):url.searchParams;}catch{return new URLSearchParams();}};
 const selected=tracks.filter((track,index)=>(track.vssId || `youtube:${index}`)===selector.pageTrackId&&norm(track.languageCode)===norm(options.language)&&(track.kind==='asr')===options.automatic&&!params(track.baseUrl).has('tlang'));
 if(selected.length!==1)return {started:false};
 const target=selected[0],targetName=params(target.baseUrl).get('name') || '';
 if(selector.captionName!=null&&selector.captionName!==targetName)return {started:false};
 const active=()=>{try{return player.getOption('captions','track') || {};}catch{return {};}};
 const enabled=()=>{try{if(typeof player.isSubtitlesOn==='function')return !!player.isSubtitlesOn();}catch{}const value=player.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed');return value==='true'?true:value==='false'?false:null;};
 const matches=track=>{
  if(!track||norm(track.languageCode)!==norm(target.languageCode)||(track.kind==='asr')!==(target.kind==='asr')||track.translationLanguage)return false;
  if(track.vssId)return track.vssId===target.vssId;
  const alternatives=tracks.filter(t=>norm(t.languageCode)===norm(target.languageCode)&&(t.kind==='asr')===(target.kind==='asr'));
  if(alternatives.length===1)return true;
  if(typeof track.name==='string'&&track.name===targetName&&alternatives.filter(t=>(params(t.baseUrl).get('name') || '')===targetName).length===1)return true;
  const name=t=>typeof t?.name==='string'?t.name:t?.name?.simpleText || t?.name?.runs?.map(r=>r.text).join('') || '';
  return !!name(target)&&name(track)===name(target)&&alternatives.filter(t=>name(t)===name(target)).length===1;
 };
 const beforeEnabled=enabled();if(beforeEnabled===null)return {started:false};
 let beforeTrack;try{beforeTrack=structuredClone(active());}catch{return {started:false};}
 // An enabled but unidentifiable original track cannot be safely restored.
 if(beforeEnabled&&!beforeTrack.languageCode)return {started:false};
 const state={token:options.token,raw:null,hasResponse:false,failure:null,applied:false,cancelled:false,phase:'capturing',intent:0};
 const same=()=>document.querySelector('#movie_player')===player&&player.querySelector('video')===video&&videoId()===expectedId&&player.getPlayerResponse?.()?.videoDetails?.videoId===expectedId&&(selector.mediaKey==null||identity?.keys?.get(video)===selector.mediaKey);
 state.same=same;state.owns=()=>same()&&enabled()===true&&matches(active());
 let timer,oldFetch,fetchHook,oldOpen,oldSend,openHook,sendHook,xhrProto,finished=false,nativePending=0;
 const xhrs=new Map(),readers=new Set(),pending=new Set();
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let hasWrites=false,lastCaptureWrite=0;
 const allowed=(restoring,intent)=>same()&&intent===state.intent&&state.phase===(restoring?'restoring':'capturing')&&(!state.cancelled||(restoring&&!!state.manualGoal));
 const control=async(method,args,restoring=false,intent=state.intent)=>{
  if(!allowed(restoring,intent))return false;
  hasWrites=true;if(!restoring)lastCaptureWrite=Date.now();
  const value=Reflect.apply(player[method],player,args);
  if(value&&typeof value.then==='function'){
   const operation=Promise.resolve(value);pending.add(operation);
   void operation.then(()=>pending.delete(operation),()=>pending.delete(operation));
   let timeout;
   try{await Promise.race([operation,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Caption control timed out')),1500);})]);}finally{clearTimeout(timeout);}
  }
  return allowed(restoring,intent);
 };
 // Loading a module is not always equivalent to toggling captions on. Some
 // player sessions keep it loaded but disabled; confirm the visible state
 // before selecting a language, and use the native toggle only if needed.
 const setEnabled=async(wanted,restoring=false,intent=state.intent)=>{
  if(!allowed(restoring,intent))return false;
  if(enabled()===wanted)return true;
  if(!await control(wanted?'loadModule':'unloadModule',['captions'],restoring,intent))return false;
  for(let i=0;i<8&&allowed(restoring,intent)&&enabled()!==wanted;i++)await pause(50);
  if(allowed(restoring,intent)&&enabled()!==wanted&&typeof player.toggleSubtitles==='function'){
   if(!await control('toggleSubtitles',[],restoring,intent))return false;
   for(let i=0;i<8&&allowed(restoring,intent)&&enabled()!==wanted;i++)await pause(50);
  }
  return allowed(restoring,intent)&&enabled()===wanted;
 };
 const matchesTrack=expected=>{
  const track=active(),name=t=>typeof t?.name==='string'?t.name:t?.name?.simpleText || t?.name?.runs?.map(r=>r.text).join('') || '';
  return norm(track.languageCode)===norm(expected.languageCode)&&(track.kind==='asr')===(expected.kind==='asr')&&(!track.vssId||!expected.vssId||track.vssId===expected.vssId)&&name(track)===name(expected)&&norm(track.translationLanguage?.languageCode)===norm(expected.translationLanguage?.languageCode);
 };
 const exactUrl=raw=>{
  try{const url=new URL(raw,location.href),p=params(url.href);return url.protocol==='https:'&&/(^|\.)youtube\.com$/.test(url.hostname)&&url.pathname==='/api/timedtext'&&p.get('v')===expectedId&&norm(p.get('lang'))===norm(target.languageCode)&&!p.has('tlang')&&(p.get('kind')==='asr')===(target.kind==='asr')&&(p.get('name') || '')===targetName;}catch{return false;}
 };
 const keep=raw=>{if(!finished&&!state.cancelled&&same()&&typeof raw==='string'&&raw.length<=4*1024*1024){
  // A second response for the same track must not erase a body still waiting
  // for the reader. Empty bodies remain observable when no body was retained.
  if(state.hasResponse&&state.raw?.trim()&&!raw.trim())return;
  state.raw=raw;state.hasResponse=true;state.failure=null;state.reloaded=true;
 }};
 const fail=(code,status)=>{
  if(finished||state.cancelled||state.hasResponse||!same())return;
  state.reloaded=true;
  if(code==='YT_FILE_HTTP'){const value=Number(status);state.failure={code,...(Number.isInteger(value)&&value>=100&&value<=599?{status:value}:{})};}
  else if(code==='YT_FILE_NETWORK'||code==='YT_FILE_INVALID')state.failure={code};
 };
 const observe=async(res,url)=>{
  if(finished||!res||!exactUrl(res.url || url))return;
  if(!res.ok){fail('YT_FILE_HTTP',res.status);return;}
  let reader;
  try{
   if(Number(res.headers?.get('content-length'))>4*1024*1024){fail('YT_FILE_INVALID');return;}
   const copy=res.clone();if(!copy.body){keep('');return;}
   reader=copy.body.getReader();readers.add(reader);const decoder=new TextDecoder();let raw='',size=0;
   while(!finished){const part=await reader.read();if(part.done){keep(raw+decoder.decode());break;}size+=part.value.byteLength;if(size>4*1024*1024){fail('YT_FILE_INVALID');break;}raw+=decoder.decode(part.value,{stream:true});}
  }catch{fail('YT_FILE_NETWORK');}finally{if(reader){readers.delete(reader);void reader.cancel().catch(()=>{});}}
 };
 // A previously loaded track may be served entirely from the player's cache,
 // producing no response for our temporary observer. Reload it at most once;
 // do not duplicate an in-flight request or a response already captured.
 state.reload=async(immediate=false)=>{
  if(state.reloaded||!state.applied||(!immediate&&Date.now()-state.appliedAt<350)||state.hasResponse||state.failure||nativePending||xhrs.size||!state.owns()||!allowed(false,state.intent))return;
  state.reloaded=true;await control('setOption',['captions','reload',true]);
 };
 state.finish=(restore=true)=>{
  if(!restore)state.restoreAllowed=false;
  if(state.finishPromise)return state.finishPromise;
  state.restoreAllowed=restore;state.phase='restoring';finished=true;clearTimeout(timer);
  if(fetchHook&&window.fetch===fetchHook)window.fetch=oldFetch;
  const proto=xhrProto;
  if(openHook&&proto?.open===openHook)proto.open=oldOpen;
  if(sendHook&&proto?.send===sendHook)proto.send=oldSend;
  for(const [xhr,listener] of xhrs)xhr.removeEventListener('loadend',listener);xhrs.clear();
  for(const reader of readers)void reader.cancel().catch(()=>{});readers.clear();
  state.raw=null;state.hasResponse=false;state.failure=null;
  // Keep the token and trusted-input listeners until restoration settles.
  // Native methods may return a Promise or apply a void operation later.
  state.finishPromise=Promise.resolve().then(async()=>{
   if(!hasWrites)return {restored:true};
   const began=Date.now(),deadline=began+4000,settleAfter=Math.max(began+700,lastCaptureWrite+1500);
   let stableSince=null,nextRepair=0,repairs=0,goalIntent=-1,trackConfirmed=false,restored=false;
   while(Date.now()<=deadline){
    if(!same())return {restored:false,cancelled:true};
    const goal=state.cancelled?state.manualGoal:state.restoreAllowed?{enabled:beforeEnabled,track:beforeTrack}:null,intent=state.intent;
    if(!goal){if(!pending.size&&Date.now()>=settleAfter)return {restored:false,cancelled:true};await pause(50);continue;}
    if(goalIntent!==intent){goalIntent=intent;trackConfirmed=!goal.track.languageCode||matchesTrack(goal.track);stableSince=null;repairs=0;nextRepair=0;}
    if(goal.track.languageCode){if(matchesTrack(goal.track))trackConfirmed=true;else if(active().languageCode)trackConfirmed=false;}
    restored=enabled()===goal.enabled&&(!goal.track.languageCode||(goal.enabled?matchesTrack(goal.track):trackConfirmed));
    if(restored&&!pending.size){
     stableSince ??= Date.now();
     if(Date.now()>=settleAfter&&Date.now()-stableSince>=300)return {restored:true};
    }else{
     stableSince=null;
     // Give the native UI time to apply a trusted choice before compensating
     // for an older extension operation that resolves after that choice.
     if(Date.now()>=nextRepair&&(!state.cancelled||Date.now()-state.manualAt>=200)&&repairs<5){
      repairs++;
      if(goal.enabled&&enabled()!==true)try{await setEnabled(true,true,intent);}catch{}
      if(goal.track.languageCode&&!matchesTrack(goal.track))try{await control('setOption',['captions','track',goal.track],true,intent);if(matchesTrack(goal.track))trackConfirmed=true;}catch{}
      if(!goal.enabled&&enabled()!==false)try{await setEnabled(false,true,intent);}catch{}
      nextRepair=Date.now()+200;
     }
    }
    await pause(50);
   }
   if(same())console.error('VideoPocket：字幕狀態未能確認還原');
   return {restored:false};
  }).catch(()=>({restored:false})).finally(()=>{
   state.phase='finished';
   window.removeEventListener?.('pointerdown',onInput,true);window.removeEventListener?.('keydown',onInput,true);window.removeEventListener?.('pagehide',onHide);
   if(window[key]===state)delete window[key];
  });
  return state.finishPromise;
 };
 const onInput=event=>{if(!event.isTrusted)return;
  // Opening settings is not a caption choice: restore instead of leaving the
  // temporary captions enabled. A subsequent menu choice takes precedence.
  const shortcut=event.type==='keydown'&&event.key?.toLowerCase()==='c'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target?.closest?.('input,textarea,[contenteditable="true"]');
  if(!shortcut&&event.target?.closest?.('.ytp-settings-button')){void state.finish();return;}
  const toggle=event.target?.closest?.('.ytp-subtitles-button'),menu=event.target?.closest?.('.ytp-settings-menu');
  if(toggle||menu||shortcut){
   if(event.type==='keydown'&&!shortcut&&!['Enter',' '].includes(event.key))return;
   const item=event.target?.closest?.('.ytp-menuitem'),panel=item?.closest?.('.ytp-panel') || menu,title=panel?.querySelector?.('.ytp-panel-title')?.textContent || '';
   if(menu&&!toggle&&!shortcut&&!/字幕|subtitles?|captions?|auto.translate|自動翻譯|自动翻译|sous.titres|subt[ií]tulos|untertitel|자막/i.test(title)){void state.finish();return;}
   const previousGoal=state.manualGoal;
   state.cancelled=true;state.intent++;state.manualAt=Date.now();state.manualGoal=null;
   try{
    const preferred=previousGoal?.track || (beforeTrack.languageCode?beforeTrack:{});
    if(toggle||shortcut)state.manualGoal={enabled:!enabled(),track:structuredClone(preferred)};
    else{
     const label=(item?.querySelector?.('.ytp-menuitem-label')?.textContent || item?.textContent || '').trim(),name=t=>typeof t.name==='string'?t.name:t.name?.simpleText || t.name?.runs?.map(r=>r.text).join('') || '';
     const choices=tracks.filter(t=>name(t).trim()===label);
     if(label&&choices.length===1)state.manualGoal={enabled:true,track:structuredClone(choices[0])};
     else if(/^(off|關閉|关闭)$/i.test(label))state.manualGoal={enabled:false,track:structuredClone(preferred)};
    }
   }catch{}
   void state.finish(false);
  }
 };
 const onHide=()=>state.finish();
 window[key]=state;
 try{
  oldFetch=window.fetch;
  if(typeof oldFetch==='function'){fetchHook=function(...args){const url=args[0]?.url || args[0],tracked=exactUrl(url),promise=Reflect.apply(oldFetch,this,args);if(tracked)nativePending++;void Promise.resolve(promise).then(res=>observe(res,url),()=>{if(tracked)fail('YT_FILE_NETWORK');}).catch(()=>{}).finally(()=>{if(tracked)nativePending--;});return promise;};window.fetch=fetchHook;}
  const proto=xhrProto=window.XMLHttpRequest?.prototype;
  if(proto){
   oldOpen=proto.open;oldSend=proto.send;
   const urls=new WeakMap();
   openHook=function(method,url,...rest){const previous=xhrs.get(this);if(previous){this.removeEventListener('loadend',previous);xhrs.delete(this);}urls.set(this,String(url));return Reflect.apply(oldOpen,this,[method,url,...rest]);};
   sendHook=function(...args){
    if(exactUrl(urls.get(this))){const xhr=this,listener=()=>{xhrs.delete(xhr);if(!exactUrl(xhr.responseURL || urls.get(xhr)))return;try{if(xhr.status>=200&&xhr.status<300){if(!xhr.responseType||xhr.responseType==='text')keep(xhr.responseText);else if(xhr.responseType==='json')keep(JSON.stringify(xhr.response));else fail('YT_FILE_INVALID');}else if(xhr.status>0)fail('YT_FILE_HTTP',xhr.status);else fail('YT_FILE_NETWORK');}catch{fail('YT_FILE_INVALID');}};xhrs.set(xhr,listener);xhr.addEventListener('loadend',listener,{once:true});}
    return Reflect.apply(oldSend,this,args);
   };proto.open=openHook;proto.send=sendHook;
  }
  window.addEventListener?.('pointerdown',onInput,true);window.addEventListener?.('keydown',onInput,true);window.addEventListener?.('pagehide',onHide,{once:true});
  // Independent watchdog also restores state if the extension reloads or the
  // service worker is interrupted while waiting for the caption response.
  timer=setTimeout(()=>state.finish(),15000);
  if(!beforeEnabled){
   if(!await setEnabled(true)){await state.finish();return {started:false};}
   // A closed module often returns {} for its track. Let the native module
   // reveal its remembered/default selection before choosing another language.
   // Otherwise closing alone would leave our temporary language as the next
   // language shown when the user turns captions on again.
   for(let i=0;i<15&&!beforeTrack.languageCode&&same()&&!state.cancelled&&state.phase==='capturing';i++){
    const remembered=active();
    if(remembered.languageCode){beforeTrack=structuredClone(remembered);break;}
    await pause(50);
   }
   if(!beforeTrack.languageCode){await state.finish();return {started:false};}
  }
  for(let i=0;i<15&&same()&&!state.cancelled&&state.phase==='capturing';i++){
   if(i===0||i===5)await control('setOption',['captions','track',target]);
   if(state.owns()){state.applied=true;state.appliedAt=Date.now();break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!state.applied){await state.finish();return {started:false};}
  if(matches(beforeTrack))await state.reload(true);
  if(state.phase!=='capturing'||state.cancelled){await state.finish();return {started:false};}
  return {started:true};
 }catch{
  await state.finish();return {started:false};
 }
}
