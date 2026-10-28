import {ownedVimeoConfiguration} from './vimeo-player.js';

const MAX_JSON=512*1024;
const routeId=raw=>{try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)return '';return /^(?:www\.)?vimeo\.com$/.test(u.hostname)?u.pathname.match(/^\/(\d{1,32})(?:\/|$)/)?.[1]||'':u.hostname==='player.vimeo.com'?u.pathname.match(/^\/video\/(\d{1,32})(?:\/|$)/)?.[1]||'':'';}catch{return '';}};
const configUrl=(raw,id)=>{try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='player.vimeo.com'&&!u.username&&!u.password&&!u.hash&&u.pathname===`/video/${id}/config`?u.href:'';}catch{return '';}};

// Metadata requests happen only for the selected Vimeo player after the
// existing discovery route has no model. No playback or caption state changes.
export function createVimeoConfigurationReader({target,parseJson=JSON.parse,fetch:pageFetch,isActive=()=>true,timeoutMs=8000}={}){
 const pending=new WeakMap(),cache=new WeakMap(),controllers=new Set();let disposed=false;
 const selected=video=>{
  if(disposed||!isActive()||!video||video.isConnected===false||video.mediaKeys)return null;
  const pageUrl=target?.location?.href,id=routeId(pageUrl);if(!id)return null;
  const document=target.document;
  const videos=[...(document?.querySelectorAll?.('video')||[])].slice(0,257).filter(v=>v.isConnected!==false);
  if(videos.length!==1||videos[0]!==video)return null;
  const source=video.currentSrc||video.getAttribute?.('src')||'',duration=Number(video.duration);
  return {id,pageUrl,document,source,duration:Number.isFinite(duration)&&duration>0?duration:0,players:[{element:video}]};
 };
 const same=(a,b)=>b&&a.id===b.id&&a.pageUrl===b.pageUrl&&a.document===b.document&&a.source===b.source&&(!a.duration||Math.abs(a.duration-b.duration)<.1);
 const normalize=(video,state,payload)=>{
  if(!same(state,selected(video)))return null;
  if(state.duration&&Number(payload?.video?.duration)>0&&Math.abs(state.duration-Number(payload.video.duration))>Math.max(.75,Math.min(2,state.duration*.005)))return null;
  return ownedVimeoConfiguration(video,{...nativeTarget(),document:{scripts:[]},playerConfig:payload},{pageUrl:state.pageUrl,players:state.players,parseJson});
 };
 // Supply native DOM interfaces explicitly. The source response must never
 // borrow a page's older global playerConfig or clip-page configuration.
 const nativeTarget=()=>({document:target.document,Node:target.Node,Element:target.Element,HTMLMediaElement:target.HTMLMediaElement,Window:target.Window,Document:target.Document,HTMLCollection:target.HTMLCollection,HTMLScriptElement:target.HTMLScriptElement});
 const read=async(url,signal,headers)=>{
  if(!pageFetch)return null;
  const response=await pageFetch(url,{method:'GET',credentials:'include',redirect:'error',signal,headers:{Accept:'application/json',...headers}});
  if(!response.ok){await response.body?.cancel?.();return null;}
  if(Number(response.headers?.get?.('content-length'))>MAX_JSON){await response.body?.cancel?.();return null;}
  let raw='';
  if(response.body?.getReader){
   const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
   try{while(true){signal.throwIfAborted();const value=await reader.read();if(value.done)break;bytes+=value.value.byteLength;if(bytes>MAX_JSON)return null;raw+=decoder.decode(value.value,{stream:true});}raw+=decoder.decode();}
   finally{await reader.cancel().catch(()=>{});}
  }else{raw=await response.text();if(raw.length>MAX_JSON)return null;}
  signal.throwIfAborted();try{return parseJson(raw);}catch{return null;}
 };
 const nextPage=state=>{
  try{
   const raw=state.document.querySelector?.('script#__NEXT_DATA__')?.textContent;if(!raw||raw.length>MAX_JSON)return null;
   const page=parseJson(raw)?.props?.pageProps;
   return String(page?.clipId||'')===state.id&&page?.clip?.uri===`/videos/${state.id}`?page:null;
  }catch{return null;}
 };
 const lookup=async(video,state,signal)=>{
  const loaded=ownedVimeoConfiguration(video,target,{pageUrl:state.pageUrl,players:state.players,parseJson});
  if(loaded?.video)return normalize(video,state,loaded);
  // A route-derived endpoint is accepted only when its response explicitly
  // confirms the same video ID, source element and playback duration.
  const first=configUrl(loaded?.configUrl,state.id)||`https://player.vimeo.com/video/${state.id}/config`;
  let payload;
  try{payload=await read(first,signal);}catch{signal.throwIfAborted();}
  let result=payload&&normalize(video,state,payload);if(result?.video)return result;
  if(!same(state,selected(video)))return null;
  const page=nextPage(state);if(!page)return null;
  let viewer=page.viewerBootstrap;
  if(!viewer?.jwt)try{const raw=state.document.querySelector?.('script#viewer-bootstrap')?.textContent;if(raw&&raw.length<=65536)viewer=parseJson(raw);}catch{}
  const jwt=typeof viewer?.jwt==='string'&&viewer.jwt.length<=16384?viewer.jwt:'';
  if(!jwt||/[\r\n]/.test(jwt))return null;
  const api=new URL(`https://api.vimeo.com/videos/${state.id}`);api.searchParams.set('fields','uri,embed_player_config_url');
  const signature=page.pageMetadata?.clipSignature;if(typeof signature==='string'&&signature.length<=4096)api.searchParams.set('anon_signature',signature);
  let metadata;
  try{metadata=await read(api.href,signal,{Authorization:`jwt ${jwt}`});}catch{signal.throwIfAborted();}
  if(metadata?.uri!==`/videos/${state.id}`||!same(state,selected(video)))return null;
  const url=configUrl(metadata.embed_player_config_url||metadata.config_url,state.id);if(!url||url===first)return null;
  try{payload=await read(url,signal);}catch{signal.throwIfAborted();return null;}
  result=payload&&normalize(video,state,payload);return result?.video?result:null;
 };
 const get=async video=>{
  const state=selected(video);if(!state)return null;
  const previous=cache.get(video);if(previous&&same(state,previous.state)&&Date.now()-previous.at<30000)return previous.value;
  const active=pending.get(video);if(active&&same(state,active.state))return active.promise;
  const controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(new DOMException('Vimeo metadata timeout','TimeoutError')),timeoutMs);
  const task={state};task.promise=(async()=>{
   try{const value=await lookup(video,state,controller.signal);if(value&&same(state,selected(video)))cache.set(video,{state,value,at:Date.now()});return value;}
   catch{return null;}
   finally{clearTimeout(timer);controllers.delete(controller);if(pending.get(video)===task)pending.delete(video);}
  })();pending.set(video,task);return task.promise;
 };
 return {get,dispose(){disposed=true;for(const controller of controllers)controller.abort();controllers.clear();}};
}
