import {SabrStream,VideoPlaybackAbrRequest} from './vendor/sabr.js';
let SabrStreamImpl=SabrStream;
export function setSabrStreamForTests(value){SabrStreamImpl=value || SabrStream;}
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const from64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
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
export async function downloadYoutube(source,plan,signal,onBytes,getSession,request,createSink,range){
 const capture=await getSession(source.descriptor);
 if(!capture)throw new Error('尚未取得 YouTube 串流來源，請重新整理影片頁面');
 const seed=VideoPlaybackAbrRequest.decode(from64(capture.body)),context=seed.streamerContext;
 const durationMs=source.duration*1000,formats=source.formats,video=plan.video || formats.find(f=>f.videoCodec),audio=plan.audio || formats.find(f=>f.audioCodec&&!f.videoCodec);
 if(!video||!audio)throw new Error('YouTube 未提供所選影音來源');
 const rangeMs=range==null?null:{startMs:Number(range.start)*1000,endMs:Number(range.end)*1000};
 if(rangeMs&&(!Number.isFinite(rangeMs.startMs)||!Number.isFinite(rangeMs.endMs)||rangeMs.startMs<0||rangeMs.endMs<=rangeMs.startMs||rangeMs.endMs>durationMs))
  throw new Error('YouTube 區間無效');
 const initialized=new Map();let streamFailure,rangeReached=false;
 const stream=new SabrStreamImpl({videoId:source.descriptor.platform.id,serverAbrStreamingUrl:capture.url,videoPlaybackUstreamerConfig:base64(seed.videoPlaybackUstreamerConfig),clientInfo:context.clientInfo,poToken:context.poToken?.length?base64(context.poToken):undefined,formats,
  fetchFunction:(url,options={})=>request(url,{...options,credentials:'include',signal:AbortSignal.any([signal,options.signal || signal,AbortSignal.timeout(20000)]),headers:{...options.headers,'content-type':'application/x-www-form-urlencoded'}})});
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
