import {videoSize,audioSize} from './sizes.mjs';
export function codec(value){
  const s=String(value || '').toLowerCase();
  for(const [pattern,name] of [[/^(avc|h264)/,'h264'],[/^(hev|hvc|hevc)/,'hevc'],[/^(av01|av1)/,'av1'],[/^(vp09|vp9)/,'vp9'],[/^vp8/,'vp8'],[/^(mp4a|aac)/,'aac'],[/^mp3/,'mp3'],[/^opus/,'opus'],[/^vorbis/,'vorbis'],[/^flac/,'flac'],[/^alac/,'alac'],[/^ac-?3/,'ac3'],[/^eac-?3/,'eac3'],[/^mpeg4/,'mpeg4'],[/^mpeg2/,'mpeg2video'],[/^theora/,'theora']])if(pattern.test(s))return name;
  return s==='none'?'':s;
}
const mp4v=new Set(['h264','hevc','av1','vp9','mpeg4','mpeg2video']);
const mkvv=new Set([...mp4v,'vp8','theora']);
const mp4a=new Set(['aac','mp3','alac','ac3','eac3']);
const mkva=new Set([...mp4a,'opus','vorbis','flac']);
const muxForAudio={aac:'ipod',mp3:'mp3',opus:'opus',vorbis:'ogg',flac:'flac',alac:'ipod',ac3:'ac3'};
export function buildCapabilities(rawFormats,tools,duration){
  const mux=new Set(tools.muxers || []),enc=new Set(tools.encoders || []),dec=new Set(tools.decoders || []);
  const formats=rawFormats.filter(f=>!f.has_drm && f.url && /^[\w.:-]+$/.test(String(f.format_id)));
  const video=formats.filter(f=>codec(f.vcodec)),audio=formats.filter(f=>codec(f.acodec));
  const byAudio=(a,b)=>(Number(b.abr)||Number(b.tbr)||0)-(Number(a.abr)||Number(a.tbr)||0);
  const sortedAudio=[...audio].sort((a,b)=>Number(!!codec(a.vcodec))-Number(!!codec(b.vcodec))||byAudio(a,b));
  const plans={video:{auto:{},mp4:{},mkv:{}},audio:{}};
  const compatible=(v,a,container)=>container==='mp4'?mp4v.has(codec(v.vcodec))&&(!a||mp4a.has(codec(a.acodec))):container==='mkv'?mkvv.has(codec(v.vcodec))&&(!a||mkva.has(codec(a.acodec))):false;
  for(const format of ['auto','mp4','mkv']){
    const candidates=[];
    for(const v of video){
      let a=codec(v.acodec)?v:sortedAudio.find(f=>!codec(f.vcodec)&&(format==='auto'||compatible(v,f,format)));
      // Do not offer a silent video when the source exposes audio we cannot merge.
      if(!a && audio.length)continue;
      let container=format;
      if(format==='auto'){
        if(!a || a===v)container=v.ext;
        else if(v.ext==='mp4'&&compatible(v,a,'mp4')&&mux.has('mp4'))container='mp4';
        else if(['vp8','vp9','av1'].includes(codec(v.vcodec))&&['opus','vorbis'].includes(codec(a.acodec))&&mux.has('webm'))container='webm';
        else if(compatible(v,a,'mkv')&&mux.has('matroska'))container='mkv';else continue;
      }else if(!compatible(v,a,format)||!mux.has(format==='mkv'?'matroska':format))continue;
      if(a && a!==v && !mux.has(container==='mkv'?'matroska':container))continue;
      candidates.push({selector:String(v.format_id)+(a&&a!==v?'+'+a.format_id:''),height:Number(v.height)||0,container,merged:!!a&&a!==v,size:videoSize(v,a,duration,format!=='auto'&&format!==v.ext),videoCodec:codec(v.vcodec),audioCodec:a?codec(a.acodec):'',score:(Number(v.height)||0)*1e7+(Number(v.fps)||0)*1e4+(Number(v.tbr)||0)});
    }
    candidates.sort((a,b)=>b.score-a.score);
    for(const p of candidates)if(!plans.video[format][p.height])plans.video[format][p.height]=p;
    if(candidates.length)plans.video[format][0]=candidates[0];
  }
  for(const target of ['original','mp3','m4a']){
    const candidate=sortedAudio.find(f=>{
      const c=codec(f.acodec);
      if(target==='original')return !codec(f.vcodec) || !!muxForAudio[c]&&mux.has(muxForAudio[c]);
      return dec.has(c)&&enc.has(target==='mp3'?'libmp3lame':'aac')&&mux.has(target==='mp3'?'mp3':'ipod');
    });
    if(candidate){const qualities=target==='original'?['best']:['best','128','192','320'];plans.audio[target]={selector:String(candidate.format_id),codec:codec(candidate.acodec),ext:candidate.ext,extract:!!codec(candidate.vcodec),qualities,sizes:Object.fromEntries(qualities.map(q=>[q,audioSize(candidate,target,q,duration,!!codec(candidate.vcodec))]))};}
  }
  return {plans,choices:{video:Object.fromEntries(Object.entries(plans.video).map(([f,items])=>[f,{enabled:!!items[0],heights:Object.keys(items).map(Number).filter(Boolean).sort((a,b)=>b-a),sizes:Object.fromEntries(Object.entries(items).map(([h,p])=>[h,p.size]))}])),audio:Object.fromEntries(['original','mp3','m4a'].map(f=>[f,{enabled:!!plans.audio[f],qualities:plans.audio[f]?.qualities || [],sizes:plans.audio[f]?.sizes || {}}]))}};
}
export function choosePlan(capabilities,message){
  const plan=message.kind==='video'?capabilities.plans.video[message.videoFormat || 'auto']?.[Number(message.height)||0]:capabilities.plans.audio[message.audioFormat || 'original'];
  if(!plan)throw new Error('來源的可用選項已變更，請更新影片資訊。');
  if(message.kind==='audio'&&!plan.qualities.includes(message.audioQuality || 'best'))throw new Error('音訊品質選項無效');
  return plan;
}
