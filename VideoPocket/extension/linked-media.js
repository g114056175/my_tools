import {extractMediaModels,createMediaModelStore} from './media-models.js';
import {xMediaPayloadsFromScript,xBroadcastIdFromUrl} from './x-media.js';

const MAX_DOCUMENT_BYTES=4*1024*1024,MAX_SCRIPT_BYTES=1024*1024,MAX_JSON_BYTES=2*1024*1024,MAX_SCRIPTS=64;
const unavailable=(message='獨立影片頁來源不可用',sourceStage='linked-document')=>Object.assign(new Error(message),{code:'SOURCE_UNAVAILABLE',sourceStage});
const pathOf=url=>{const path=url.pathname.replace(/\/+$/,'');return path||'/';};

function validLink(link,referer){
  let target,base;
  try{target=new URL(String(link?.url||''));base=new URL(String(referer||''));}catch{throw unavailable();}
  if(target.protocol!=='https:'||base.protocol!=='https:'||target.origin!==base.origin||target.username||target.password||!String(link?.id||'').trim()||String(link.id).length>256)throw unavailable();
  return {target,id:String(link.id).trim()};
}

async function readDocument(response){
  if(!response?.body?.getReader)throw unavailable();
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{while(true){const item=await reader.read();if(item.done)break;const value=item.value instanceof Uint8Array?item.value:new Uint8Array(item.value||[]);total+=value.byteLength;if(total>MAX_DOCUMENT_BYTES)throw unavailable();chunks.push(value);}}
  finally{try{await reader.cancel();}catch{}}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

async function resolveXBroadcastDocument(model,target,response,document,redirectStage='linked-broadcast-redirect'){
  let final;
  try{
    final=new URL(response?.url || target.href);
    if(!response?.ok)throw response?.status?Object.assign(new Error(`HTTP ${response.status}`),{status:response.status}):unavailable();
    if(final.origin!==target.origin||xBroadcastIdFromUrl(final.href)!==model.broadcastId)throw unavailable('廣播頁已轉向其他內容',redirectStage);
    if(!/^text\/html(?:;|$)/i.test(response.headers?.get?.('content-type') || ''))throw unavailable();
  }catch(error){await response?.body?.cancel?.().catch(()=>{});throw error;}
  const meta=key=>[...document.querySelectorAll(`meta[property="${key}"],meta[name="${key}"]`)].map(node=>String(node.getAttribute('content') || '').trim()).filter(Boolean);
  const bids=[...new Set(meta('twitter:text:broadcast_id'))];
  if(bids.length!==1||bids[0]!==model.broadcastId)throw unavailable('廣播頁未回傳相符的影片身分','linked-no-model');
  const expectedKeys=model.aliases.filter(value=>/^\d+_\d+$/.test(value)),keys=meta('twitter:text:broadcast_media_key');
  if(expectedKeys.length&&(!keys.length||keys.some(key=>!expectedKeys.includes(key))))throw unavailable('廣播頁的媒體身分已變更','linked-no-model');
  const sources=[...new Set([...meta('og:video:secure_url'),...meta('og:video:url')])].filter(raw=>{
    try{const source=new URL(raw);return source.protocol==='https:'&&!source.username&&!source.password&&/\.m3u8$/i.test(source.pathname);}catch{return false;}
  });
  if(sources.length!==1)throw unavailable('廣播頁未提供唯一的回放來源',sources.length?'linked-ambiguous':'linked-no-model');
  return {...model,site:'embedded',bindingOnly:false,manifestUrl:sources[0],manifestType:'hls',title:meta('twitter:text:broadcast_title')[0] || model.title};
}

async function resolveXBroadcast(model,target,request,parseDocument,signal){
  const url=new URL('/i/broadcasts/'+model.broadcastId,target.origin);
  if(xBroadcastIdFromUrl(url.href)!==model.broadcastId)throw unavailable();
  const response=await request(url.href,{method:'GET',signal});
  return resolveXBroadcastDocument(model,target,response,parseDocument(await readDocument(response)));
}

export async function resolveLinkedMedia(link,referer,request,{parseDocument=html=>new DOMParser().parseFromString(html,'text/html'),signal}={}){
  const {target,id}=validLink(link,referer);
  if(typeof request!=='function')throw unavailable();
  const response=await request(target.href,{method:'GET',signal});
  let finalUrl;
  try{
    if(!response?.ok)throw response?.status?Object.assign(new Error(`HTTP ${response.status}`),{status:response.status}):unavailable();
    finalUrl=new URL(response.url||target.href);
    if(finalUrl.origin!==target.origin||pathOf(finalUrl)!==pathOf(target))throw unavailable('獨立影片頁轉向其他頁面，未採用其來源','linked-post-redirect');
    const type=String(response.headers?.get?.('content-type')||'').split(';',1)[0].trim().toLowerCase();if(type!=='text/html')throw unavailable('獨立影片頁未回傳 HTML');
  }catch(error){await response?.body?.cancel?.().catch(()=>{});throw error;}
  const html=await readDocument(response),document=parseDocument(html);if(!document?.querySelectorAll)throw unavailable();
  const directBroadcastId=xBroadcastIdFromUrl(target.href);
  if(directBroadcastId){
    if(directBroadcastId!==id)throw unavailable('廣播頁連結身分不相符','linked-no-model');
    return resolveXBroadcastDocument({id:directBroadcastId,aliases:[directBroadcastId],provider:'x',broadcastId:directBroadcastId,broadcastUrl:target.href,versions:[],bindingOnly:true},target,response,document);
  }
  const xPage=/^(?:www\.)?(?:x|twitter)\.com$/i.test(finalUrl.hostname);
  const store=createMediaModelStore(),scripts=document.querySelectorAll(xPage?'script:not([src])':'script[type="application/json"],script[type="application/ld+json"]');let total=0,count=0;
  for(const script of scripts){
    if(count++>=MAX_SCRIPTS)break;const text=String(script?.textContent||'');if(text.length>MAX_SCRIPT_BYTES)continue;
    if(total+text.length>MAX_JSON_BYTES)throw unavailable();total+=text.length;
    let values;try{values=[JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/,''))];}catch{values=xPage?xMediaPayloadsFromScript(text):[];}
    for(const value of values)store.merge(extractMediaModels(value,{baseUrl:finalUrl.href,budget:MAX_SCRIPT_BYTES}));
  }
  const matches=store.models().filter(model=>model.aliases.includes(id));if(matches.length!==1)throw unavailable(matches.length?'獨立影片頁來源無法唯一配對':'獨立影片頁未提供相符的播放資料',matches.length?'linked-ambiguous':'linked-no-model');
  if(xPage&&matches[0].broadcastId&&!matches[0].manifestUrl&&!matches[0].versions.length)return resolveXBroadcast(matches[0],target,request,parseDocument,signal);
  return {...matches[0],site:'embedded'};
}
