import {SabrStream,VideoPlaybackAbrRequest} from './vendor/sabr.js';
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
export async function downloadYoutube(source,plan,signal,onBytes,getSession,request,createSink){
 const capture=await getSession(source.descriptor);
 if(!capture)throw new Error('尚未取得 YouTube 串流來源，請重新整理影片頁面');
 const seed=VideoPlaybackAbrRequest.decode(from64(capture.body)),context=seed.streamerContext;
 const durationMs=source.duration*1000,formats=source.formats,video=plan.video || formats.find(f=>f.videoCodec),audio=plan.audio || formats.find(f=>f.audioCodec&&!f.videoCodec);
 if(!video||!audio)throw new Error('YouTube 未提供所選影音來源');
 const initialized=new Map();let streamFailure;
 const stream=new SabrStream({videoId:source.descriptor.platform.id,serverAbrStreamingUrl:capture.url,videoPlaybackUstreamerConfig:base64(seed.videoPlaybackUstreamerConfig),clientInfo:context.clientInfo,poToken:context.poToken?.length?base64(context.poToken):undefined,formats,
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
 const captureTrack=track=>{if(!track.formatId)return;const key=track.formatId.itag+'|'+(track.formatId.xtags || '');let saved=initialized.get(key);if(!saved){saved={formatInitializationMetadata:{formatId:track.formatId},downloadedSegments:new Map()};initialized.set(key,saved);}
  Object.assign(saved.formatInitializationMetadata,{endSegmentNumber:track.endSegmentNum,durationUnits:track.endTimeMs,durationTimescale:1000});for(const [number,segment] of track.trackedSegments)saved.downloadedSegments.set(number,segment);
 };
 stream.on('formatInitialization',captureTrack);
 stream.on('trackStateUpdate',collection=>{captureTrack(collection.video);captureTrack(collection.audio);});
 stream.on('streamProtectionStatusUpdate',status=>{if(status.status===3){streamFailure=new Error('YouTube 未提供有效的串流驗證，無法完成下載');stream.abort();}});
 const abort=()=>stream.abort();signal.addEventListener('abort',abort,{once:true});
 let total=0;
 const collect=async (readable,format,keep)=>{
  const reader=readable.getReader(),chunks=createSink?null:[],sink=keep&&createSink?await createSink(format):null;let size=0;
  try{
  while(true){if(signal.aborted)throw new Error('已取消');const {value,done}=await reader.read();if(done)break;if(!keep)continue;
   const bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);total+=bytes.length;size+=bytes.length;if(sink)await sink.append(bytes);else chunks?.push(bytes);onBytes(bytes.length);
  }
  if(streamFailure)throw streamFailure;if(!keep)return null;
  assertComplete(initialized.get(format.itag+'|'+(format.xtags || '')),durationMs);if(sink)return {format,...await sink.finish()};
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return {format,bytes};
  }catch(error){if(sink)await sink.abort();throw error;}
 };
 try{
  if(signal.aborted)throw new Error('已取消');
  const {videoStream,audioStream}=stream.start({videoFormat:plan.video?video:undefined,audioFormat:audio,enabledTrackTypes:plan.video?0:1,isPostLiveDvr:false,maxRetries:4,stallDetectionMs:30000});
  return (await Promise.all([collect(videoStream,video,!!plan.video),collect(audioStream,audio,true)])).filter(Boolean);
 }catch(error){stream.abort();if(signal.aborted)throw new Error('已取消');if(streamFailure)throw streamFailure;if(/attestation/i.test(error.message))throw new Error('YouTube 未提供有效的串流驗證，無法完成下載');throw error;}
 finally{signal.removeEventListener('abort',abort);}
}
