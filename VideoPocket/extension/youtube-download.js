import {SabrStream,VideoPlaybackAbrRequest} from './vendor/sabr.js';
let SabrStreamImpl=SabrStream;
const DEFAULT_BODY_READ_TIMEOUT_MS=20_000,MAX_PAUSE_CHECK_MS=250;
export function setSabrStreamForTests(value){SabrStreamImpl=value || SabrStream;}
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const from64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
function bodyReadTimeoutError(){return Object.assign(new Error('YouTube 串流讀取逾時'),{name:'TimeoutError',code:'NETWORK_TIMEOUT',sourceStage:'stream-segment'});}
function isPausedValue(isPaused){try{return isPaused?.()===true;}catch{return false;}}
function readBodyChunk(reader,signal,timeoutMs,isPaused){
 return new Promise((resolve,reject)=>{
  const pauseCheckMs=Math.min(MAX_PAUSE_CHECK_MS,Math.max(1,timeoutMs/4));
  let timer,settled=false,remaining=timeoutMs,activeSince=isPausedValue(isPaused)?null:performance.now();
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const settle=(fn,value)=>{if(settled)return;settled=true;cleanup();fn(value);};
  const abort=()=>settle(reject,signal.reason || new DOMException('已取消','AbortError'));
  const schedule=delay=>{timer=setTimeout(tick,Math.max(0,delay));};
  const tick=()=>{
   if(settled)return;
   if(signal?.aborted){abort();return;}
   const now=performance.now();
   if(isPausedValue(isPaused)){
    if(activeSince!==null){remaining=Math.max(0,remaining-(now-activeSince));activeSince=null;}
    schedule(pauseCheckMs);return;
   }
   if(activeSince===null)activeSince=now;
   const left=remaining-(now-activeSince);
   if(left<=0){settle(reject,bodyReadTimeoutError());return;}
   schedule(Math.min(pauseCheckMs,left));
  };
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  if(typeof isPaused==='function')schedule(pauseCheckMs);
  else schedule(remaining);
  Promise.resolve().then(()=>reader.read()).then(value=>settle(resolve,value),error=>settle(reject,error));
 });
}
function wrapBodyWithReadTimeout(response,signal,requestController,timeoutMs,isPaused){
 if(!response?.body?.getReader)return response;
 const reader=response.body.getReader();let closed=false;
 const cancelReader=reason=>{void reader.cancel(reason).catch(()=>{}).finally(()=>{try{reader.releaseLock();}catch{}});};
 const body=new ReadableStream({
  async pull(controller){
   if(closed)return;
   try{
    const packet=await readBodyChunk(reader,signal,timeoutMs,isPaused);
    if(closed)return;
    if(signal?.aborted)throw signal.reason || new DOMException('已取消','AbortError');
    if(packet.done){closed=true;reader.releaseLock();controller.close();return;}
    controller.enqueue(packet.value);
   }catch(error){
    if(!closed){closed=true;
     if(error?.code==='NETWORK_TIMEOUT'&&!requestController.signal.aborted)requestController.abort(error);
     cancelReader(error);controller.error(error);
    }
   }
  },
  async cancel(reason){
   if(closed)return;closed=true;
   if(!requestController.signal.aborted)requestController.abort(reason);
   await reader.cancel(reason).catch(()=>{});try{reader.releaseLock();}catch{}
  }
 },{highWaterMark:0});
 return new Proxy(response,{get(target,key){if(key==='body')return body;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
export function assertComplete(format,expectedMs){
 const metadata=format?.formatInitializationMetadata,segments=format?.downloadedSegments;
 if(!metadata||!segments?.size)throw new Error('YouTube 未提供完整影音資料');
 const end=Number(metadata.endSegmentNumber);
 if(!Number.isSafeInteger(end)||end<0||end>100000)throw new Error('YouTube 片段資訊不完整');
 for(let i=0;i<=end;i++)if(!segments.has(i))throw new Error('YouTube 影音片段不完整，未儲存檔案');
 const duration=[...segments.values()].reduce((n,s)=>n+(Number(s.durationMs)||0),0),timescale=Number(metadata.durationTimescale);
 const expected=timescale?Number(metadata.durationUnits)/timescale*1000:expectedMs;
 if(expected>0&&Math.abs(duration-expected)>Math.max(300,expected*0.01))throw new Error('YouTube 影音長度不完整，未儲存檔案');
}
function formatKey(format){return format.itag+'|'+(format.xtags || '');}
function rangeError(message){const error=new Error(message);error.code='YOUTUBE_RANGE_INCOMPLETE';return error;}
export function assertRangeComplete(format,rangeMs,expectedEndMs){
 const metadata=format?.formatInitializationMetadata,segments=format?.downloadedSegments;
 if(!metadata||!segments?.size)throw rangeError('YouTube 區間缺少初始化或影音片段');
 const init=[...segments.entries()].find(([,s])=>s.mediaHeader?.isInitializationSegment);
 if(!init||!format.consumedSegments?.has(init[0]))throw rangeError('YouTube 區間缺少已寫入的初始化資料');
 const media=[...segments.values()].filter(s=>format.consumedSegments.has(s.segmentNumber)&&!s.mediaHeader?.isInitializationSegment).sort((a,b)=>a.segmentNumber-b.segmentNumber);
 if(!media.length)throw rangeError('YouTube 區間沒有影音片段');
 const first=media[0],last=media[media.length-1],tolerance=5;
 if(first.startTimeMs>rangeMs.startMs+tolerance || last.endTimeMs<expectedEndMs-tolerance)
  throw rangeError('YouTube 影音片段未覆蓋要求區間');
 for(let i=1;i<media.length;i++){
  if(media[i].segmentNumber!==media[i-1].segmentNumber+1 || media[i].startTimeMs>media[i-1].endTimeMs+tolerance)
   throw rangeError('YouTube 區間影音片段不連續');
 }
 return {startTimeMs:first.startTimeMs,endTimeMs:last.endTimeMs};
}
export async function downloadYoutube(source,plan,signal,onBytes,getSession,request,createSink,range,{bodyReadTimeoutMs=DEFAULT_BODY_READ_TIMEOUT_MS,isPaused}={}){
 const capture=await getSession(source.descriptor);
 if(!capture)throw Object.assign(new Error('YouTube playback session is not ready'),{code:'YOUTUBE_SESSION_UNAVAILABLE',sourceStage:'youtube-session'});
 const seed=VideoPlaybackAbrRequest.decode(from64(capture.body)),context=seed.streamerContext;
 const durationMs=source.duration*1000,formats=source.formats,video=plan.video || formats.find(f=>f.videoCodec),audio=plan.audio || formats.find(f=>f.audioCodec&&!f.videoCodec);
 if(!video||!audio)throw new Error('YouTube 未提供所選影音來源');
 const rangeMs=range==null?null:{startMs:Number(range.start)*1000,endMs:Number(range.end)*1000};
 if(rangeMs&&(!Number.isFinite(rangeMs.startMs)||!Number.isFinite(rangeMs.endMs)||rangeMs.startMs<0||rangeMs.endMs<=rangeMs.startMs||rangeMs.endMs>durationMs))
  throw new Error('YouTube 區間無效');
 const initialized=new Map();let streamFailure,rangeReached=false;
 const timeoutMs=Number.isFinite(Number(bodyReadTimeoutMs))&&Number(bodyReadTimeoutMs)>=0?Number(bodyReadTimeoutMs):DEFAULT_BODY_READ_TIMEOUT_MS;
 const stream=new SabrStreamImpl({videoId:source.descriptor.platform.id,serverAbrStreamingUrl:capture.url,videoPlaybackUstreamerConfig:base64(seed.videoPlaybackUstreamerConfig),clientInfo:context.clientInfo,poToken:context.poToken?.length?base64(context.poToken):undefined,formats,
  fetchFunction:async(url,options={})=>{
   const requestController=new AbortController(),requestSignal=AbortSignal.any([signal,options.signal || signal,requestController.signal]);
   try{
    const response=await request(url,{...options,sourceStage:'stream-segment',credentials:'include',signal:requestSignal,headers:{...options.headers,'content-type':'application/x-www-form-urlencoded'}});
    return wrapBodyWithReadTimeout(response,requestSignal,requestController,timeoutMs,isPaused);
   }catch(error){if(!requestController.signal.aborted)requestController.abort(error);throw error;}
  }});
 // Preserve the browser's session fields; download progress belongs to our own
 // HTTP session and has no connection to the page's currentTime or playback.
 const build=stream.buildRequestBody.bind(stream);
 stream.buildRequestBody=(...args)=>{
  const body=VideoPlaybackAbrRequest.decode(build(...args));
  for(const key of ['field6','serverStitchedDaiInfo','field1000'])body[key]=seed[key];
  for(const key of ['field4','field7','field8'])body.streamerContext[key]=context[key];
  if(!body.streamerContext.playbackCookie)body.streamerContext.playbackCookie=context.playbackCookie;
  const types=new Set(body.streamerContext.sabrContexts.map(c=>c.type));
  body.streamerContext.sabrContexts.push(...(context.sabrContexts || []).filter(c=>!types.has(c.type)));
  return VideoPlaybackAbrRequest.encode(body).finish();
 };
 const requiredFormats=plan.video?[video,audio]:[audio];
 const rangeComplete=()=>rangeMs&&requiredFormats.every(format=>{try{assertRangeComplete(initialized.get(formatKey(format)),rangeMs,rangeMs.endMs);return true;}catch{return false;}});
 const reconcileConsumed=saved=>{while(saved.pendingBytes.length){const pending=[...saved.downloadedSegments.entries()].find(([,s])=>!saved.consumedSegments.has(s.segmentNumber));if(!pending)break;const [number,segment]=pending,length=saved.pendingBytes[0],expected=Number(segment.mediaHeader?.segmentLengthBytes||0);if(expected>0&&expected!==length)throw rangeError('YouTube 影音片段寫入長度不符');saved.pendingBytes.shift();saved.consumedSegments.add(number);}};
 const captureTrack=track=>{if(!track?.formatId)return;const key=formatKey(track.formatId);let saved=initialized.get(key);if(!saved){saved={formatInitializationMetadata:{formatId:track.formatId},downloadedSegments:new Map(),consumedSegments:new Set(),pendingBytes:[]};initialized.set(key,saved);}
  Object.assign(saved.formatInitializationMetadata,{endSegmentNumber:track.endSegmentNum,durationUnits:track.endTimeMs,durationTimescale:1000});for(const [number,segment] of track.trackedSegments)saved.downloadedSegments.set(number,segment);
  reconcileConsumed(saved);
  if(rangeComplete()&&!rangeReached){rangeReached=true;stream.abort();}
 };
 const noteConsumed=(format,length)=>{if(!rangeMs)return;const saved=initialized.get(formatKey(format));if(!saved)return;
  saved.pendingBytes.push(length);reconcileConsumed(saved);if(rangeComplete()&&!rangeReached){rangeReached=true;stream.abort();}
 };
 stream.on('formatInitialization',captureTrack);
 stream.on('trackStateUpdate',collection=>{captureTrack(collection.video);captureTrack(collection.audio);});
 stream.on('streamProtectionStatusUpdate',status=>{if(status.status===3){streamFailure=new Error('YouTube 未提供有效的串流驗證，無法完成下載');stream.abort();}});
 const abort=()=>stream.abort();signal.addEventListener('abort',abort,{once:true});
 let total=0;
 const collect=async (readable,format,keep)=>{
  const reader=readable.getReader(),chunks=createSink?null:[],sink=keep&&createSink?await createSink(format):null;let size=0;
  try{
   while(true){
    if(signal.aborted)throw new Error('已取消');
    let packet;try{packet=await reader.read();}catch(error){if(rangeReached&&!signal.aborted)break;throw error;}
    const {value,done}=packet;if(done)break;if(!keep)continue;
    const bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    if(sink)await sink.append(bytes);else chunks?.push(bytes);
    size+=bytes.length;total+=bytes.length;noteConsumed(format,bytes.length);onBytes(bytes.length);
   }
   if(streamFailure)throw streamFailure;if(signal.aborted)throw new Error('已取消');if(!keep)return null;
   const saved=initialized.get(formatKey(format)),rangeInfo=rangeMs?assertRangeComplete(saved,rangeMs,rangeMs.endMs):null;
   if(!rangeMs)assertComplete(saved,durationMs);
   const timing=rangeInfo?{cutOffset:rangeInfo.startTimeMs/1000,startTimeMs:rangeInfo.startTimeMs,endTimeMs:rangeInfo.endTimeMs,requestedStartMs:rangeMs.startMs,requestedEndMs:rangeMs.endMs}:{};
   if(sink)return {format,...await sink.finish(),...timing};
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
   return {format,bytes,...timing};
  }catch(error){if(sink)await sink.abort().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
 };
 try{
  if(signal.aborted)throw new Error('已取消');
  const {videoStream,audioStream}=stream.start({videoFormat:plan.video?video:undefined,audioFormat:audio,enabledTrackTypes:plan.video?0:1,isPostLiveDvr:false,maxRetries:4,stallDetectionMs:30000,...(rangeMs?{startTimeMs:rangeMs.startMs}:{})});
  return (await Promise.all([collect(videoStream,video,!!plan.video),collect(audioStream,audio,true)])).filter(Boolean);
 }catch(error){stream.abort();if(signal.aborted)throw new Error('已取消');if(streamFailure)throw streamFailure;if(/attestation/i.test(error.message))throw new Error('YouTube 未提供有效的串流驗證，無法完成下載');throw error;}
 finally{signal.removeEventListener('abort',abort);}
}
