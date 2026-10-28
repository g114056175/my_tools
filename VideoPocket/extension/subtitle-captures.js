import {classifyFailure} from './diagnostics.js';
export const CAPTURE_PREFIX='subtitleCapture:';
export const CAPTURE_VERSION=4;
const encoder=new TextEncoder();

export async function digest(value){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(String(value)));
 return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export function captureScope(tabId,page,mediaIndex=0){
 const platform=page?.platform || {},video=page?.videos?.[mediaIndex] || {};
 const hostRoute=platform.site==='bilibili'
  ? ['bilibili',platform.bvid,platform.cid,platform.page].join('|')
  : platform.site==='youtube'
   ? ['youtube',platform.id].join('|')
   : (()=>{try{const u=new URL(page?.url);return u.origin+u.pathname+u.search;}catch{return String(page?.url || '');}})();
 const media=platform.site==='bilibili'?hostRoute:page?.media?.mediaKey ?? video.url ?? video.downloadUrl ?? mediaIndex;
 return digest(JSON.stringify([Number(tabId),page?.documentId || '',hostRoute,String(media),Number(mediaIndex)||0]));
}

export async function captureKey(tabId,scope,track){
 const identity=[String(scope),String(track?.trackId || ''),String(track?.pageSource || ''),String(track?.pageTrackId || ''),String(track?.pageLanguage || track?.language || ''),!!track?.automatic];
 return CAPTURE_PREFIX+Number(tabId)+':'+await digest(JSON.stringify(identity));
}

export function captureTrack(track){
 const fields=['trackId','language','name','automatic','custom','default','active','nativeLanguage','pageSource','pageLanguage','pageTrackId','pageTrackIndex','captionName','apiTrackId','rawLanguage','bvid','cid','page','explicitPage'];
 return Object.fromEntries(fields.filter(key=>track?.[key]!==undefined).map(key=>[key,track[key]]));
}

export function createSubtitleCaptureManager({storage,read,now=Date.now,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),retryDelays=[350,900,1800,3000]}){
 const pending=new Map(),tabGenerations=new Map();let writes=Promise.resolve(),sessionGeneration=0;
 const current=(tabId,generation,session)=>sessionGeneration===session&&(tabGenerations.get(Number(tabId))||0)===generation;
 const put=async(key,value,generation,session)=>{
  const operation=writes.catch(()=>{}).then(async()=>{
   if(!current(value.tabId,generation,session))return;
   const all=await storage.get(null);
   if(!current(value.tabId,generation,session))return;
   const records=Object.entries(all).filter(([name])=>name.startsWith(CAPTURE_PREFIX));
   await storage.set({[key]:value});
   if(!current(value.tabId,generation,session))return;

   const completed=records.filter(([name,record])=>name!==key&&record?.state==='complete');
   const remove=new Set();
   if(value.state==='complete'){
    for(const [name] of completed)remove.add(name);
   }else{
    const keep=completed.sort((a,b)=>(b[1].finishedAt||b[1].startedAt||0)-(a[1].finishedAt||a[1].startedAt||0))[0]?.[0];
    for(const [name] of completed)if(name!==keep)remove.add(name);
   }
   if(value.state==='failed')for(const [name,record] of records)if(name!==key&&name.startsWith(CAPTURE_PREFIX+Number(value.tabId)+':')&&record?.state==='failed')remove.add(name);
   if(remove.size){
    const previous=Object.fromEntries(records.filter(([name])=>remove.has(name)));
    await storage.remove([...remove]);
    if(!current(value.tabId,generation,session)){
     if(sessionGeneration===session&&(tabGenerations.get(Number(value.tabId))||0)!==generation){
      const restore=Object.fromEntries(Object.entries(previous).filter(([,record])=>Number(record?.tabId)!==Number(value.tabId)));
      if(Object.keys(restore).length)await storage.set(restore).catch(()=>{});
     }
    }
   }
  });
  writes=operation.catch(()=>{});return operation;
 };
 return {
  get(key){return storage.get(key).then(values=>values[key] || null);},
  async forTab(tabId,scope){
   const all=await storage.get(null),prefix=CAPTURE_PREFIX+Number(tabId)+':';
   return Object.entries(all).filter(([key,record])=>key.startsWith(prefix)&&record?.version===CAPTURE_VERSION&&record.scope===scope).map(([key,record])=>({key,...record}));
  },
  removeTab(tabId){
    const id=Number(tabId);tabGenerations.set(id,(tabGenerations.get(id)||0)+1);
    const prefix=CAPTURE_PREFIX+id+':';
    for(const key of pending.keys())if(key.startsWith(prefix))pending.delete(key);
    const operation=writes.catch(()=>{}).then(async()=>{const all=await storage.get(null);await storage.remove(Object.keys(all).filter(key=>key.startsWith(prefix)));});
   writes=operation.catch(()=>{});return operation;
  },
  clearAll(){
   sessionGeneration++;
    pending.clear();
   const operation=writes.catch(()=>{}).then(async()=>{const all=await storage.get(null);await storage.remove(Object.keys(all).filter(key=>key.startsWith(CAPTURE_PREFIX)));});
   writes=operation.catch(()=>{});return operation;
  },
  start(request){
   const key=String(request?.key || ''),tabId=Number(request?.tabId);
   if(!Number.isInteger(tabId)||tabId<0||!key.startsWith(CAPTURE_PREFIX+tabId+':'))return Promise.reject(Object.assign(new Error('字幕擷取工作無效'),{code:'SUBTITLE_UNAVAILABLE'}));
   if(pending.has(key))return pending.get(key);
   const generation=tabGenerations.get(tabId)||0,session=sessionGeneration;
   const task=(async()=>{
    const startedAt=now(),base={version:CAPTURE_VERSION,scope:String(request.scope),tabId,state:'running',startedAt,track:captureTrack(request.track)};
    await put(key,base,generation,session).catch(()=>{});
    try{
     let result;const delays=request.platform==='bilibili'||request.selector?.pageSource==='bilibili-api'?[]:retryDelays;
     for(let attempt=0;attempt<=delays.length;attempt++){
      try{result=await read(request);if(!result?.cues?.length)throw Object.assign(new Error('SUBTITLE_UNAVAILABLE'),{code:'SUBTITLE_UNAVAILABLE'});break;}
      catch(error){const code=String(error?.code || error?.message || ''),retryable=['SUBTITLE_UNAVAILABLE','SUBTITLE_SOURCE_UNAVAILABLE','SUBTITLE_MISMATCH','NETWORK_FAILURE','NETWORK_TIMEOUT','HTTP_RATE_LIMIT','HTTP_SERVER'].includes(code);if(!retryable||attempt>=delays.length)throw error;await sleep(delays[attempt]);}
     }
     const value={...result,trackId:request.track.trackId};
     const record={...base,state:'complete',finishedAt:now(),value};
     try{await put(key,record,generation,session);}catch{
      const cleanup=writes.catch(()=>{}).then(async()=>{
       if(!current(tabId,generation,session))return;
       const saved=await storage.get(key);
       if(current(tabId,generation,session)&&saved[key]?.state==='running')await storage.remove(key);
      });
      writes=cleanup.catch(()=>{});await cleanup.catch(()=>{});
     }
     return value;
    }catch(error){
     const failureDetail=classifyFailure(error,'subtitle'),failureCode=failureDetail.code;
     await put(key,{...base,state:'failed',finishedAt:now(),failureCode,failureDetail},generation,session).catch(()=>{});
     throw error;
    }
   })();
   pending.set(key,task);
   task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});
   return task;
  }
 };
}
