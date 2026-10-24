export function codec(value){const s=String(value || '').toLowerCase();for(const [pattern,name] of [[/avc|h264/,'h264'],[/hev|hvc/,'hevc'],[/av01|av1/,'av1'],[/vp09|vp9/,'vp9'],[/vp8/,'vp8'],[/mp4a|aac/,'aac'],[/opus/,'opus'],[/vorbis/,'vorbis'],[/mp3/,'mp3']])if(pattern.test(s))return name;return s==='none'?'':s;}
export function metadataCodecs(mime=''){
 const codecs=mime.match(/codecs\s*=\s*"([^"]+)"/i)?.[1]?.split(',') || [];
 return {videoCodec:codecs.map(codec).find(c=>['h264','hevc','av1','vp9','vp8'].includes(c)) || '',audioCodec:codecs.map(codec).find(c=>['aac','opus','vorbis','mp3'].includes(c)) || ''};
}
function averageSize(bitrate,duration){
 const rate=Number(bitrate),seconds=Number(duration),bytes=rate*seconds/8;
 return Number.isFinite(rate)&&rate>0&&Number.isFinite(seconds)&&seconds>0&&Number.isFinite(bytes)&&bytes>0?{bytes,approximate:true}:null;
}
export function sizeOf(f,duration){
 const bytes=Number(f.filesize);
 if(Number.isFinite(bytes)&&bytes>0)return {bytes,approximate:false};
 // A rate must describe this exact complete resource, not a rendition group's
 // largest playable combination. Never scale a whole-file average to a cut.
 return f.averageBitrateScope==='format'?averageSize(f.averageBitrate,f.duration || duration):null;
}
function combinedSize(v,a,duration){
 const x=sizeOf(v,duration);if(!a)return x;const y=sizeOf(a,duration);
 if(x&&y)return {bytes:x.bytes+y.bytes,approximate:true};
 // The variant average already includes its one explicitly bound audio track.
 // Adding an audio size/rate again would double-count it.
 return v.averageBitrateScope==='variant'&&v.averageAudioId===a.id&&a.id!=null
  ?averageSize(v.averageBitrate,v.duration || duration):null;
}
// Quality tiers use the short edge; retain the source's actual dimensions for
// decoding, transport and range plans. Older sources may only declare height.
export function qualityOfFormat(format={}){
 const width=Number(format.width),height=Number(format.height);
 return Math.round(width>0&&Number.isFinite(width)&&height>0&&Number.isFinite(height)?Math.min(width,height):height>0&&Number.isFinite(height)?height:0);
}
export function mediaChoices(source){
 const formats=source.formats.filter(f=>!f.drm&&(f.url||f.segments?.length||f.sabr)),video=formats.filter(f=>f.videoCodec||f.height||f.kind==='video'),audio=formats.filter(f=>f.audioCodec&&!f.videoCodec&&!f.height);
 const rankAudio=f=>(f.audioCodec==='aac'?1e9:0)+(f.bitrate||0);audio.sort((a,b)=>rankAudio(b)-rankAudio(a));
 const plans={video:{auto:{}},audio:{original:{}}};
 const compatible=(v,a)=>v.ext==='mp4'&&a.audioCodec==='aac'||v.ext==='webm'&&['opus','vorbis'].includes(a.audioCodec);
 video.sort((a,b)=>qualityOfFormat(b)-qualityOfFormat(a)||Number(b.videoCodec==='h264')-Number(a.videoCodec==='h264')||(b.bitrate||0)-(a.bitrate||0));
 for(const v of video){const candidates=v.audioGroup?audio.filter(a=>a.audioGroup===v.audioGroup):audio;const a=v.audioCodec?null:candidates.find(a=>compatible(v,a)) || candidates[0];if(!v.audioCodec&&source.requiresAudio&&!a&&!v.audioAbsent)continue;
  const ext=a?(compatible(v,a)?v.ext:'mkv'):v.ext==='ts'?'mp4':v.ext || 'mp4';
  const p={video:v,audio:a,ext,size:combinedSize(v,a,source.duration),direct:!source.sabr&&!a&&!v.segments?.length&&v.ext!=='ts'};
  const quality=qualityOfFormat(v);if(!plans.video.auto[quality])plans.video.auto[quality]=p;
 }
 const best=Object.values(plans.video.auto)[0];if(best)plans.video.auto[0]=video.map(v=>plans.video.auto[qualityOfFormat(v)]).find(Boolean);
 const muxed=video.filter(v=>v.audioCodec).sort((a,b)=>(b.audioBitrate || 0)-(a.audioBitrate || 0)||(a.bitrate || 0)-(b.bitrate || 0)),allAudio=[...audio,...muxed];
 const audioRate=f=>f.videoCodec||f.height?f.audioBitrate || 0:f.audioBitrate || f.bitrate || 0;
 for(const f of allAudio){const ext=f.audioCodec==='aac'?'m4a':f.audioCodec==='mp3'?'mp3':f.ext==='webm'?'webm':'ogg';const quality=String(Math.round(audioRate(f)/1000));const p={audio:f,ext,direct:!source.sabr&&!f.videoCodec&&!f.height&&!f.segments?.length,size:f.videoCodec||f.height?f.audioAverageBitrateScope==='track'?averageSize(f.audioAverageBitrate,f.duration || source.duration):null:sizeOf(f,source.duration)};if(source.sabr&&p.size)p.size={...p.size,approximate:true};if(!plans.audio.original[quality])plans.audio.original[quality]=p;}
 const audioBest=allAudio.find(f=>plans.audio.original[String(Math.round(audioRate(f)/1000))]);if(audioBest)plans.audio.original.best=plans.audio.original[String(Math.round(audioRate(audioBest)/1000))];
 const v=plans.video.auto,a=plans.audio.original;
 return {plans,choices:{video:{auto:{enabled:!!v[0],heights:Object.keys(v).map(Number).filter(Boolean).sort((a,b)=>b-a),sizes:Object.fromEntries(Object.entries(v).map(([k,p])=>[k,p.size])),extensions:Object.fromEntries(Object.entries(v).map(([k,p])=>[k,p.ext]))}},audio:{original:{enabled:!!a.best,qualities:a.best?['best',...Object.keys(a).filter(k=>k!=='best'&&k!=='0').sort((a,b)=>Number(b)-Number(a))]:[],sizes:Object.fromEntries(Object.entries(a).map(([k,p])=>[k,p.size])),extensions:Object.fromEntries(Object.entries(a).map(([k,p])=>[k,p.ext]))}}}};
}
export function selectedPlan(capability,message){const plan=message.kind==='audio'?capability.plans.audio.original[message.audioQuality || 'best']:capability.plans.video.auto[Number(message.height)||0];if(!plan)throw new Error('所選格式或品質已不可用，請重新整理');return plan;}
export function parseMp4Codecs(bytes){
 const text=new TextDecoder('latin1').decode(bytes),v=text.match(/avc1|avc3|hvc1|hev1|av01|vp09/),a=text.match(/mp4a|Opus|vorb|\.mp3/);
 return {videoCodec:v?codec(v[0]):'',audioCodec:a?codec(a[0]):''};
}
