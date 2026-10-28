import {HlsParser,parseDash} from './vendor/parsers.js';
import {mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs,qualityOfFormat} from './browser-media.js';
import {parseSubtitles} from './subtitles.js';
import {directTransfer} from './transfers.js';
import {downloadYoutube} from './youtube-download.js';
import {prepareWebmFragment} from './webm-fragment.js';
import {createYoutubeSourceSessions} from './youtube-source-session.js';
import {inspectionReuseKey,inspectionReusable} from './inspection-reuse.js';
import {createSourceRetention} from './source-retention.js';
import './disk-media.js';
import './indexed-mp4-download.js';
import './destinations.js';
import {TransferControl} from './transfer-control.js';
import {classifyFailure} from './diagnostics.js';
import {createProcessingWatchdog} from './processing-watchdog.js';
import {resolveAnime1} from './anime1.js';
import {mediaCredentials} from './media-credentials.js';
import {parseTransportStreamCodecs} from './transport-stream.js';
import {readMp4Metadata} from './mp4-metadata.js';
import {createTransferProgress} from './transfer-progress.js';
import {decryptHlsSample,hlsIv} from './hls-sample.js';
import {assembleSegments} from './ordered-segments.js';
import {twitchVodManifest} from './twitch-adapter.js';
import {twitchClipManifest,tokenizedTwitchClipUrl} from './twitch-clips.js';
import {socialPageResponse} from './social-page-fetch.js';
import {resolveDailymotion} from './dailymotion.js';
import {resolveLinkedMedia} from './linked-media.js';
import {normalizeRange,planSegmentRange,parseSidx,planIndexedRange,coalesceIndexedSegments} from './media-range.js';
import {createIndexedRoutes} from './indexed-routes.js';
import {parseByteRange as byteRange,rangeCapability,formatRangeCapability} from './range-capability.js';
import {createMediaTransfer} from './media-transfer.js';
import {resolveNetworkCandidates,prioritizeMediaVersions} from './source-candidates.js';
import {platformSource} from './platform-formats.js';
import {fullCutPolicy} from './full-cut-policy.js';
import {validateMediaRecovery} from './media-recovery.js';
import {sharedHttpRequestPolicy,parseRetryAfter} from './http-resilience.js';
import {createMediaRangeVersions} from './media-range-versions.js';
const disk=globalThis.VideoPocketDiskMedia;
const startupCleanup=disk.removeMediaFiles().catch(()=>{});

const sources=new Map(),controllers=new Map(),controls=new Map(),blobs=new Map();
const youtubeSourceSessions=createYoutubeSourceSessions();
const sourceRetention=createSourceRetention({sources,now:()=>Date.now(),setTimer:setTimeout,clearTimer:clearTimeout,onExpire:entries=>{
 youtubeSourceSessions.retainSources([...sources.values()].map(source=>source.descriptor));
 return rpc('sourcesExpired',{sourceIds:entries.map(([id])=>id)});
}});
const inspections=new Map(),cancelledInspections=new Set();
const cancelledDownloads=new Set(),downloadsInFlight=new Set();
function runDownload(message){const task=download(message).catch(error=>{const source=sources.get(message.sourceId);if(source&&classifyFailure(error).code!=='CANCELLED')source.inspectionKey='';throw error;});downloadsInFlight.add(task);task.finally(()=>downloadsInFlight.delete(task)).catch(()=>{});return task;}
function cancelDownload(id){const controller=controllers.get(id);if(controller)controller.abort(Object.assign(new Error('已取消'),{code:'CANCELLED',userCancelled:true}));else{cancelledDownloads.add(id);while(cancelledDownloads.size>50)cancelledDownloads.delete(cancelledDownloads.values().next().value);}}
let muxWorker,inspecting=0,sourceInspectionOrder=0;
const rpc=(action,data={})=>chrome.runtime.sendMessage({target:'background',action,...data}).then(r=>{if(!r?.ok)throw Object.assign(new Error(r?.error || '背景處理失敗'),r?.failure || {});return r.result;});
const reportTimings=(id,timings)=>rpc('performance',{id,timings}).catch(()=>{});
async function request(url,referer,options={}){
 const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error('來源網址無效');
 // Reuse only an exact, recent manifest already read by this Dailymotion
 // document. This does not replay a refused request or cache media segments.
 if(options.sourceStage==='stream-manifest'&&options.pageContext&&/(^|\.)dailymotion\.com$/.test(new URL(referer).hostname)){
  let cached;try{cached=await rpc('observedManifest',{url:u.href,context:options.pageContext});}catch{}
  options.signal?.throwIfAborted();
  if(cached&&typeof cached.text==='string'&&cached.text.length<=512*1024&&(/^\s*#EXTM3U\b/.test(cached.text)||/<MPD\b/i.test(cached.text))){
   const actual=new URL(cached.url);
   if(actual.protocol==='https:'&&!actual.username&&!actual.password&&/(^|\.)(?:dailymotion\.com|dmcdn\.net)$/.test(actual.hostname)){
    const response=new Response(cached.text,{headers:{'content-type':cached.type || 'application/vnd.apple.mpegurl'}});
    Object.defineProperty(response,'url',{value:actual.href});return response;
   }
  }
 }
 await rpc('assetHeaders',{url:u.href,referer});
 // One origin-wide gate also covers probes and hedged requests, which do not
 // always execute inside TransferControl.run(). Wait before request timeouts.
 await sharedHttpRequestPolicy.waitForOrigin(u.origin,options.signal);
 const {pageContext,sourceStage='source-request',...fetchOptions}=options;
 // Media file/segment bodies use the transfer service's no-progress timeout. Manifests,
 // probes and subtitles keep their original whole-request deadline.
 const streamSegment=sourceStage==='stream-segment',headerTimeout=new AbortController(),parentSignal=options.signal;
 parentSignal?.throwIfAborted();
 const signal=parentSignal
  ?AbortSignal.any([parentSignal,headerTimeout.signal, ...(streamSegment?[]:[AbortSignal.timeout(20000)])])
  :streamSegment?headerTimeout.signal:AbortSignal.timeout(20000);
 const timer=streamSegment?setTimeout(()=>headerTimeout.abort(new DOMException('來源回應標頭逾時','TimeoutError')),20000):undefined;
 try { signal.throwIfAborted(); } catch(error) { clearTimeout(timer); throw error; }
 const method=String(options.method || 'GET').toUpperCase()+(options.headers?.Range?' Range':'');
 let res;
 try { res=await fetch(u,{...fetchOptions,signal,credentials:mediaCredentials(u.href,referer)}); }
 catch(error){
  if(timer!==undefined)clearTimeout(timer);
  if(signal.aborted&&signal.reason)throw signal.reason;
  throw error;
 }
 clearTimeout(timer);
 if([401,403].includes(res.status)&&pageContext){
  await res.body?.cancel();
  res=await socialPageResponse(data=>rpc('socialPageFetch',{operation:data.action,options:data.options,context:pageContext}),{url:u.href,referer,context:pageContext,options:{...fetchOptions,signal}});
 }
 if(!res.ok){
  const retryAfter=res.headers.get('retry-after'),retryAfterMs=parseRetryAfter(retryAfter);
  const retryAfterUnsupported=[429,503].includes(res.status)&&/^\d+$/.test(String(retryAfter || '').trim())&&(retryAfterMs===null||!Number.isSafeInteger(Date.now()+retryAfterMs));
  let responseOrigin=u.origin;try{const final=new URL(res.url);if(/^https?:$/.test(final.protocol))responseOrigin=final.origin;}catch{}
  const code=retryAfterUnsupported?'HTTP_RETRY_AFTER_UNSUPPORTED':[401,403].includes(res.status)?'HTTP_AUTH':res.status===429?'HTTP_RATE_LIMIT':[404,410].includes(res.status)?'HTTP_NOT_FOUND':res.status>=500?'HTTP_SERVER':undefined;
  const error=Object.assign(new Error(`來源讀取失敗（HTTP ${res.status}，${method}，${u.hostname}），請重新整理影片`),{code,status:res.status,httpStatus:res.status,sourceStage,requestMethod:method,requestHost:u.hostname,requestOrigin:responseOrigin,...(retryAfterMs!==null?{retryAfterMs}:{}),...(retryAfterUnsupported?{retryAfterUnsupported:true}:{})});
  sharedHttpRequestPolicy.observe(error);if(responseOrigin!==u.origin)sharedHttpRequestPolicy.observe({...error,requestOrigin:u.origin});
  await res.body?.cancel();throw error;
 }return res;
}
request.waitForOrigin=(url,signal)=>sharedHttpRequestPolicy.waitForOrigin(url,signal);
const absolute=(url,base)=>new URL(url,base).href;
function hls(raw,url){const parser=new HlsParser();parser.push(raw);parser.end();const m=parser.manifest;for(const p of m.playlists || [])p.uri=absolute(p.uri,url);for(const s of m.segments || []){s.resolvedUri=absolute(s.uri,url);if(s.map)s.map.resolvedUri=absolute(s.map.uri,url);if(s.key)s.key.resolvedUri=absolute(s.key.uri,url);}return m;}
function protectedPlaylist(p){return !!p.contentProtection || (p.segments || []).some(s=>s.key&&s.key.method!=='NONE'&&s.key.method!=='AES-128');}
function playlistFormat(p,id,kind='video',ext='mp4'){
 const attrs=p.attributes || {},parsed=metadataCodecs(`codecs="${attrs.CODECS || ''}"`),width=kind==='audio'?0:attrs.RESOLUTION?.width || 0,height=kind==='audio'?0:attrs.RESOLUTION?.height || 0;
  return {id,url:p.resolvedUri || p.uri,segments:p.segments,mediaSequence:p.mediaSequence || 0,videoCodec:kind==='audio'?'':parsed.videoCodec || (height?'h264':''),audioCodec:kind==='audio'?parsed.audioCodec || 'aac':parsed.audioCodec,kind,width,height,ext,bitrate:attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'],averageBitrate:Number(attrs['AVERAGE-BANDWIDTH']) || 0,drm:protectedPlaylist(p)};
}
async function manifestSource(url,referer,inlineManifest,signal,pageContext){
 signal?.throwIfAborted();
 const load=async source=>{const response=await request(source,referer,{signal,pageContext,sourceStage:'stream-manifest'});return {raw:await response.text(),url:response.url||source};};
 const loaded=inlineManifest==null?await load(url):{raw:inlineManifest,url};url=loaded.url;
 const raw=loaded.raw,formats=[],tracks=[],declaredAudio=new Set();let duration;
 if(raw.trimStart().startsWith('<')){
  if(/<ContentProtection\b/i.test(raw))throw new Error('此串流含 DRM 保護，未提供下載');
  const m=parseDash(raw,{manifestUri:url});if(!m.endList)throw new Error('目前僅支援已完成的影片串流');duration=m.duration;
  for(const [i,p] of (m.playlists || []).entries())formats.push(playlistFormat(p,'v'+i));
  for(const group of Object.values(m.mediaGroups?.AUDIO || {}))for(const item of Object.values(group))for(const [i,p] of (item.playlists || []).entries())formats.push(playlistFormat(p,'a'+formats.length,'audio'));
  for(const group of Object.values(m.mediaGroups?.SUBTITLES || {}))for(const item of Object.values(group))for(const p of item.playlists || [])tracks.push({language:item.language || 'und',name:item.language || 'Subtitles',url:p.resolvedUri || p.uri,segments:p.segments});
  const adaptations=[...raw.matchAll(/<(?:[\w-]+:)?AdaptationSet\b([^>]*)>/gi)];
  const videoOnly=adaptations.length>0&&adaptations.every(item=>/\bcontentType\s*=\s*["']video["']|\bmimeType\s*=\s*["']video\//i.test(item[1]))&&!/\bcontentType\s*=\s*["']audio["']|\bmimeType\s*=\s*["']audio\//i.test(raw)&&!formats.some(format=>format.audioCodec||format.kind==='audio');
  if(videoOnly)for(const format of formats)format.audioAbsent=true;
 }else{
  const m=hls(raw,url);
  if(m.playlists?.length){
   for(const [i,p] of m.playlists.entries()){const child=await load(p.uri),media=hls(child.raw,child.url);if(!media.endList)continue;const f={...playlistFormat({...p,resolvedUri:child.url,segments:media.segments,mediaSequence:media.mediaSequence},'v'+i,'video','mp4'),duration:media.segments.reduce((n,s)=>n+s.duration,0)};
    // Master CODECS describes the full variant including its external AUDIO
    // rendition. It does not prove that audio is muxed into the video file.
    const group=p.attributes?.AUDIO;if(group)declaredAudio.add(f);if(group&&Object.values(m.mediaGroups?.AUDIO?.[group] || {}).some(item=>item.uri)){f.audioCodec='';f.audioGroup=group;}
    if(!group&&!p.attributes?.VIDEO)f.averageBitrateScope='format';
    else if(f.audioGroup&&!p.attributes?.VIDEO)f.averageBitrateScope='variant';
    formats.push(f);duration ||= f.duration;}
   for(const [audioGroup,group] of Object.entries(m.mediaGroups?.AUDIO || {}))for(const item of Object.values(group)){if(!item.uri)continue;const child=await load(absolute(item.uri,url)),p=hls(child.raw,child.url);formats.push({...playlistFormat({...p,uri:child.url,attributes:{CODECS:'mp4a'}},'a'+formats.length,'audio'),audioGroup});}
   for(const f of formats){
    if(f.averageBitrateScope!=='variant')continue;
    const renditions=Object.values(m.mediaGroups?.AUDIO?.[f.audioGroup] || {}),audio=formats.filter(a=>a.kind==='audio'&&a.audioGroup===f.audioGroup);
    // Multiple renditions can have different average sizes (e.g. 2ch/6ch).
    // Only a single declared and resolved rendition proves the selected pair.
    if(renditions.length===1&&audio.length===1)f.averageAudioId=audio[0].id;
   }
   for(const group of Object.values(m.mediaGroups?.SUBTITLES || {}))for(const item of Object.values(group))if(item.uri)tracks.push({language:item.language || 'und',name:item.name || item.language || 'Subtitles',url:absolute(item.uri,url),playlist:true});
  }else{if(!m.endList)throw new Error('目前僅支援已完成的影片串流');duration=m.segments.reduce((n,s)=>n+s.duration,0);formats.push(playlistFormat({...m,uri:url,attributes:{CODECS:'avc1,mp4a'}},'v0','video','mp4'));}
 }
 if(formats.length&&formats.every(f=>f.drm))throw new Error('此串流含 DRM 保護，未提供下載');
 // Some valid masters (including MMOV) omit CODECS. Determine muxed audio
 // from the actual init/TS headers rather than silently inventing AAC or
 // discarding an otherwise downloadable video for lack of metadata.
 for(const format of formats){
  if(format.drm||format.kind==='audio'||format.videoCodec&&format.audioCodec)continue;
  const segment=format.segments?.[0],init=segment?.map;
  if(!segment)continue;
  let sample=await headBytes(init?.resolvedUri || segment.resolvedUri || absolute(init?.uri || segment.uri,format.url),referer,init?.byterange?.offset || segment.byterange?.offset || 0,Math.min(init?.byterange?.length || segment.byterange?.length || 131072,131072),false,signal,pageContext);
  if(!init&&segment.key?.method==='AES-128'){
   const keyBytes=await headBytes(segment.key.resolvedUri || absolute(segment.key.uri,format.url),referer,0,17,false,signal,pageContext);
   sample=await decryptHlsSample(sample,keyBytes,hlsIv(segment.key,format.mediaSequence));
  }
  const detected=parseTransportStreamCodecs(sample),mp4=detected.videoCodec||detected.audioCodec?null:await readMp4Metadata((offset,length)=>sample.subarray(offset,offset+length),sample,sample.byteLength);
  const codes=detected.videoCodec||detected.audioCodec?detected:mp4?.videoCodec||mp4?.audioCodec?mp4:parseMp4Codecs(sample);
  format.videoCodec ||= codes.videoCodec;format.audioCodec ||= codes.audioCodec;
  // Missing CODECS is not proof of silence. A complete MP4 track table can
  // prove it without another request; a declared external audio group still
  // requires its paired rendition, even when the video init has no audio.
  if(!declaredAudio.has(format)&&!format.audioGroup&&!format.audioCodec&&mp4?.audioAbsent===true)format.audioAbsent=true;
 }
 signal?.throwIfAborted();return {formats,tracks,duration,requiresAudio:true};
}
async function headBytes(url,referer,start=0,limit=131072,details=false,signal,pageContext){
 const res=await request(url,referer,{signal,pageContext,sourceStage:'source-probe',headers:{Range:`bytes=${start}-${start+limit-1}`}}),reader=res.body.getReader(),range=res.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
 if(start&&(res.status!==206||!range||Number(range[1])!==start)){await reader.cancel();throw new Error('來源未提供正確的檔案範圍');}
 const chunks=[];let length=0;
 try{while(length<limit){const {value,done}=await reader.read();if(done)break;const bytes=value.subarray(0,limit-length);chunks.push(bytes);length+=bytes.length;}}finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
 return details?{bytes:out,size:range?Number(range[3]):res.status===200?Number(res.headers.get('content-length'))||null:null,mime:res.headers.get('content-type')||'',rangeSupported:res.status===206&&!!range&&Number(range[1])===start&&Number(range[2])-start+1===length}:out;
}
async function verifyFirstMp4Packet(url,referer,initial,size,signal,pageContext){
 const M=globalThis.VideoPocketMediabunny;if(!M?.Input||!M?.EncodedPacketSink)return null;
 if(!Number.isSafeInteger(size)||size<=0)return false;
 const MAX_PACKET_PROBE=2*1024*1024;let packetProbeBytes=0;
 let input,packet;
 try{
  let source;
  if(size===initial.byteLength)source=new M.BlobSource(new Blob([initial],{type:'video/mp4'}));
  else{
   const reader=globalThis.VideoPocketIndexedMp4?.createIndexedMp4Reader({M,format:{filesize:size},readRange:(offset,length,readSignal)=>{packetProbeBytes+=length;if(packetProbeBytes>MAX_PACKET_PROBE)throw Object.assign(new Error('MP4 首封包探測超過上限'),{code:'RANGE_UNSUPPORTED'});return headBytes(url,referer,offset,length,false,readSignal || signal,pageContext);},signal});
   if(!reader?.source)throw new Error('MP4 sample source unavailable');
   source=reader.source;
  }
  input=new M.Input({source,formats:[M.MP4]});
  const track=await input.getPrimaryVideoTrack();
  if(!track)return false;
  packet=await new M.EncodedPacketSink(track).getFirstPacket();
  return !!packet;
 }finally{try{packet?.close?.()}catch{}try{await input?.dispose?.()}catch{}}
}
async function progressive(descriptor,signal){
 const url=descriptor.url,referer=descriptor.referer,pageContext=descriptor.pageContext;let size,mime='';if(descriptor.platform?.site!=='anime1')try{const r=await request(url,referer,{method:'HEAD',pageContext,sourceStage:'source-head',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});size=Number(r.headers.get('content-length')) || null;mime=r.headers.get('content-type') || '';}catch{signal?.throwIfAborted();}
 if(/mpegurl|dash\+xml/i.test(mime))return manifestSource(url,referer,undefined,signal,pageContext);
 // HEAD may be unsupported. A real bounded GET must succeed before we offer
 // a file or open Save As; never swallow a 403 into an unknown-size MP4.
 const probe=await headBytes(url,referer,0,size>0&&size<=2*1024*1024?size:131072,true,signal,pageContext),initial=probe.bytes,prefix=new TextDecoder().decode(initial.subarray(0,2048)).trimStart();size ||= probe.size;mime ||= probe.mime;
 if(prefix.startsWith('#EXTM3U')||/<MPD\b/.test(prefix))return manifestSource(url,referer,undefined,signal,pageContext);
 if(/^(?:<!doctype\s+html|<html\b)/i.test(prefix))throw new Error('來源回傳網頁，未提供影音檔案');
 if(/text\/html|application\/json/i.test(mime))throw new Error('此網址未提供影音或串流清單');
  let width=descriptor.width || 0,height=descriptor.height || 0,duration=descriptor.duration || 0,metadata={};
 const ext=/audio\/mpeg|\.mp3(?:\?|$)/i.test(mime+' '+url)?'mp3':/webm/.test(mime)||/\.webm(?:\?|$)/i.test(url)?'webm':/ogg|\.og[vga](?:\?|$)/i.test(mime+' '+url)?'ogg':/mp2t|\.ts(?:\?|$)/i.test(mime+' '+url)?'ts':'mp4';let codes={videoCodec:'',audioCodec:ext==='mp3'?'mp3':''};
 if(ext==='mp4'){
  codes=parseMp4Codecs(initial);
  try{metadata=await readMp4Metadata((offset,length)=>headBytes(url,referer,offset,length,false,signal,pageContext),initial,size);codes.videoCodec=metadata.videoCodec || codes.videoCodec;codes.audioCodec=metadata.audioCodec || codes.audioCodec;}catch(error){signal?.throwIfAborted();if([401,403,429].includes(error.status))throw error;}
  if(metadata.drm)throw new Error('此影片含 DRM 保護，未提供下載');
  if(descriptor.requireMediaPacket && (metadata.videoCodec || codes.videoCodec)){const packet=await verifyFirstMp4Packet(url,referer,initial,size,signal,pageContext);if(packet===false)throw new Error('來源片段缺少可解碼的起始封包');}
  // A sample table alone does not prove the server accepts partial requests.
  // Metadata discovery shares its existing bounded header walk with capability
  // inspection; packet indexing is deferred until an actual range download.
  if(!probe.rangeSupported)delete metadata.mp4Index;
   width=metadata.videoWidth || width;height=metadata.videoHeight || height;duration ||= metadata.duration || 0;
 }else if(ext==='ts')codes=parseTransportStreamCodecs(initial);
 else if(ext!=='mp3'){const text=new TextDecoder('latin1').decode(initial);codes={videoCodec:/V_VP9/.test(text)?'vp9':/V_VP8/.test(text)?'vp8':/V_AV1/.test(text)?'av1':'',audioCodec:/A_OPUS|OpusHead/.test(text)?'opus':/A_VORBIS|vorbis/.test(text)?'vorbis':''};}
 if(!height||!duration){
  const video=document.createElement('video');video.preload='metadata';video.muted=true;
   await rpc('assetHeaders',{url,referer});await new Promise((resolve,reject)=>{const finish=error=>{width=video.videoWidth || width;height=video.videoHeight || height;duration=Number.isFinite(video.duration)?video.duration:duration;clearTimeout(timer);signal?.removeEventListener('abort',abort);video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();error?reject(error):resolve();};const abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(),8000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}video.onloadedmetadata=()=>finish();video.onerror=()=>finish();video.src=url;});
 }
 signal?.throwIfAborted();
  return {duration,formats:[{id:'direct',url,ext,width,height,filesize:size,...codes,...(metadata.audioAbsent===true?{audioAbsent:true}:{}),...(metadata.mp4Index?{mp4Index:metadata.mp4Index}:{}),kind:height?'video':/^audio\//.test(mime)?'audio':'video'}],tracks:[]};
}
async function inspect(m){
 const id=m.inspectionId || crypto.randomUUID(),controller=new AbortController();
 if(cancelledInspections.delete(id))throw Object.assign(new Error('已取消'),{name:'AbortError'});
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]);inspections.set(id,controller);
 try{
  try{return await inspectSource(m,signal);}catch(error){
   const fallback=m.descriptor?.platform?.networkFallback;
   if(!fallback||signal.aborted||classifyFailure(error).code==='DRM_UNSUPPORTED')throw error;
   return await inspectSource({...m,descriptor:{...m.descriptor,url:undefined,platform:{...fallback,site:'network-media'}}},signal);
  }
 }finally{inspections.delete(id);}
}
function cancelInspect(id){
 if(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id))return {};
 const controller=inspections.get(id);
 if(controller)controller.abort(Object.assign(new Error('已取消'),{name:'AbortError'}));
 else{cancelledInspections.add(id);if(cancelledInspections.size>50)cancelledInspections.delete(cancelledInspections.values().next().value);}
 return {};
}
async function inspectSource(m,signal){
 const inspectionOrder=++sourceInspectionOrder;let d=m.descriptor;
 if(m.force&&Number.isInteger(d.tabId)&&d.documentId&&d.mediaKey!=null)for(const source of sources.values()){
  const previous=source.descriptor;
  if(previous.tabId===d.tabId&&previous.documentId===d.documentId&&(previous.frameId??0)===(d.frameId??0)&&previous.mediaKey===d.mediaKey)source.inspectionKey='';
 }
 if(d.drm)throw new Error('此影片含 DRM 保護，未提供下載');
 const reuseKey=await inspectionReuseKey(d);signal.throwIfAborted();
 if(reuseKey&&!m.force){
  for(const source of sources.values()){
   if(sourceRetention.isAccepted(source.id)&&inspectionReusable(source,reuseKey,Date.now())){
    // Touch the existing entry; do not duplicate its media metadata.
    sources.delete(source.id);sources.set(source.id,source);return inspectionResult(source);
   }
  }
 }
 try{if(Number.isInteger(d.tabId)&&typeof d.documentId==='string'&&/(^|\.)(?:facebook|tiktok|dailymotion)\.com$/.test(new URL(d.referer).hostname))d={...d,pageContext:{tabId:d.tabId,documentId:d.documentId,referer:d.referer,...(d.mediaKey!=null?{mediaKey:d.mediaKey,playerUrl:d.playerUrl || '',contentId:d.mediaContentId || d.linkedMedia?.id || ''}:{})}};}catch{}
 // An X broadcast card has an exact post permalink but its replay URL lives
 // on the linked broadcast page. Resolve that identity before ambient probes.
 let xLinkedFallback=false,linkedFailure;
 try{xLinkedFallback=d.platform?.site==='network-media'&&/^(?:www\.)?(?:x|twitter)\.com$/i.test(new URL(d.referer).hostname);}catch{}
 if((!d.platform||xLinkedFallback)&&!d.url&&d.linkedMedia){
  try{
   const platform=await resolveLinkedMedia(d.linkedMedia,d.referer,(url,options={})=>request(url,d.referer,{...options,signal,pageContext:d.pageContext}),{signal});
   d={...d,platform,title:platform.title || d.title};
  }catch(error){signal.throwIfAborted();if(!xLinkedFallback)throw error;linkedFailure=error;}
 }
 if(d.platform?.site==='anime1')d=await resolveAnime1(d,(url,referer,options={})=>request(url,referer,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}));
 let observedSource;
 const dailymotion=d.platform?.site==='dailymotion';
 if(dailymotion){
  const observed=d.platform.observedSource;
  if(observed?.url&&/^https:\/\//i.test(observed.url)&&['hls','dash','progressive'].includes(observed.type))try{
   observedSource=observed.type==='progressive'?await progressive({...d,url:observed.url},signal):await manifestSource(observed.url,d.referer,undefined,signal,d.pageContext);
  }catch(error){signal.throwIfAborted();if(classifyFailure(error).code==='DRM_UNSUPPORTED')throw error;}
  if(!observedSource?.formats?.length){
   let platform;try{platform=await resolveDailymotion(d.platform,(url,options={})=>request(url,d.referer,{...options,signal,pageContext:d.pageContext}));}
   catch(error){throw Object.assign(error,{sourceStage:'dailymotion-metadata'});}
   d={...d,title:platform.title || d.title,platform};
  }
 }
 let source=observedSource || (d.platform?platformSource(d.platform):null),sourceError;
 if(['social-network','network-media','metadata-media'].includes(d.platform?.site))try{source=await resolveNetworkCandidates(d.platform,{signal,requireMediaPacket:true,probe:(variant,probeSignal,probeOptions)=>variant.kind==='hls'||variant.kind==='dash'?manifestSource(variant.url,d.referer,undefined,probeSignal,d.pageContext):progressive({...d,url:variant.url,duration:0,height:0,requireMediaPacket:!!probeOptions?.requireMediaPacket},probeSignal)});}catch(error){if(linkedFailure&&classifyFailure(error).code==='SOURCE_UNAVAILABLE')throw linkedFailure;throw error;}
 if(d.platform?.site==='twitch-clip'){
  const clip=await twitchClipManifest(d.platform,(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}),{signal});
  if(!clip?.qualities?.length||clip.slug!==d.platform.slug)throw Object.assign(new Error('未取得目前 Twitch Clip 的播放來源'),{code:'SOURCE_UNAVAILABLE'});
   d={...d,title:clip.title || d.title,platform:{...d.platform,site:'embedded',duration:clip.duration,versions:clip.qualities.map(variant=>({url:tokenizedTwitchClipUrl(variant.url,clip),width:variant.width || 0,height:variant.height || Number.parseInt(variant.quality,10) || 0}))}};
 }
 if(d.platform?.site==='instagram'||d.platform?.site==='embedded'){
  if(d.platform.manifestXml)try{source=await manifestSource(d.platform.manifestUrl || d.referer,d.referer,d.platform.manifestXml,signal,d.pageContext);}catch(error){signal.throwIfAborted();if(classifyFailure(error).code==='DRM_UNSUPPORTED')throw error;sourceError=dailymotion?Object.assign(error,{sourceStage:'dailymotion-manifest'}):error;}
  if(!source?.formats?.length&&d.platform.manifestUrl)try{source=await manifestSource(d.platform.manifestUrl,d.referer,undefined,signal,d.pageContext);}catch(error){signal.throwIfAborted();if(classifyFailure(error).code==='DRM_UNSUPPORTED')throw error;sourceError=dailymotion?Object.assign(error,{sourceStage:'dailymotion-manifest'}):error;}
  if(!source?.formats?.length&&d.platform.playbackManifest?.url)try{source=await manifestSource(d.platform.playbackManifest.url,d.referer,undefined,signal,d.pageContext);}catch(error){signal.throwIfAborted();if(classifyFailure(error).code==='DRM_UNSUPPORTED')throw error;sourceError ||= error;}
  const manifestHeight=Math.max(0,...(source?.formats || []).map(qualityOfFormat));
  const versions=prioritizeMediaVersions(d.platform.versions).filter(variant=>!source?.formats?.length||qualityOfFormat(variant)>manifestHeight);
  if(versions.length){
   const formats=[...(source?.formats || [])],resolvedQualities=new Set();let firstError,duration=source?.duration || d.platform.duration || d.duration;
   for(const [i,variant] of versions.entries()){
    const quality=Number(variant.height)>0?`${Number(variant.width)||0}x${Number(variant.height)}`:`unknown:${i}`;
    if(resolvedQualities.has(quality))continue;
    try{const value=await progressive({...d,url:variant.url,width:variant.width || 0,height:variant.height || 0,duration},signal);duration ||= value.duration;formats.push(...value.formats.map(f=>({...f,id:'instagram-'+i})));resolvedQualities.add(quality);}
    catch(error){if(signal.aborted){if(formats.length&&signal.reason?.name==='TimeoutError')break;signal.throwIfAborted();}firstError ||= error;}
   }
   if(!formats.length&&firstError)throw firstError;
   if(formats.length)source={...source,title:d.title,duration,formats,tracks:source?.tracks || [],requiresAudio:true};
  }
 }
 if(d.platform?.site==='twitch'){
  const vodUrl=/^\d+$/.test(String(d.platform.id))?'https://www.twitch.tv/videos/'+d.platform.id:d.referer;
  const resolved=await twitchVodManifest(vodUrl,(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal}));signal.throwIfAborted();
  if(!resolved?.url || resolved.id!==String(d.platform.id))throw Object.assign(new Error('未取得目前 Twitch VOD 的播放來源'),{code:'SOURCE_UNAVAILABLE'});
  d={...d,url:resolved.url,sourceType:'hls',platform:{...d.platform,manifest:resolved.url}};
  source=await manifestSource(resolved.url,d.referer,undefined,signal);
 }
  if(!source?.formats?.length){if(!d.url||/(youtube\.com|bilibili\.com)/.test(new URL(d.url).hostname))throw sourceError || new Error('此播放器尚未提供可下載的原始來源');source=['hls','dash'].includes(d.sourceType)||/\.(mpd|m3u8)(?:\?|$)/i.test(d.url)?await manifestSource(d.url,d.referer,undefined,signal,d.pageContext):await progressive(d,signal);}
 if(d.pageContext)for(const format of source.formats)format.pageContext=d.pageContext;
 if(!(source?.formats?.length&&signal.reason?.name==='TimeoutError'))signal.throwIfAborted();
 source.duration=Number.isFinite(Number(source.duration))?Number(source.duration):0;
 source.id=crypto.randomUUID();source.inspectionOrder=inspectionOrder;source.referer=d.referer;source.descriptor=d;source.title ||= d.title;source.capability=mediaChoices(source);
 source.range=rangeCapability(source,source.capability,{allowFullCut:true});
 if(reuseKey&&[...Object.values(source.capability.choices?.video||{}),...Object.values(source.capability.choices?.audio||{})].some(choice=>choice.enabled))source.inspectionKey=reuseKey;
 sources.set(source.id,source);sourceRetention.refresh();
 return inspectionResult(source);
}
function inspectionResult(source){const d=source.descriptor;return {id:source.id,title:source.title,duration:source.duration,platform:d.platform?.site || (/\.mpd(?:\?|$)/i.test(d.url || '')?'dash':/\.m3u8(?:\?|$)/i.test(d.url || '')?'hls':'html'),choices:source.capability.choices,range:source.range,tracks:source.tracks.map((t,i)=>({...t,source:'browser',pageTrackId:'browser:'+i,pageTrackIndex:i})),browserSourceId:source.id};}
const {transfer,downloadTrack}=createMediaTransfer({request,disk,directTransfer,assembleSegments});

async function downloadIndexedMp4(format,source,range,signal,scope,kind,expectedAudio,onProgress,control){
 const worker=new Worker(chrome.runtime.getURL('indexed-mp4-worker.js')); let done=false,readControl=new AbortController();const versions=createMediaRangeVersions();
 return await new Promise((resolve,reject)=>{
  const finish=()=>{done=true;readControl.abort();signal.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{if(done)return;done=true;readControl.abort(signal.reason);worker.postMessage({action:'cancel'});finish();reject(Object.assign(new Error('已取消'),{code:'CANCELLED'}));};
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>{finish();reject(Object.assign(new Error('Indexed MP4 worker failed'),{code:'RANGE_PROCESSING_FAILED'}));};
  worker.onmessage=({data})=>{
   if(done)return;
   if(data.type==='readRange'){
    const read=attemptSignal=>transfer(format.url,source.referer,AbortSignal.any([signal,readControl.signal,attemptSignal]),{offset:data.offset,length:data.length},()=>{},format.pageContext||source.descriptor?.pageContext,versions);
    void (control?control.run(read):read(signal)).then(bytes=>{if(!done)worker.postMessage({action:'readResult',requestId:data.requestId,bytes},[bytes.buffer]);}).catch(error=>{const failure=classifyFailure(error);if(!done)worker.postMessage({action:'readResult',requestId:data.requestId,error:failure.message,errorCode:failure.code,httpStatus:failure.httpStatus});});return;
   }
   if(data.type==='progress')onProgress?.(data.progress);
   if(data.type==='done'){finish();resolve(data);}
   if(data.type==='error'){finish();reject(Object.assign(new Error(data.error),{code:data.errorCode,httpStatus:data.httpStatus}));}
  };
  if(signal.aborted){abort();return;}
  worker.postMessage({format,source,range,scope,kind,expectedAudio});
 });
}
async function rangeFormat(format,source,range,signal,control){
 if(!range)return {format,seekTimestamp:0};
 const duration=Number(source.duration);normalizeRange(range,duration);
 if(format.segments?.length){const plan=planSegmentRange(format,range);if(!Number.isFinite(plan.seekTimestamp)||plan.seekTimestamp<0||plan.seekTimestamp>plan.duration)throw new Error('影音區間起始時間戳無效');return {format:plan,seekTimestamp:plan.seekTimestamp};}
 const indexRange=byteRange(format.indexRange);
 if(indexRange){
  const capability=formatRangeCapability(format);if(!capability.supported)throw Object.assign(new Error(capability.reason),{code:'RANGE_UNSUPPORTED'});
  if(!format.url)throw Object.assign(new Error('SIDX 缺少來源 URL'),{code:'RANGE_UNSUPPORTED'});
  const routes=createIndexedRoutes([format.url,...(format.backupUrls || [])],{
   dispose:value=>value?.path?disk.removeMediaFile(value.path):undefined,
   retryOrigin:error=>[429,503].includes(Number(error?.httpStatus??error?.status))&&(error.retryAfterMs!==undefined||error.retryAfterUnsupported===true)?error.requestOrigin:null,
   waitForRetryOrigin:request.waitForOrigin
  }),versions=createMediaRangeVersions();
  const readIndex=async attemptSignal=>(await routes.run((url,routeSignal)=>transfer(url,source.referer,AbortSignal.any([attemptSignal,routeSignal]),indexRange,()=>{},format.pageContext,versions,format.url),attemptSignal)).value;
  const bytes=await (control?control.run(readIndex):readIndex(signal));
  if(bytes.byteLength!==indexRange.length)throw new Error('SIDX 索引資料不完整');
  const index=parseSidx(bytes,indexRange.offset);index.sidxOffset=indexRange.offset;
  const plan=coalesceIndexedSegments(planIndexedRange({...format,initRange:byteRange(format.initRange)},index,range));plan.rangeRoutes=routes;plan.rangeVersions=versions;if(!Number.isFinite(plan.seekTimestamp)||plan.seekTimestamp<0||plan.seekTimestamp>plan.duration)throw new Error('影音區間起始時間戳無效');return {format:plan,seekTimestamp:plan.seekTimestamp};
 }
 throw Object.assign(new Error('此來源沒有可用的影音區間索引'),{code:'RANGE_UNSUPPORTED'});
}
function mux(inputs,args,output,signal,scope,destinationId,cut){return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(signal.reason);return;}
 const worker=new Worker(chrome.runtime.getURL(cut?'range-cut-worker.js':'ffmpeg-worker.js'));muxWorker=worker;
 let saving=false,lastCutProgress=0,ready,settled=false,finished=false,watchdog;
 const finish=()=>{if(finished)return;finished=true;watchdog?.stop();signal.removeEventListener('abort',abort);worker.terminate();if(muxWorker===worker)muxWorker=null;};
 const abort=()=>{if(settled)return;if(saving){worker.postMessage({action:'cancel'});return;}settled=true;finish();reject(Object.assign(new Error('已取消'),{code:'CANCELLED'}));};
 if(cut)watchdog=createProcessingWatchdog({onTimeout:error=>{if(settled)return;settled=true;finish();reject(error);}});
 signal.addEventListener('abort',abort,{once:true});
 worker.onerror=()=>{
  if(settled)return;settled=true;
  finish();
  if(ready&&!signal.aborted)resolve({...ready,saved:false,saveFailure:{code:'SAVE_FAILED',saveStage:'save-worker',saveReason:'worker-failed'}});
  else reject(Object.assign(new Error(signal.aborted?'已取消':'瀏覽器合併失敗'),{code:signal.aborted?'CANCELLED':'MERGE_FAILED'}));
 };
 worker.onmessage=({data})=>{
  if(settled)return;
  if(data.type==='cutActivity'){watchdog?.activity(data.stage,data.progress);return;}
  if(data.type==='cutProgress'&&Number.isFinite(data.progress)&&(Date.now()-lastCutProgress>250||data.progress>=1)){lastCutProgress=Date.now();void rpc('progress',{id:scope,state:'processing',progress:Math.round(Math.max(0,Math.min(1,data.progress))*100)}).catch(()=>{});}
  if(data.type==='readyToSave'&&typeof data.path==='string'&&data.size>0)ready={path:data.path,size:data.size};
  if(data.type==='saving'){saving=true;void rpc('progress',{id:scope,state:'saving',progress:0});}
  if(data.type==='saveProgress')void rpc('progress',{id:scope,state:'saving',progress:data.progress});
  if(data.type==='done'){settled=true;finish();resolve(data);}
  if(data.type==='error'){settled=true;finish();reject(Object.assign(new Error(data.error),classifyFailure({message:data.error,code:data.errorCode,processingReason:data.processingReason,processingStage:data.processingStage,ffmpegExitCode:data.ffmpegExitCode,saveStage:data.saveStage,saveReason:data.saveReason},'merge')));}
 };
 worker.postMessage({inputs,args,output,outputPath:output,scope,destinationId,...(cut||{})});
});}
function saveDirect(path,destinationId,signal,id){return new Promise((resolve,reject)=>{
 if(signal.aborted){reject(signal.reason);return;}
 const fallback=()=>resolve({saved:false,saveFailure:{code:'SAVE_FAILED',saveStage:'save-worker',saveReason:'worker-failed'}});
 let worker;try{worker=new Worker(chrome.runtime.getURL('save-worker.js'));}catch{signal.aborted?reject(signal.reason):fallback();return;}
 const finish=()=>{signal.removeEventListener('abort',abort);worker.terminate();};
 const abort=()=>worker.postMessage({action:'cancel'});signal.addEventListener('abort',abort,{once:true});
 worker.onerror=()=>{finish();signal.aborted?reject(signal.reason):fallback();};
 worker.onmessage=({data})=>{
  if(data.type==='progress')void rpc('progress',{id,state:'saving',progress:data.progress});
  if(data.type==='done'){finish();if(signal.aborted)reject(signal.reason);else resolve({saved:data.saved!==false,...(data.saveFailure?{saveFailure:data.saveFailure}:{})});}
  if(data.type==='error'){finish();reject(Object.assign(new Error(data.error),{code:data.code,saveStage:data.saveStage,saveReason:data.saveReason}));}
 };
 worker.postMessage({path,destinationId});
});}

async function browserDownloadFile(path,filename,ext,kind,scope,saveFailure){
 const type=kind==='audio'?({m4a:'audio/mp4',mp3:'audio/mpeg',ogg:'audio/ogg'}[ext] || 'audio/webm'):({mp4:'video/mp4',webm:'video/webm'}[ext] || 'video/x-matroska');
 const blobId=crypto.randomUUID(),url=URL.createObjectURL(new File([await disk.readMediaFile(path)],filename,{type}));
 blobs.set(blobId,{url,scope});return {url,filename,blobId,...(saveFailure?{saveFailure}:{})};
}

async function download(m){
 const downloadBegan=Date.now();
 if(cancelledDownloads.delete(m.id))throw Object.assign(new Error('已取消'),{code:'CANCELLED',userCancelled:true});
 const source=sources.get(m.sourceId);if(!source)throw new Error('來源資訊已失效，請重新整理');let p=selectedPlan(source.capability,m),filename=m.filename+'.'+p.ext;
 const controller=new AbortController();controllers.set(m.id,controller);
 const control=new TransferControl(controller.signal,state=>{void rpc('progress',{id:m.id,state}).catch(()=>{});},{interrupt:!source.sabr});controls.set(m.id,control);
 const requestedRange=m.range || null;
 let fullCut=null;
 const indexedFormat=!p.audio&&p.video?.mp4Index?p.video:!p.video&&p.audio?.mp4Index?p.audio:null;
 try{if(requestedRange){if(!source.range?.supported)throw Object.assign(new Error(source.range?.reason || '此來源不支援區間下載'),{code:'RANGE_UNSUPPORTED'});normalizeRange(requestedRange,Number(source.duration));
  if(!Number.isFinite(Number(source.duration))||Number(source.duration)<=0)throw Object.assign(new Error('來源沒有有限影片長度'),{code:'RANGE_UNSUPPORTED'});
  if(source.sabr){p={...p,direct:false,size:null};/* SABR validates coverage before stopping. */}
  else if(indexedFormat){p={...p,direct:false,size:null};}
  else if([p.video,p.audio].filter(Boolean).every(format=>formatRangeCapability(format).supported)){const [video,audio]=await Promise.all([p.video?rangeFormat(p.video,source,requestedRange,controller.signal,control):null,p.audio?rangeFormat(p.audio,source,requestedRange,controller.signal,control):null]);p={...p,video:video?.format,audio:audio?.format,direct:false,size:null};}
  else {fullCut=fullCutPolicy(source,p);if(!fullCut.supported)throw Object.assign(new Error(fullCut.reason),{code:'RANGE_UNSUPPORTED'});p={...p,direct:false};}
 }}catch(error){controller.abort(error);controllers.delete(m.id);controls.delete(m.id);throw error;}
 if(!requestedRange&&p.direct&&!m.destinationId&&source.descriptor.platform?.site!=='bilibili'&&!source.descriptor.pageContext){controllers.delete(m.id);controls.delete(m.id);return {url:p.video?.url || p.audio.url,filename,referer:source.referer};}
 const progress=createTransferProgress([p.video,p.audio],p.size?.bytes);let last=0,lastPercent,indexedPercent;
 const report=(force=false)=>{const percent=indexedPercent??progress.percent();if(percent===lastPercent&&!force)return;if(force||Date.now()-last>250){last=Date.now();lastPercent=percent;void rpc('progress',{id:m.id,state:'running',progress:percent}).catch(()=>{});}};
 const trackDownload=async format=>{const result=await downloadTrack(format,source.referer,controller.signal,bytes=>{progress.bytes(format,bytes);report();},m.id,control,index=>{progress.segment(format,index);report();},reason=>controller.abort(reason), (index,received,attempt)=>{progress.segmentBytes(format,index,received,attempt);report();},(index,attempt)=>{progress.clearSegmentAttempt(format,index,attempt);report();});progress.complete(format);report(true);return result;};
 const onBytes=bytes=>{progress.bytes(p.video || p.audio,bytes);report();};
 try{
  // Storage estimates are advisory, not physical free space or a limit for unlimitedStorage.
  // Only an actual failed write may report TEMP_STORAGE_FULL.
  await startupCleanup;const inputs=[];
  controller.signal.throwIfAborted();
  if(p.direct&&!m.destinationId){const result=await trackDownload(p.video || p.audio);await reportTimings(m.id,{downloadMs:Date.now()-downloadBegan});return await browserDownloadFile(result.path,filename,p.ext,m.kind,m.id);}
  if(p.direct&&m.destinationId){const result=await trackDownload(p.video || p.audio);await reportTimings(m.id,{downloadMs:Date.now()-downloadBegan});await control.wait();const saveBegan=Date.now(),saved=await saveDirect(result.path,m.destinationId,controller.signal,m.id);await reportTimings(m.id,{saveMs:Date.now()-saveBegan});if(!saved.saved)return await browserDownloadFile(result.path,filename,p.ext,m.kind,m.id,saved.saveFailure);await disk.removeMediaFiles(m.id);return {saved:true,filename};}
  if(source.sabr){const streams=await downloadYoutube(source,p,controller.signal,onBytes,descriptor=>rpc('youtubeSession',{descriptor}),(url,options)=>control.run(async sessionSignal=>request(url,source.referer,{...options,signal:AbortSignal.any([sessionSignal,options.signal || sessionSignal])})),()=>disk.createMediaFile(m.id,'input'),requestedRange,{isPaused:()=>control.paused});for(const s of streams){const name=(s.format.videoCodec?'video':'audio')+'.'+s.format.ext,original=await disk.readMediaFile(s.path),file=requestedRange&&s.format.ext==='webm'?await prepareWebmFragment(original):original;inputs.push({name,file:new File([file],name),timelineStart:requestedRange?Number(s.cutOffset):0});}}
  else if(requestedRange&&indexedFormat){const result=await downloadIndexedMp4(indexedFormat,source,requestedRange,controller.signal,m.id,m.kind,m.kind==='audio'||!!indexedFormat.audioCodec,value=>{indexedPercent=Math.max(indexedPercent||0,Math.floor(value*100));report();},control);indexedPercent=100;const name=(m.kind==='audio'?'audio':'video')+'.mp4';inputs.push({name,file:new File([await disk.readMediaFile(result.path)],name),timelineStart:Number(result.timelineStart)||0});}
  else{const settled=await Promise.allSettled([p.video&&{name:'video.'+p.video.ext,format:p.video},p.audio&&{name:'audio.'+p.audio.ext,format:p.audio}].filter(Boolean).map(async f=>{try{const result=await trackDownload(f.format);return {name:f.name,file:new File([await disk.readMediaFile(result.path)],f.name),timelineStart:requestedRange&&!fullCut?Number(f.format.selectedStart):0};}catch(error){controller.abort(error);throw error;}}));const failed=settled.find(value=>value.status==='rejected');if(failed)throw controller.signal.reason||failed.reason;inputs.push(...settled.map(value=>value.value));}
  for(const format of [p.video,p.audio].filter(Boolean))progress.complete(format);report(true);
  await reportTimings(m.id,{downloadMs:Date.now()-downloadBegan});
  await control.wait();await rpc('progress',{id:m.id,state:'processing',progress:null});
  const args=requestedRange?[]:['-y',...inputs.flatMap(f=>['-i','input:'+f.name]),...(m.kind==='audio'?['-map','0:a:0','-vn']:inputs.length===2?['-map','0:v:0','-map','1:a:0']:['-map','0:v:0','-map','0:a:0?']),'-c','copy',...(p.ext==='mp4'||p.ext==='m4a'?['-movflags','+faststart']:[]),'output.'+p.ext];
  const processingBegan=Date.now(),result=await mux(inputs,args,'output.'+p.ext,controller.signal,m.id,m.destinationId,requestedRange?{range:requestedRange,kind:m.kind,expectedAudio:!!p.audio||!!p.video?.audioCodec}:null);await reportTimings(m.id,{processingMs:result.timings?.processingMs??Date.now()-processingBegan,...result.processing,...result.timings});if(requestedRange&&m.destinationId){const saveBegan=Date.now();Object.assign(result,await saveDirect(result.path,m.destinationId,controller.signal,m.id));await reportTimings(m.id,{saveMs:Date.now()-saveBegan});}if(result.saved){await disk.removeMediaFiles(m.id);return {saved:true,filename};}return await browserDownloadFile(result.path,filename,p.ext,m.kind,m.id,result.saveFailure);
 }catch(error){controller.abort();await disk.removeMediaFiles(m.id).catch(()=>{});throw error;}finally{controllers.delete(m.id);controls.delete(m.id);}
}
async function recoverMedia(){
 for(const controller of controllers.values())controller.abort();
 await Promise.allSettled([...downloadsInFlight]);
 for(const entry of blobs.values())URL.revokeObjectURL(entry.url);
 blobs.clear();await startupCleanup;await disk.removeMediaFiles();
}
async function subtitle(m){const source=sources.get(m.sourceId),track=source?.tracks[m.index];if(!track)throw new Error('字幕来源已失效');let segments=track.segments;if(track.playlist)segments=hls(await (await request(track.url,source.referer)).text(),track.url).segments;const cues=[];if(segments?.length){for(const s of segments)cues.push(...parseSubtitles(await (await request(s.resolvedUri || absolute(s.uri,track.url),source.referer)).text()));}else cues.push(...parseSubtitles(await (await request(track.url,source.referer)).text()));return {cues,language:track.language};}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(m.target!=='offscreen'||sender.id!==chrome.runtime.id)return;
 const action=async()=>{
  if(Array.isArray(m.activeSourceTabs))sourceRetention.setActiveTabs(m.activeSourceTabs);
  sourceRetention.refresh();
  switch(m.action){
   case 'sourceActivity':return {};
   case 'cancelInspect':return cancelInspect(m.inspectionId);
   case 'inspect':{inspecting++;try{return await inspect(m);}finally{inspecting--;}}
   case 'acceptSource':{
    if(!sourceRetention.accept(m.sourceId,m.ownerId,m.ownerRequestOrder))throw Object.assign(new Error('目前影片來源已變更，請重新選取'),{code:'SOURCE_CHANGED'});
    return {};
   }
   case 'releaseSourceOwner':sourceRetention.releaseOwner(m.ownerId);return {};
   case 'validateRecovery':return validateMediaRecovery(sources.get(m.oldSourceId),sources.get(m.newSourceId),m.selection);
   case 'youtubeSourceSession':{
    const source=sources.get(m.sourceId);
    if(source?.descriptor?.platform?.site!=='youtube'||source.dropOnRelease)return null;
    if(m.capture)youtubeSourceSessions.remember(source.descriptor,m.capture);
    return youtubeSourceSessions.get(source.descriptor);
   }
   case 'retain':{
    const source=sources.get(m.sourceId);if(!source)throw new Error('來源資訊已失效，請重新整理');
    source.references=(source.references||0)+1;sourceRetention.refresh();return {title:source.title};
   }
   case 'forget':{
    const source=sources.get(m.sourceId);
    if(m.discardInspection){if(source)source.inspectionKey='';sourceRetention.discard(m.sourceId);return {};}
    if(source){if(m.invalidateInspection)source.inspectionKey='';source.references=Math.max(0,(source.references||0)-1);if(!source.references&&source.dropOnRelease)sources.delete(m.sourceId);}
    sourceRetention.refresh();return {};
   }
   case 'dropTabSources':{
    youtubeSourceSessions.removeTab(m.tabId);
    for(const [id,source]of sources)if(source.descriptor?.tabId===m.tabId){if(source.references)source.dropOnRelease=true;else sources.delete(id);}
    sourceRetention.refresh();return {};
   }
   case 'download':return runDownload(m);
   case 'subtitle':return subtitle(m);
   case 'cancel':cancelDownload(m.id);return {};
   case 'pause':controls.get(m.id)?.pause();return {};
   case 'resume':controls.get(m.id)?.resume();return {};
   case 'recoverMedia':await recoverMedia();return {};
   case 'cleanup':
    for(const controller of inspections.values())controller.abort(Object.assign(new Error('已取消'),{name:'AbortError'}));
    cancelledInspections.clear();cancelledDownloads.clear();await recoverMedia();sources.clear();sourceRetention.clear();youtubeSourceSessions.clear();return {};
   case 'release':{
    const entry=blobs.get(m.blobId);if(entry){URL.revokeObjectURL(entry.url);await disk.removeMediaFiles(entry.scope);}blobs.delete(m.blobId);return {};
   }
  }
 };
 action().then(result=>respond({ok:true,result})).catch(error=>{const failure=classifyFailure(error,m.action==='subtitle'?'subtitle':m.action==='inspect'?'inspect':'download');respond({ok:false,error:failure.message,failure});});return true;
});
setInterval(()=>{if(controllers.size||blobs.size||inspecting)void rpc('heartbeat').catch(()=>{});},20000);

