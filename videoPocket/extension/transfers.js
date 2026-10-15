// Direct file transfer with verified HTTP ranges. No page or player controls.
export const MAX_TRANSFER_BYTES=Infinity;
function rangeInfo(response){const m=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);return m?{start:Number(m[1]),end:Number(m[2]),total:Number(m[3])}:null;}
async function read(response,signal,limit,onBytes=()=>{}){
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){if(signal.aborted)throw signal.reason || new Error('已取消');const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('來源檔案超過可處理的大小');parts.push(value);onBytes(value.length);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;
}
async function streamToFile(response,signal,sink,onBytes){const reader=response.body.getReader();let size=0;await sink.truncate(0);try{while(true){if(signal.aborted)throw signal.reason;const {value,done}=await reader.read();if(done)break;size+=value.length;await sink.append(value);onBytes(value.length);}const expected=Number(response.headers.get('content-length'));if(expected>0&&!response.headers.get('content-encoding')&&size!==expected)throw new Error('來源檔案長度不完整');return await sink.finish();}catch(error){await reader.cancel().catch(()=>{});throw error;}}
export async function directTransfer(format,request,signal,onBytes=()=>{},sink,control){
 const run=operation=>control?control.run(operation):operation(signal);
 const urls=[...new Set([format.url,...(format.backupUrls || [])])].filter(Boolean);if(!urls.length)throw new Error('來源網址已失效');
 // A small, bounded probe measures available routes and supplies exact length.
 // It runs once per input file; successful prefix bytes are reused.
 const probeControllers=[],ready=[];
 const probes=urls.slice(0,3).map(async url=>{
  const controller=new AbortController();probeControllers.push(controller);
  const started=performance.now(),probeSignal=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(5000)]);
  const response=await request(url,{signal:probeSignal,headers:{Range:'bytes=0-65535'}}),range=rangeInfo(response);
  if(response.status!==206||!range||range.start!==0||range.end>=range.total){await response.body?.cancel();ready.push({url,ranged:false});throw new Error('來源未支援檔案範圍');}
  const prefix=await read(response,probeSignal,65536);if(prefix.length!==range.end+1)throw new Error('來源片段長度不完整');
  const result={url,ranged:true,range,prefix,elapsed:performance.now()-started};ready.push(result);return result;
 });
 let selected;try{selected=await Promise.any(probes);}catch{}
 // The first fully verified prefix wins. A dead backup must not delay a fast CDN.
 if(selected)for(const controller of probeControllers)controller.abort();
 if(signal.aborted)throw signal.reason || new Error('已取消');
 if(!selected){let last;for(const url of [...ready.map(r=>r.url),...urls.filter(u=>!ready.some(r=>r.url===u))])try{return await run(async attemptSignal=>{const response=await request(url,{signal:AbortSignal.any([attemptSignal,AbortSignal.timeout(20000)])});return sink?await streamToFile(response,attemptSignal,sink,onBytes):await read(response,attemptSignal,MAX_TRANSFER_BYTES,onBytes);});}catch(error){last=error;if(signal.aborted)throw error;}throw last || new Error('來源下載失敗');}
 const total=selected.range.total,output=sink?null:new Uint8Array(total);if(sink)await sink.writeAt(selected.prefix,0);else output.set(selected.prefix);onBytes(selected.prefix.length);
 const chunkSize=2*1024*1024,parts=[];for(let start=selected.prefix.length;start<total;start+=chunkSize)parts.push({start,end:Math.min(total-1,start+chunkSize-1)});
 const candidates=[selected.url,...urls.filter(url=>url!==selected.url)];let cursor=0,hedges=0;
 const partBytes=async (part,url,controller,attemptSignal=signal)=>{
  const partSignal=AbortSignal.any([attemptSignal,controller.signal,AbortSignal.timeout(20000)]),response=await request(url,{signal:partSignal,headers:{Range:`bytes=${part.start}-${part.end}`}}),range=rangeInfo(response);
  if(response.status!==206||!range||range.total!==total||range.start!==part.start||range.end!==part.end){await response.body?.cancel();throw new Error('來源未提供正確的檔案範圍');}
  const data=await read(response,partSignal,part.end-part.start+1);if(data.length!==part.end-part.start+1)throw new Error('來源片段長度不完整');return data;
 };
 await Promise.all(Array.from({length:Math.min(4,parts.length)},async()=>{while(cursor<parts.length){const part=parts[cursor++];const data=await run(async attemptSignal=>{const controllers=[],controller=new AbortController();controllers.push(controller);let data,failure,timer,startBackup;
  try{
   const primary=partBytes(part,candidates[0],controller,attemptSignal);
   // A CDN can answer the small probe quickly but stall on larger ranges.
   // At most two competing backup requests per file run at the same time.
   if(candidates.length>1){const backup=new Promise((resolve,reject)=>{startBackup=()=>{if(!startBackup)return;if(signal.aborted){startBackup=null;reject(signal.reason);return;}if(hedges>=2){timer=setTimeout(()=>startBackup?.(),200);return;}startBackup=null;clearTimeout(timer);hedges++;const c=new AbortController();controllers.push(c);partBytes(part,candidates[1],c,attemptSignal).then(resolve,reject).finally(()=>hedges--);};timer=setTimeout(()=>startBackup?.(),1200);});primary.catch(()=>startBackup?.());data=await Promise.any([primary,backup]);}
   else data=await primary;
  }catch(error){failure=error;}
  finally{clearTimeout(timer);startBackup=null;for(const c of controllers)c.abort();}
  if(signal.aborted)throw signal.reason || new Error('已取消');
  if(!data)for(const url of candidates.slice(1))try{data=await partBytes(part,url,new AbortController(),attemptSignal);break;}catch(error){failure=error;if(signal.aborted)throw error;}
  if(!data)throw failure || new Error('來源片段下載失敗');return data;});if(sink)await sink.writeAt(data,part.start);else output.set(data,part.start);onBytes(data.length);
 }}));return sink?await sink.finish():output;
}
