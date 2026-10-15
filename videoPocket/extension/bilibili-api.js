import {md5,wbiQuery} from './bilibili-wbi.js';
import {decodeBilibiliSubtitleUrl} from './bilibili-subtitle-url.js';
// Bilibili's current player subtitle metadata uses Protobuf, not the legacy
// unsigned /x/player/v2 JSON list. Keep network access in the extension world:
// page scripts cannot replace fetch or rewrite these responses.
const fail=(code,extra={})=>{throw Object.assign(new Error(code),{code,subtitleStage:'list',...extra});};
const isFailure=error=>typeof error?.code==='string'&&error.code.startsWith('BILI_');
const responseFailure=error=>{if(isFailure(error))throw error;fail(error?.name==='AbortError'||error?.name==='TimeoutError'?'BILI_TIMEOUT':'BILI_LIST_INVALID',{retryable:error?.name==='AbortError'||error?.name==='TimeoutError'});};
const text=new TextDecoder('utf-8',{fatal:true});

export function decodeBilibiliMetadata(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 const message=buffer=>{
  let offset=0;const fields=[];
  const integer=()=>{let value=0n;for(let i=0;i<10;i++){if(offset>=buffer.length)throw new Error('truncated');const byte=buffer[offset++];if(i===9&&byte>1)throw new Error('overflow');value|=BigInt(byte&127)<<BigInt(i*7);if(!(byte&128))return value;}throw new Error('varint');};
  while(offset<buffer.length){
   const key=integer(),id=Number(key>>3n),wire=Number(key&7n);if(id<1)throw new Error('field');
   if(wire===0){fields.push({id,value:integer()});continue;}
   const size=wire===1?8:wire===5?4:wire===2?Number(integer()):-1;
   if(!Number.isSafeInteger(size)||size<0||size>buffer.length-offset)throw new Error('length');
   fields.push({id,bytes:buffer.subarray(offset,offset+size),wire});offset+=size;
  }
  return fields;
 };
 try{
  // Some API failures are JSON even though successful responses are binary.
  let json;try{json=JSON.parse(text.decode(bytes));}catch{}
  if(json&&typeof json==='object'){if(Number.isInteger(json.code)&&json.code!==0)fail(json.code===-101?'BILI_LOGIN_REQUIRED':'BILI_LIST_API',{apiCode:json.code});fail('BILI_LIST_INVALID');}
  const top=message(bytes),data=top.filter(f=>f.id===1&&f.wire===2);
  if(data.length!==1)throw new Error('missing data');
  const tracks=[];
  for(const field of message(data[0].bytes).filter(f=>f.id===3&&f.wire===2)){
   const fields=message(field.bytes),string=id=>{const f=fields.find(f=>f.id===id&&f.wire===2);return f?text.decode(f.bytes):'';};
   const lan=string(3),subtitle_url=string(5);if(!lan||!subtitle_url)continue;
   tracks.push({id_str:string(2)||fields.find(f=>f.id===1&&f.value!==undefined)?.value.toString()||'',lan,lan_doc:string(4)||lan,subtitle_url});
  }
  return tracks;
 }catch(error){if(isFailure(error))throw error;fail('BILI_LIST_INVALID');}
}

export function bilibiliTrackKey(track,bvid,cid){
 const language=String(track.lan||'und').replace(/_/g,'-').toLowerCase();
 // Never round uint64 subtitle IDs. Only ephemeral authentication parameters
 // may be ignored when no ID exists; other query parameters identify content.
 let identity=String(track.id_str||'');
 if(!identity){const url=new URL(track.subtitle_url,'https://www.bilibili.com');for(const key of [...url.searchParams.keys()])if(/^(auth_key|sign|signature|expires|deadline|token)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();identity='url:'+md5(url.href);}
 return `bili-web:${bvid}:${cid}:`+encodeURIComponent(JSON.stringify([language,identity]));
}

export function createBilibiliClient({fetchApi=fetch,headers=async()=>{}}={}){
 const identities=new Map(),inventories=new Map();let signingKey;
 const request=async(url,deadline)=>{
  const left=deadline-Date.now();if(left<=0)fail('BILI_TIMEOUT');
  await headers(url);
  try{const response=await fetchApi(url,{credentials:'include',cache:'no-store',headers:{Accept:new URL(url).pathname==='/x/v2/subtitle/web/view'?'application/octet-stream':'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(5000,left)))});if(!response.ok)fail('BILI_LIST_HTTP',{status:response.status,retryable:response.status===429||response.status>=500});return response;}
  catch(error){if(isFailure(error))throw error;fail(error?.name==='AbortError'||error?.name==='TimeoutError'?'BILI_TIMEOUT':'BILI_LIST_NETWORK',{retryable:true});}
 };
 const keys=async deadline=>{
  if(signingKey&&Date.now()-signingKey.time<30*60*1000)return signingKey;
  let value;try{value=await(await request('https://api.bilibili.com/x/web-interface/nav',deadline)).json();}catch(error){responseFailure(error);}
  const images=value?.data?.wbi_img,extract=url=>{try{return new URL(url).pathname.split('/').at(-1).split('.')[0];}catch{return '';}};
  const img=extract(images?.img_url),sub=extract(images?.sub_url);
  if(!/^[0-9a-f]{32}$/i.test(img)||!/^[0-9a-f]{32}$/i.test(sub))fail('BILI_LIST_API',{apiCode:value?.code});
  signingKey={img,sub,time:Date.now()};return signingKey;
 };
 const identity=async({bvid,page=1,bootstrap},deadline)=>{
  if(!/^BV[0-9A-Za-z]+$/.test(bvid)||!Number.isSafeInteger(page)||page<1)fail('BILI_IDENTITY_MISMATCH');
  // A page bootstrap is usable only if aid, BVID and the explicit pages[] CID
  // agree. A floating state.cid is never an identity source.
  const key=`${bvid}:${page}`,cached=identities.get(key);
  let detail=bootstrap;
  if(!detail||detail.bvid!==bvid||!Number.isSafeInteger(Number(detail.aid))||Number(detail.aid)<=0||!Array.isArray(detail.pages)||!Number(detail.pages[page-1]?.cid))detail=cached;
  if(!detail){
   const api=new URL('https://api.bilibili.com/x/web-interface/view');api.search=new URLSearchParams({bvid});
   let value;try{value=await(await request(api.href,deadline)).json();}catch(error){responseFailure(error);}
   if(value?.code!==0)fail(value?.code===-101?'BILI_LOGIN_REQUIRED':'BILI_LIST_API',{apiCode:value?.code});detail=value.data;
  }
  const part=detail?.pages?.[page-1],aid=Number(detail?.aid),cid=Number(part?.cid);
  if(detail?.bvid!==bvid||!Number.isSafeInteger(aid)||aid<=0||!Number.isSafeInteger(cid)||cid<=0)fail('BILI_IDENTITY_MISMATCH');
  identities.delete(key);identities.set(key,detail);if(identities.size>32)identities.delete(identities.keys().next().value);
  return {bvid,aid,cid,page,duration:Number(part.duration)||0,pages:detail.pages};
 };
 const inventory=async(context,deadline=Date.now()+12000)=>{
  const current=await identity(context,deadline);
  if(context.expectedCid&&Number(context.expectedCid)!==current.cid)fail('BILI_IDENTITY_MISMATCH');
  const api=new URL('https://api.bilibili.com/x/v2/subtitle/web/view');
  const signing=await keys(deadline);
  api.search=wbiQuery({oid:String(current.cid),pid:String(current.aid),type:'1',context_ext:JSON.stringify({video_type:1}),cur_production_type:'0',playlist_switch:'0',web_location:'1315873'},signing.img,signing.sub);
  const response=await request(api.href,deadline);let raw;
  try{raw=await response.arrayBuffer();}catch(error){fail(error?.name==='AbortError'||error?.name==='TimeoutError'?'BILI_TIMEOUT':'BILI_LIST_NETWORK',{retryable:true});}
  let decoded;try{decoded=decodeBilibiliMetadata(raw);}catch(error){if(error?.apiCode===-403){signingKey=null;error.retryable=true;}throw error;}
  const cacheKey=`${current.bvid}:${current.cid}:${current.page}`,previous=inventories.get(cacheKey);
  if(!decoded.length&&!context.ignoreCached&&previous&&Date.now()-previous.time<60000)return {...current,tracks:previous.tracks,captionStatus:'ready'};
  // Some sessions expose CC/AI tracks only in the signed player list. This is
  // /x/player/wbi/v2 with a valid WBI signature, never unsigned /x/player/v2.
  let loginRequired=false;
  if(!decoded.length){
   const signed=new URL('https://api.bilibili.com/x/player/wbi/v2');signed.search=wbiQuery({aid:current.aid,cid:current.cid,web_location:'1315873'},signing.img,signing.sub);
   let value;try{value=await(await request(signed.href,deadline)).json();}catch(error){responseFailure(error);}
   if(value?.code!==0){if(value?.code===-403)signingKey=null;fail(value?.code===-101?'BILI_LOGIN_REQUIRED':'BILI_LIST_API',{apiCode:value?.code,retryable:value?.code===-403});}
   const data=value.data;
   if(Number(data?.cid)!==current.cid||data?.aid!==undefined&&Number(data.aid)!==current.aid||data?.bvid&&data.bvid!==current.bvid)fail('BILI_IDENTITY_MISMATCH');
   loginRequired=!!data.need_login_subtitle;
   decoded=(Array.isArray(data.subtitle?.subtitles)?data.subtitle.subtitles:[]).map(t=>({...t,id_str:String(t.id_str||(Number.isSafeInteger(t.id)?t.id:''))}));
  }
  const tracks=decoded.map((original,i)=>{
   let t,url;try{t={...original,subtitle_url:decodeBilibiliSubtitleUrl(original.subtitle_url)};url=new URL(t.subtitle_url,'https://www.bilibili.com');}catch{fail('BILI_SOURCE_REJECTED');}
   if(url.protocol!=='https:'||!['bilibili.com','hdslb.com','biliapi.net'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))fail('BILI_SOURCE_REJECTED');
   // These AI filenames explicitly carry aid+cid. Check them instead of merely
   // trusting that the API echoed the requested identifiers.
   const product=url.pathname.match(/^\/bfs\/ai_subtitle\/prod\/([^/]+)/)?.[1];
   // Translated tracks can use a hash-only filename; that is not an embedded
   // identifier and must not be mistaken for a foreign aid/CID.
   if(product&&/^\d{10,}[0-9a-f]{32}(?:\.json)?$/i.test(product)&&!product.startsWith(String(current.aid)+String(current.cid)))fail('BILI_IDENTITY_MISMATCH');
   return {bvid:current.bvid,cid:current.cid,aid:current.aid,page:current.page,language:t.lan.replace(/^ai[-_]/i,'').replace(/_/g,'-'),rawLanguage:t.lan,name:t.lan_doc,automatic:/^ai[-_]/i.test(t.lan),apiTrackId:t.id_str,pageTrackId:bilibiliTrackKey(t,current.bvid,current.cid),pageTrackIndex:i,source:'bilibili-api',url:url.href};
  });
  if(tracks.length){inventories.delete(cacheKey);inventories.set(cacheKey,{tracks,time:Date.now()});if(inventories.size>32)inventories.delete(inventories.keys().next().value);}
  return {...current,tracks,captionStatus:tracks.length?'ready':loginRequired?'login-required':'none'};
 };
 return {inventory,async prepare(selector){
  // Always resolve the current player's metadata when the user presses Capture.
  // Do not reuse a signed URL produced by the old JSON endpoint or page globals.
  const result=await inventory({bvid:selector.expectedBvid,page:Number(selector.expectedPage)||1,expectedCid:selector.expectedCid,ignoreCached:!!selector.refreshBilibiliSource},selector.captionDeadline);
  if(!result.tracks.length&&result.captionStatus==='login-required')fail('BILI_LOGIN_REQUIRED');
  const matching=result.tracks.filter(t=>t.pageTrackId===selector.pageTrackId&&(!selector.apiTrackId||t.apiTrackId===String(selector.apiTrackId)));
  if(matching.length!==1)fail('BILI_TRACK_MISSING');const track=matching[0];
  return {...result,url:track.url,language:track.language,automatic:track.automatic,tracks:undefined};
 }};
}

// Executed in ISOLATED world; this only reads the route and cannot be affected
// by website fetch patches, stale TextTracks or MAIN-world selection globals.
export function bilibiliRoute(){
 const url=new URL(location.href);return {bvid:/(^|\.)bilibili\.com$/.test(url.hostname)?url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1]||url.searchParams.get('bvid')||'':'',page:Math.max(1,Number(url.searchParams.get('p'))||1)};
}
