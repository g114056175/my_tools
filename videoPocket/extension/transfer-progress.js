// Download progress measures input work, independently of estimated output size.
// Segments contribute only after a complete, verified segment is committed.
export function createTransferProgress(formats,legacyExpected=0){
 const inputs=[...new Set(formats.filter(Boolean))],segmented=inputs.some(f=>f.segments?.length);
 const tracks=new Map(inputs.map(format=>{
  const segments=format.segments || [],durations=segments.map(s=>Number(s.duration)>0?Number(s.duration):0),useDurations=durations.length&&durations.every(n=>n>0),weights=segments.map((_,i)=>useDurations?durations[i]:1);
  return [format,{bytes:0,done:false,seen:new Set(),weights,total:weights.reduce((a,b)=>a+b,0),committed:0}];
 }));
 const exact=inputs.length&&inputs.every(f=>Number(f.filesize)>0),expected=exact?inputs.reduce((sum,f)=>sum+Number(f.filesize),0):Number(legacyExpected)||0;
 let monotonic=0;
 const state=format=>tracks.get(format);
 return {
  bytes(format,count){const track=state(format);if(track&&Number.isFinite(count)&&count>0)track.bytes+=count;},
  segment(format,index){const track=state(format);if(!track||!Number.isInteger(index)||index<0||index>=track.weights.length||track.seen.has(index))return;track.seen.add(index);track.committed+=track.weights[index];},
  complete(format){const track=state(format);if(track)track.done=true;},
  percent(){
   if(!inputs.length)return null;
   if([...tracks.values()].every(t=>t.done))return 100;
   let fraction;
   if(segmented)fraction=inputs.reduce((sum,f)=>{const t=state(f);return sum+(t.done?1:t.total?t.committed/t.total:Number(f.filesize)>0?Math.min(1,t.bytes/f.filesize):0);},0)/inputs.length;
   else{if(!(expected>0))return null;fraction=[...tracks.values()].reduce((sum,t)=>sum+t.bytes,0)/expected;}
   monotonic=Math.max(monotonic,Math.max(0,Math.min(segmented?100:99,fraction*100)));return monotonic;
  }
 };
}
