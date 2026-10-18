const positive=n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):null;
export function sourceSize(format,duration,audioOnly=false){
  if(!format)return null;
  if(!audioOnly){const exact=positive(format.filesize);if(exact)return {bytes:exact,approximate:false};const approx=positive(format.filesize_approx);if(approx)return {bytes:approx,approximate:true};}
  const seconds=positive(format.duration) || positive(duration),rate=positive(audioOnly?format.abr:format.tbr) || (!audioOnly?positive(format.vbr):null);
  return seconds&&rate?{bytes:seconds*rate*125,approximate:true}:null;
}
export function videoSize(video,audio,duration,remux=false){
  const v=sourceSize(video,duration);if(!v)return null;
  if(!audio||audio===video)return {...v,approximate:v.approximate||remux};
  const a=sourceSize(audio,duration);return a?{bytes:v.bytes+a.bytes,approximate:true}:null;
}
export function audioSize(source,target,quality,duration,extracted=false){
  const c=String(source.acodec || '').toLowerCase(),same=target==='m4a'&&/^(aac|mp4a)/.test(c)||target==='mp3'&&/^mp3/.test(c);
  if(target==='original'||quality==='best'&&same)return sourceSize(source,duration,extracted);
  // MP3 best uses variable bitrate; do not present an invented fixed size.
  if(target==='mp3'&&quality==='best')return null;
  const seconds=positive(source.duration) || positive(duration),rate=quality==='best'?192:positive(quality);
  return seconds&&rate?{bytes:seconds*rate*125,approximate:true}:null;
}
export function progressTracker(plan,formats,duration){
  const ids=String(plan.selector).split('+'),sizes=ids.map(id=>sourceSize(formats.find(f=>String(f.format_id)===id),duration)?.bytes),known=sizes.every(Boolean),weights=new Map(ids.map((id,i)=>[id,known?sizes[i]:1])),values=new Map();
  return (id,percent)=>{
    if(!Number.isFinite(percent))return null;
    const value=Math.max(0,Math.min(100,percent));if(!weights.has(id)||ids.length===1)return value;
    values.set(id,value);let sum=0,total=0;for(const [key,weight] of weights){sum+=weight*(values.get(key)||0);total+=weight;}return sum/total;
  };
}
