import {codec,metadataCodecs} from './browser-media.js';

// Normalize known platform responses into the same transport format model.
export function platformSource(platform){
 if(platform.site==='bilibili'){
  if(platform.sourceFailure){const failure=platform.sourceFailure;throw Object.assign(new Error(failure.message || 'Bilibili 播放來源無法取得'),{code:failure.code || 'SOURCE_UNAVAILABLE',sourceStage:'bilibili-playurl',httpStatus:Number(failure.httpStatus)||undefined,apiCode:Number(failure.apiCode)||undefined});}
  const data=platform.data || {},formats=[];
  for(const [kind,items] of [['video',data.dash?.video],['audio',data.dash?.audio]])for(const [i,f] of (items || []).entries()){const url=f.baseUrl || f.base_url;if(!url)continue;const segmentBase=f.SegmentBase || f.segment_base || {};formats.push({id:kind+i,url,backupUrls:f.backupUrl || f.backup_url || [],ext:'mp4',kind,width:kind==='video'?f.width:0,height:kind==='video'?f.height:0,videoCodec:kind==='video'?codec(f.codecs):'',audioCodec:kind==='audio'?codec(f.codecs):'',bitrate:f.bandwidth,filesize:f.size || null,indexRange:f.indexRange || f.index_range || segmentBase.indexRange || segmentBase.index_range,initRange:f.initRange || f.initializationRange || segmentBase.Initialization || segmentBase.initialization});}
  for(const [i,f] of (data.durl || []).entries())if(f.url)formats.push({id:'durl'+i,url:f.url,ext:/\.flv(?:\?|$)/i.test(f.url)?'flv':'mp4',kind:'video',videoCodec:'h264',audioCodec:'aac',width:platform.width || 0,height:platform.height || 0,filesize:f.size});
  if(!formats.length)throw Object.assign(new Error('Bilibili 未提供可下載格式'),{code:'SOURCE_UNAVAILABLE',sourceStage:'bilibili-playurl'});
  return {title:platform.title,duration:platform.duration,formats,tracks:[],requiresAudio:true,forceDisk:true};
 }
 if(platform.site==='youtube'){
  const data=platform.streamingData || {},formats=[];
  const available=data.serverAbrStreamingUrl?(data.adaptiveFormats || []):[...(data.formats || []),...(data.adaptiveFormats || [])];
  for(const [i,f] of available.entries()){
   let url=f.url;if(!url&&f.signatureCipher){const p=new URLSearchParams(f.signatureCipher);if(!p.get('s')){const u=new URL(p.get('url'));if(p.get('sig'))u.searchParams.set(p.get('sp') || 'signature',p.get('sig'));url=u.href;}}
   if(!url&&!data.serverAbrStreamingUrl)continue;const codes=metadataCodecs(f.mimeType);formats.push({...f,id:String(f.itag)+'-'+i,itag:f.itag,url,sabr:!!data.serverAbrStreamingUrl,lastModified:f.lastModified || '0',approxDurationMs:Number(f.approxDurationMs)||platform.duration*1000,audioTrackId:f.audioTrack?.id || f.audioTrackId,ext:f.mimeType.includes('webm')?'webm':'mp4',...codes,height:f.height||0,bitrate:f.bitrate,averageBitrateScope:'format',duration:Number(f.approxDurationMs)/1000 || platform.duration,audioBitrate:f.audioBitrate?f.audioBitrate*1000:undefined,filesize:Number(f.contentLength)||null});
  }
  const sabr=formats.some(f=>f.sabr);
  return {title:platform.title,duration:platform.duration,formats,tracks:[],requiresAudio:true,sabr};
 }
}
