import {HlsParser,parseDash} from './vendor/parsers.js';
import {mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs} from './browser-media.js';
import {parseSubtitles} from './subtitles.js';
import {directTransfer} from './transfers.js';
import {downloadYoutube} from './youtube-download.js';
import './disk-media.js';
import './destinations.js';
import {TransferControl} from './transfer-control.js';
import {classifyFailure} from './diagnostics.js';
import {resolveAnime1,mediaCredentials} from './anime1.js';
import {parseTransportStreamCodecs} from './transport-stream.js';
import {readMp4Metadata} from './mp4-metadata.js';
import {createTransferProgress} from './transfer-progress.js';
import {decryptHlsSample,hlsIv} from './hls-sample.js';
const disk=globalThis.VideoPocketDiskMedia;
const startupCleanup=disk.removeMediaFiles().catch(()=>{});

const sources=new Map(),controllers=new Map(),controls=new Map(),blobs=new Map();
let muxWorker,inspecting=0;
const rpc=(action,data={})=>chrome.runtime.sendMessage({target:'background',action,...data}).then(r=>{if(!r?.ok)throw Object.assign(new Error(r?.error || '背景處理失敗'),r?.failure || {});return r.result;});
async function request(url,referer,options={}){
 const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error('來源網址無效');
 await rpc('assetHeaders',{url:u.href,referer});
 const res=await fetch(u,{signal:AbortSignal.timeout(20000),...options,credentials:mediaCredentials(u.href,referer)});if(!res.ok){await res.body?.cancel();throw Object.assign(new Error(`來源讀取失敗（HTTP ${res.status}），請重新整理影片`),{status:res.status});}return res;
}
const absolute=(url,base)=>new URL(url,base).href;
function hls(raw,url){const parser=new HlsParser();parser.push(raw);parser.end();const m=parser.manifest;for(const p of m.playlists || [])p.uri=absolute(p.uri,url);for(const s of m.segments || []){s.resolvedUri=absolute(s.uri,url);if(s.map)s.map.resolvedUri=absolute(s.map.uri,url);if(s.key)s.key.resolvedUri=absolute(s.key.uri,url);}return m;}
function protectedPlaylist(p){return !!p.contentProtection || (p.segments || []).some(s=>s.key&&s.key.method!=='NONE'&&s.key.method!=='AES-128');}
function playlistFormat(p,id,kind='video',ext='mp4'){
 const attrs=p.attributes || {},parsed=metadataCodecs(`codecs="${attrs.CODECS || ''}"`),height=attrs.RESOLUTION?.height || 0;
 return {id,url:p.resolvedUri || p.uri,segments:p.segments,mediaSequence:p.mediaSequence || 0,videoCodec:kind==='audio'?'':parsed.videoCodec || (height?'h264':''),audioCodec:kind==='audio'?parsed.audioCodec || 'aac':parsed.audioCodec,kind,height,ext,bitrate:attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'],averageBitrate:Number(attrs['AVERAGE-BANDWIDTH']) || 0,drm:protectedPlaylist(p)};
}
async function manifestSource(url,referer){
 const raw=await (await request(url,referer)).text(),formats=[],tracks=[];let duration;
 if(raw.trimStart().startsWith('<')){
  if(/<ContentProtection\b/i.test(raw))throw new Error('此串流含 DRM 保護，未提供下載');
  const m=parseDash(raw,{manifestUri:url});if(!m.endList)throw new Error('目前僅支援已完成的影片串流');duration=m.duration;
  for(const [i,p] of (m.playlists || []).entries())formats.push(playlistFormat(p,'v'+i));
  for(const group of Object.values(m.mediaGroups?.AUDIO || {}))for(const item of Object.values(group))for(const [i,p] of (item.playlists || []).entries())formats.push(playlistFormat(p,'a'+formats.length,'audio'));
  for(const group of Object.values(m.mediaGroups?.SUBTITLES || {}))for(const item of Object.values(group))for(const p of item.playlists || [])tracks.push({language:item.language || 'und',name:item.language || '字幕',url:p.resolvedUri || p.uri,segments:p.segments});
 }else{
  const m=hls(raw,url);
  if(m.playlists?.length){
   for(const [i,p] of m.playlists.entries()){const media=hls(await (await request(p.uri,referer)).text(),p.uri);if(!media.endList)continue;formats.push({...playlistFormat({...p,segments:media.segments,mediaSequence:media.mediaSequence},'v'+i,'video','mp4'),duration:media.segments.reduce((n,s)=>n+s.duration,0)});duration ||= formats.at(-1).duration;}
   for(const group of Object.values(m.mediaGroups?.AUDIO || {}))for(const item of Object.values(group)){if(!item.uri)continue;const u=absolute(item.uri,url),p=hls(await (await request(u,referer)).text(),u);formats.push(playlistFormat({...p,uri:u,attributes:{CODECS:'mp4a'}},'a'+formats.length,'audio'));}
   for(const group of Object.values(m.mediaGroups?.SUBTITLES || {}))for(const item of Object.values(group))if(item.uri)tracks.push({language:item.language || 'und',name:item.name || item.language || '字幕',url:absolute(item.uri,url),playlist:true});
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
  let sample=await headBytes(init?.resolvedUri || segment.resolvedUri || absolute(init?.uri || segment.uri,format.url),referer,init?.byterange?.offset || segment.byterange?.offset || 0,Math.min(init?.byterange?.length || segment.byterange?.length || 131072,131072));
  if(!init&&segment.key?.method==='AES-128'){
   const keyBytes=await headBytes(segment.key.resolvedUri || absolute(segment.key.uri,format.url),referer,0,17);
   sample=await decryptHlsSample(sample,keyBytes,hlsIv(segment.key,format.mediaSequence));
  }
  const detected=parseTransportStreamCodecs(sample),codes=detected.videoCodec||detected.audioCodec?detected:parseMp4Codecs(sample);
  format.videoCodec ||= codes.videoCodec;format.audioCodec ||= codes.audioCodec;
 }
 return {formats,tracks,duration,requiresAudio:true};
}
async function headBytes(url,referer,start=0,limit=131072,details=false){
 const res=await request(url,referer,{headers:{Range:`bytes=${start}-${start+limit-1}`}}),reader=res.body.getReader(),range=res.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
 if(start&&(res.status!==206||!range||Number(range[1])!==start)){await reader.cancel();throw new Error('來源未提供正確的檔案範圍');}
 const chunks=[];let length=0;
 try{while(length<limit){const {value,done}=await reader.read();if(done)break;const bytes=value.subarray(0,limit-length);chunks.push(bytes);length+=bytes.length;}}finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
 return details?{bytes:out,size:range?Number(range[3]):res.status===200?Number(res.headers.get('content-length'))||null:null,mime:res.headers.get('content-type')||''}:out;
}
async function progressive(descriptor){
 const url=descriptor.url,referer=descriptor.referer;let size,mime='';if(descriptor.platform?.site!=='anime1')try{const r=await request(url,referer,{method:'HEAD',signal:AbortSignal.timeout(10000)});size=Number(r.headers.get('content-length')) || null;mime=r.headers.get('content-type') || '';}catch{}
 if(/mpegurl|dash\+xml/i.test(mime))return manifestSource(url,referer);
 // HEAD may be unsupported. A real bounded GET must succeed before we offer
 // a file or open Save As; never swallow a 403 into an unknown-size MP4.
 const probe=await headBytes(url,referer,0,size>0&&size<=2*1024*1024?size:131072,true),initial=probe.bytes,prefix=new TextDecoder().decode(initial.subarray(0,2048)).trimStart();size ||= probe.size;mime ||= probe.mime;
 if(prefix.startsWith('#EXTM3U')||/<MPD\b/.test(prefix))return manifestSource(url,referer);
 if(/^(?:<!doctype\s+html|<html\b)/i.test(prefix))throw new Error('來源回傳網頁，未提供影音檔案');
 if(/text\/html|application\/json/i.test(mime))throw new Error('此網址未提供影音或串流清單');
 let height=descriptor.height || 0,duration=descriptor.duration || 0,metadata={};
 const ext=/audio\/mpeg|\.mp3(?:\?|$)/i.test(mime+' '+url)?'mp3':/webm/.test(mime)||/\.webm(?:\?|$)/i.test(url)?'webm':/ogg|\.og[vga](?:\?|$)/i.test(mime+' '+url)?'ogg':/mp2t|\.ts(?:\?|$)/i.test(mime+' '+url)?'ts':'mp4';let codes={videoCodec:'',audioCodec:ext==='mp3'?'mp3':''};
 if(ext==='mp4'){
  codes=parseMp4Codecs(initial);
  try{metadata=await readMp4Metadata((offset,length)=>headBytes(url,referer,offset,length),initial,size);codes.videoCodec=metadata.videoCodec || codes.videoCodec;codes.audioCodec=metadata.audioCodec || codes.audioCodec;}catch(error){if([401,403,429].includes(error.status))throw error;}
  if(metadata.drm)throw new Error('此影片含 DRM 保護，未提供下載');
  height ||= metadata.videoHeight || 0;duration ||= metadata.duration || 0;
 }else if(ext==='ts')codes=parseTransportStreamCodecs(initial);
 else if(ext!=='mp3'){const text=new TextDecoder('latin1').decode(initial);codes={videoCodec:/V_VP9/.test(text)?'vp9':/V_VP8/.test(text)?'vp8':/V_AV1/.test(text)?'av1':'',audioCodec:/A_OPUS|OpusHead/.test(text)?'opus':/A_VORBIS|vorbis/.test(text)?'vorbis':''};}
 if(!height||!duration){
  const video=document.createElement('video');video.preload='metadata';video.muted=true;
  await rpc('assetHeaders',{url,referer});await new Promise(resolve=>{const finish=()=>{height=video.videoHeight || height;duration=Number.isFinite(video.duration)?video.duration:duration;clearTimeout(timer);video.removeAttribute('src');video.load();resolve();};const timer=setTimeout(finish,8000);video.onloadedmetadata=finish;video.onerror=finish;video.src=url;});
 }
 return {duration,formats:[{id:'direct',url,ext,height,filesize:size,...codes,kind:height?'video':/^audio\//.test(mime)?'audio':'video'}],tracks:[]};
}
function platformSource(platform){
 if(platform.site==='bilibili'){
  const data=platform.data || {},formats=[];
  for(const [kind,items] of [['video',data.dash?.video],['audio',data.dash?.audio]])for(const [i,f] of (items || []).entries()){const url=f.baseUrl || f.base_url;if(!url)continue;formats.push({id:kind+i,url,backupUrls:f.backupUrl || f.backup_url || [],ext:'mp4',kind,height:kind==='video'?f.height:0,videoCodec:kind==='video'?codec(f.codecs):'',audioCodec:kind==='audio'?codec(f.codecs):'',bitrate:f.bandwidth,filesize:f.size || null});}
  for(const [i,f] of (data.durl || []).entries())if(f.url)formats.push({id:'durl'+i,url:f.url,ext:/\.flv(?:\?|$)/i.test(f.url)?'flv':'mp4',kind:'video',videoCodec:'h264',audioCodec:'aac',height:platform.height || 0,filesize:f.size});
  return {title:platform.title,duration:platform.duration,formats,tracks:[],requiresAudio:true,forceDisk:true};
 }
 if(platform.site==='youtube'){
  const data=platform.streamingData || {},formats=[];
  const available=data.serverAbrStreamingUrl?(data.adaptiveFormats || []):[...(data.formats || []),...(data.adaptiveFormats || [])];
  for(const [i,f] of available.entries()){
   let url=f.url;if(!url&&f.signatureCipher){const p=new URLSearchParams(f.signatureCipher);if(!p.get('s')){const u=new URL(p.get('url'));if(p.get('sig'))u.searchParams.set(p.get('sp') || 'signature',p.get('sig'));url=u.href;}}
   if(!url&&!data.serverAbrStreamingUrl)continue;const codes=metadataCodecs(f.mimeType);formats.push({...f,id:String(f.itag)+'-'+i,itag:f.itag,url,sabr:!!data.serverAbrStreamingUrl,lastModified:f.lastModified || '0',approxDurationMs:Number(f.approxDurationMs)||platform.duration*1000,audioTrackId:f.audioTrack?.id || f.audioTrackId,ext:f.mimeType.includes('webm')?'webm':'mp4',...codes,height:f.height||0,bitrate:f.bitrate,audioBitrate:f.audioBitrate?f.audioBitrate*1000:undefined,filesize:Number(f.contentLength)||null});
  }
  const sabr=formats.some(f=>f.sabr);
  return {title:platform.title,duration:platform.duration,formats,tracks:[],requiresAudio:true,sabr};
 }
}
async function inspect(m){
 let d=m.descriptor;if(d.drm)throw new Error('此影片含 DRM 保護，未提供下載');
 if(d.platform?.site==='anime1')d=await resolveAnime1(d,request);
 let source=d.platform?platformSource(d.platform):null;
 if(!source?.formats?.length){if(!d.url||/(youtube\.com|bilibili\.com)/.test(new URL(d.url).hostname))throw new Error('此播放器尚未提供可下載的原始來源');source=/\.(mpd|m3u8)(?:\?|$)/i.test(d.url)?await manifestSource(d.url,d.referer):await progressive(d);}
 source.id=crypto.randomUUID();source.referer=d.referer;source.descriptor=d;source.title ||= d.title;source.capability=mediaChoices(source);sources.set(source.id,source);if(sources.size>25){const removable=[...sources.values()].find(s=>!s.references&&s.id!==source.id);if(removable)sources.delete(removable.id);}
 return {id:source.id,title:source.title,duration:source.duration,platform:d.platform?.site || (/\.mpd(?:\?|$)/i.test(d.url || '')?'dash':/\.m3u8(?:\?|$)/i.test(d.url || '')?'hls':'html'),choices:source.capability.choices,tracks:source.tracks.map((t,i)=>({...t,source:'browser',pageTrackId:'browser:'+i,pageTrackIndex:i})),browserSourceId:source.id};
}
async function transfer(url,referer,signal,range,onBytes){
 const res=await request(url,referer,{signal,headers:range?{Range:`bytes=${range.offset || 0}-${(range.offset || 0)+range.length-1}`}:{}});if(range&&res.status!==206)throw new Error('來源未支援串流片段範圍');const reader=res.body.getReader(),chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;chunks.push(value);onBytes(value.length);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function downloadTrack(f,referer,signal,onBytes,scope,control,onSegment=()=>{}){
 const output=await disk.createMediaFile(scope,'input');
 if(!f.segments?.length){try{return await directTransfer(f,(url,options)=>request(url,referer,options),signal,onBytes,output,control);}catch(error){await output.abort();throw error;}}
 const jobs=[],seenMap=new Set(),keys=new Map();
 for(const [i,s] of f.segments.entries()){if(s.map){const key=(s.map.resolvedUri || s.map.uri)+'|'+JSON.stringify(s.map.byterange);if(!seenMap.has(key)){jobs.push({url:s.map.resolvedUri || s.map.uri,range:s.map.byterange});seenMap.add(key);}}jobs.push({url:s.resolvedUri || absolute(s.uri,f.url),range:s.byterange,key:s.key,sequence:(f.mediaSequence || 0)+i,segmentIndex:i});}
 const parts=new Array(jobs.length);let cursor=0;
 try{
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(cursor<jobs.length){const index=cursor++,job=jobs[index];parts[index]=await control.run(async attemptSignal=>{
  const partSink=await disk.createMediaFile(scope,'segment'),readSignal=AbortSignal.any([attemptSignal,AbortSignal.timeout(20000)]);
  try{if(job.key?.method==='AES-128'){
   let bytes=await transfer(job.url,referer,readSignal,job.range,()=>{}),url=job.key.resolvedUri || absolute(job.key.uri,f.url);
   if(!keys.has(url))keys.set(url,transfer(url,referer,readSignal,null,()=>{}).then(bytes=>crypto.subtle.importKey('raw',bytes,{name:'AES-CBC'},false,['decrypt'])).catch(error=>{keys.delete(url);throw error;}));
   const iv=new Uint8Array(16),view=new DataView(iv.buffer);if(job.key.iv)for(let j=0;j<4;j++)view.setUint32(j*4,job.key.iv[j]);else view.setUint32(12,job.sequence);bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv},await keys.get(url),bytes));await partSink.append(bytes);
  }else{
   const response=await request(job.url,referer,{signal:readSignal,headers:job.range?{Range:`bytes=${job.range.offset || 0}-${(job.range.offset || 0)+job.range.length-1}`}:{}});
   if(job.range&&response.status!==206){await response.body?.cancel();throw new Error('來源片段範圍不完整');}
   const reader=response.body.getReader();let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;await partSink.append(value);}const expected=job.range?.length || (!response.headers.get('content-encoding')?Number(response.headers.get('content-length')):0);if(expected>0&&size!==expected)throw new Error('來源片段長度不完整');}catch(error){await reader.cancel().catch(()=>{});throw error;}
  }
  const result=await partSink.finish();onBytes(result.size);return result;
  }catch(error){await partSink.abort();throw error;}
 });if(job.segmentIndex!==undefined)onSegment(job.segmentIndex);}}));
 for(const part of parts){await control.wait();const reader=(await disk.readMediaFile(part.path)).stream().getReader();while(true){await control.wait();const {done,value}=await reader.read();if(done)break;await output.append(value);}await disk.removeMediaFile(part.path);}return await output.finish();
 }catch(error){await output.abort();throw error;}
}

function mux(inputs,args,output,signal,scope,destinationId){return new Promise((resolve,reject)=>{const worker=new Worker(chrome.runtime.getURL('ffmpeg-worker.js'));muxWorker=worker;let saving=false;const finish=()=>{signal.removeEventListener('abort',abort);worker.terminate();if(muxWorker===worker)muxWorker=null;};const abort=()=>{if(saving){worker.postMessage({action:'cancel'});return;}finish();reject(new Error('已取消'));};signal.addEventListener('abort',abort,{once:true});worker.onerror=()=>{finish();reject(Object.assign(new Error('瀏覽器合併失敗'),{code:'MERGE_FAILED'}));};worker.onmessage=({data})=>{if(data.type==='saving'){saving=true;void rpc('progress',{id:scope,state:'saving',progress:0});}if(data.type==='saveProgress')void rpc('progress',{id:scope,state:'saving',progress:data.progress});if(data.type==='done'){finish();resolve(data);}if(data.type==='error'){finish();reject(Object.assign(new Error(data.error),{code:classifyFailure({message:data.error,code:data.errorCode},'merge').code}));}};worker.postMessage({inputs,args,output,outputPath:output,scope,destinationId});});}
function saveDirect(path,destinationId,signal,id){return new Promise((resolve,reject)=>{const worker=new Worker(chrome.runtime.getURL('save-worker.js'));const finish=()=>{signal.removeEventListener('abort',abort);worker.terminate();};const abort=()=>worker.postMessage({action:'cancel'});signal.addEventListener('abort',abort,{once:true});worker.onerror=()=>{finish();reject(Object.assign(new Error('檔案儲存失敗'),{code:'SAVE_FAILED'}));};worker.onmessage=({data})=>{if(data.type==='progress')void rpc('progress',{id,state:'saving',progress:data.progress});if(data.type==='done'){finish();resolve();}if(data.type==='error'){finish();reject(Object.assign(new Error(data.error),{code:data.code}));}};worker.postMessage({path,destinationId});});}

async function download(m){
 const source=sources.get(m.sourceId);if(!source)throw new Error('來源資訊已失效，請重新整理');const p=selectedPlan(source.capability,m),filename=m.filename+'.'+p.ext;
 if(p.direct&&!m.destinationId&&source.descriptor.platform?.site!=='bilibili')return {url:p.video?.url || p.audio.url,filename,referer:source.referer};
 const controller=new AbortController();controllers.set(m.id,controller);const control=new TransferControl(controller.signal,state=>{void rpc('progress',{id:m.id,state}).catch(()=>{});},{interrupt:!source.sabr});controls.set(m.id,control);
 const progress=createTransferProgress([p.video,p.audio],p.size?.bytes);let last=0,lastPercent;
 const report=(force=false)=>{const percent=progress.percent();if(percent===lastPercent&&!force)return;if(force||Date.now()-last>250){last=Date.now();lastPercent=percent;void rpc('progress',{id:m.id,state:'running',progress:percent}).catch(()=>{});}};
 const trackDownload=async format=>{const result=await downloadTrack(format,source.referer,controller.signal,bytes=>{progress.bytes(format,bytes);report();},m.id,control,index=>{progress.segment(format,index);report();});progress.complete(format);report(true);return result;};
 const onBytes=bytes=>{progress.bytes(p.video || p.audio,bytes);report();};
 try{
  // Storage estimates are advisory, not physical free space or a limit for unlimitedStorage.
  // Only an actual failed write may report TEMP_STORAGE_FULL.
  await startupCleanup;const inputs=[];
  if(p.direct&&!m.destinationId){const result=await trackDownload(p.video || p.audio),blobId=crypto.randomUUID(),url=URL.createObjectURL(new File([await disk.readMediaFile(result.path)],filename,{type:m.kind==='audio'?(p.ext==='m4a'?'audio/mp4':p.ext==='mp3'?'audio/mpeg':p.ext==='ogg'?'audio/ogg':'audio/webm'):(p.ext==='mp4'?'video/mp4':p.ext==='webm'?'video/webm':'video/x-matroska')}));blobs.set(blobId,{url,scope:m.id});return {url,filename,blobId};}
  if(p.direct&&m.destinationId){const result=await trackDownload(p.video || p.audio);await control.wait();await saveDirect(result.path,m.destinationId,controller.signal,m.id);await disk.removeMediaFiles(m.id);return {saved:true,filename};}
  if(source.sabr){const streams=await downloadYoutube(source,p,controller.signal,onBytes,descriptor=>rpc('youtubeSession',{descriptor}),(url,options)=>control.run(async sessionSignal=>request(url,source.referer,{...options,signal:AbortSignal.any([sessionSignal,options.signal || sessionSignal])})),()=>disk.createMediaFile(m.id,'input'));for(const s of streams){const name=(s.format.videoCodec?'video':'audio')+'.'+s.format.ext;inputs.push({name,file:new File([await disk.readMediaFile(s.path)],name)});}}
  else{inputs.push(...await Promise.all([p.video&&{name:'video.'+p.video.ext,format:p.video},p.audio&&{name:'audio.'+p.audio.ext,format:p.audio}].filter(Boolean).map(async f=>{const result=await trackDownload(f.format);return {name:f.name,file:new File([await disk.readMediaFile(result.path)],f.name)};})));}
  for(const format of [p.video,p.audio].filter(Boolean))progress.complete(format);report(true);
  await control.wait();await rpc('progress',{id:m.id,state:'processing',progress:null});
  const args=['-y',...inputs.flatMap(f=>['-i','input:'+f.name]),...(m.kind==='audio'?['-map','0:a:0','-vn']:inputs.length===2?['-map','0:v:0','-map','1:a:0']:['-map','0:v:0','-map','0:a:0?']),'-c','copy',...(p.ext==='mp4'||p.ext==='m4a'?['-movflags','+faststart']:[]),'output.'+p.ext];
  const result=await mux(inputs,args,'output.'+p.ext,controller.signal,m.id,m.destinationId);if(result.saved){await disk.removeMediaFiles(m.id);return {saved:true,filename};}const blobId=crypto.randomUUID(),url=URL.createObjectURL(new File([await disk.readMediaFile(result.path)],filename,{type:m.kind==='audio'?(p.ext==='m4a'?'audio/mp4':p.ext==='mp3'?'audio/mpeg':p.ext==='ogg'?'audio/ogg':'audio/webm'):(p.ext==='mp4'?'video/mp4':p.ext==='webm'?'video/webm':'video/x-matroska')}));blobs.set(blobId,{url,scope:m.id});return {url,filename,blobId};
 }catch(error){controller.abort();await disk.removeMediaFiles(m.id).catch(()=>{});throw error;}finally{controllers.delete(m.id);controls.delete(m.id);}
}
async function subtitle(m){const source=sources.get(m.sourceId),track=source?.tracks[m.index];if(!track)throw new Error('字幕来源已失效');let segments=track.segments;if(track.playlist)segments=hls(await (await request(track.url,source.referer)).text(),track.url).segments;const cues=[];if(segments?.length){for(const s of segments)cues.push(...parseSubtitles(await (await request(s.resolvedUri || absolute(s.uri,track.url),source.referer)).text()));}else cues.push(...parseSubtitles(await (await request(track.url,source.referer)).text()));return {cues,language:track.language};}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(m.target!=='offscreen'||sender.id!==chrome.runtime.id)return;const action=async()=>{switch(m.action){case 'inspect':{inspecting++;try{return await inspect(m);}finally{inspecting--;}}case 'retain':{const s=sources.get(m.sourceId);if(!s)throw new Error('來源資訊已失效，請重新整理');s.references=(s.references || 0)+1;return {title:s.title};}case 'forget':{const s=sources.get(m.sourceId);if(s)s.references=Math.max(0,(s.references || 0)-1);return {};}case 'download':return download(m);case 'subtitle':return subtitle(m);case 'cancel':controllers.get(m.id)?.abort();return {};case 'pause':controls.get(m.id)?.pause();return {};case 'resume':controls.get(m.id)?.resume();return {};case 'cleanup':for(const controller of controllers.values())controller.abort();for(const entry of blobs.values())URL.revokeObjectURL(entry.url);blobs.clear();await startupCleanup;await disk.removeMediaFiles();sources.clear();return {};case 'release':{const entry=blobs.get(m.blobId);if(entry){URL.revokeObjectURL(entry.url);await disk.removeMediaFiles(entry.scope);}blobs.delete(m.blobId);return {};}}};action().then(result=>respond({ok:true,result})).catch(error=>{const failure=classifyFailure(error,m.action==='subtitle'?'subtitle':m.action==='inspect'?'inspect':'download');respond({ok:false,error:failure.message,failure});});return true;});
setInterval(()=>{if(controllers.size||blobs.size||inspecting)void rpc('heartbeat').catch(()=>{});},20000);

