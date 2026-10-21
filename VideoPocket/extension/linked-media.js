import {extractMediaModels,createMediaModelStore} from './media-models.js';

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

export async function resolveLinkedMedia(link,referer,request,{parseDocument=html=>new DOMParser().parseFromString(html,'text/html'),signal}={}){
  const {target,id}=validLink(link,referer);
  if(typeof request!=='function')throw unavailable();
  const response=await request(target.href,{method:'GET',signal});
  let finalUrl;
  try{
    if(!response?.ok)throw response?.status?Object.assign(new Error(`HTTP ${response.status}`),{status:response.status}):unavailable();
    finalUrl=new URL(response.url||target.href);
    if(finalUrl.origin!==target.origin||pathOf(finalUrl)!==pathOf(target))throw unavailable('獨立影片頁轉向其他頁面，未採用其來源','linked-redirect');
    const type=String(response.headers?.get?.('content-type')||'').split(';',1)[0].trim().toLowerCase();if(type!=='text/html')throw unavailable('獨立影片頁未回傳 HTML');
  }catch(error){await response?.body?.cancel?.().catch(()=>{});throw error;}
  const html=await readDocument(response),document=parseDocument(html);if(!document?.querySelectorAll)throw unavailable();
  const store=createMediaModelStore(),scripts=document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]');let total=0,count=0;
  for(const script of scripts){if(count++>=MAX_SCRIPTS)break;const text=String(script?.textContent||'');if(text.length>MAX_SCRIPT_BYTES)continue;if(total+text.length>MAX_JSON_BYTES)throw unavailable();total+=text.length;let value;try{value=JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/,''));}catch{continue;}store.merge(extractMediaModels(value,{baseUrl:finalUrl.href,budget:MAX_SCRIPT_BYTES}));}
  const matches=store.models().filter(model=>model.aliases.includes(id));if(matches.length!==1)throw unavailable(matches.length?'獨立影片頁來源無法唯一配對':'獨立影片頁未提供相符的播放資料',matches.length?'linked-ambiguous':'linked-no-model');
  return {...matches[0],site:'embedded'};
}
