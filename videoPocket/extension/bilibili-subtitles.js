import {parseSubtitles} from './subtitles.js';

const trusted=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['bilibili.com','hdslb.com','biliapi.net'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}};
const failure=(code,subtitleStage,extra={})=>Object.assign(new Error(code),{code,subtitleStage,...extra});

export function parseBilibiliSubtitle(raw,duration=0){
 let value;try{value=JSON.parse(String(raw).replace(/^\uFEFF/,''));}catch{throw failure('BILI_FILE_INVALID','parse');}
 if(Number.isInteger(value?.code)&&value.code!==0)throw failure('BILI_FILE_API','file',{apiCode:value.code});
 const body=value?.body || value?.data?.body;
 if(!Array.isArray(body))throw failure('BILI_FILE_INVALID','parse');
 if(!body.length)throw failure('BILI_FILE_EMPTY','parse');
 for(const cue of body){
  if(!cue||typeof cue!=='object'||typeof cue.content!=='string')throw failure('BILI_FILE_INVALID','parse');
  if(!cue.content.trim())continue;
  const start=Number(cue.from),end=Number(cue.to);
  if(cue.from===null||cue.to===null||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||duration>0&&end>duration+Math.max(15,duration*.02))throw failure('BILI_TIMELINE_INVALID','parse');
 }
 const cues=parseSubtitles(raw);if(!cues.length)throw failure('BILI_FILE_EMPTY','parse');return cues;
}

// Resolve only the selected current-player metadata track. Renew it once if
// its signed file URL expires; never substitute another language or source.
export async function loadBilibiliSubtitle({selector,prepare,verify,headers=async()=>{},fetchFile=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=18000,requestTimeoutMs=5000}){
 const deadline=now()+timeoutMs;
 const bounded=async(task,stage)=>{
  const left=deadline-now();if(left<=0)throw failure('BILI_TIMEOUT',stage);
  let timer;try{return await Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('BILI_TIMEOUT',stage)),left);})]);}finally{clearTimeout(timer);}
 };
 let caption,renew=false;
 for(let attempt=0;attempt<2;attempt++){
  try{
   if(!caption)caption=await bounded(()=>prepare({...selector,captionDeadline:deadline,refreshBilibiliSource:renew}),'list');
   if(!trusted(caption?.url))throw failure('BILI_SOURCE_REJECTED','file');
   await bounded(()=>headers(caption.url),'file');
   let response,raw;
   try{
    const signal=AbortSignal.timeout(Math.max(1,Math.min(requestTimeoutMs,deadline-now())));
    response=await bounded(()=>fetchFile(caption.url,{credentials:'include',cache:'no-store',signal}),'file');
    if(!response.ok)throw failure('BILI_FILE_HTTP','file',{status:response.status,retryable:response.status===429||response.status>=500||[401,403,404,410].includes(response.status)});
    if(!trusted(response.url||caption.url))throw failure('BILI_SOURCE_REJECTED','file');
    raw=await bounded(()=>response.text(),'file');
   }catch(error){
    if(typeof error?.code==='string')throw error;
    throw failure(error?.name==='TimeoutError'||error?.name==='AbortError'?'BILI_TIMEOUT':'BILI_FILE_NETWORK','file',{retryable:true});
   }
   if(!raw.trim())throw failure('BILI_FILE_EMPTY','file',{retryable:true});
   const cues=parseBilibiliSubtitle(raw,Number(caption.duration)||0);
   const result=await bounded(()=>verify(caption,deadline),'verify');
   if(!result?.verified)throw failure('SOURCE_CHANGED','verify');
   return {cues,language:caption.language,automatic:!!caption.automatic,source:'Bilibili 字幕檔'};
  }catch(caught){
   const error=typeof caught?.code==='string'?caught:failure('BILI_CONTEXT_LOST','context');
   if(attempt===1||!error?.retryable||deadline-now()<350)throw error;
   if(error.code==='BILI_FILE_HTTP'&&[401,403,404,410].includes(error.status)||error.code==='BILI_FILE_EMPTY'){caption=null;renew=true;}
   await sleep(Math.min(300,deadline-now()));
  }
 }
}
