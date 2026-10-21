// Download progress measures input work, independently of estimated output size.
// Known byte ranges expose real in-flight reads; 100% requires verified segments.
export function createTransferProgress(formats,legacyExpected=0){
 const inputs=[...new Set(formats.filter(Boolean))],segmented=inputs.some(f=>f.segments?.length);
 const tracks=new Map(inputs.map(format=>{
  const segments=format.segments || [],durations=segments.map(s=>Number(s.duration)>0?Number(s.duration):0),useDurations=durations.length&&durations.every(n=>n>0),weights=segments.map((_,i)=>useDurations?durations[i]:1);
  // SIDX plans carry the exact media byte range for every selected segment.
  // Keep this separate from `bytes`: the latter is an attempt counter and
  // can include a losing hedge.  A byte-weighted plan is enabled below only
  // when every segmented track has a trustworthy range for every segment.
  const byteWeights=segments.map(s=>{
   const value=Number(s?.length ?? s?.byterange?.length ?? s?.byteLength);
   return Number.isSafeInteger(value)&&value>0?value:0;
  });
  return [format,{bytes:0,done:false,seen:new Set(),weights,total:weights.reduce((a,b)=>a+b,0),committed:0,byteWeights,byteTotal:byteWeights.reduce((a,b)=>a+b,0),attempts:new Map()}];
 }));
 const byteWeighted=segmented&&inputs.length>0&&inputs.every(f=>{
  const t=tracks.get(f);return !!f.segments?.length&&t.byteWeights.length===f.segments.length&&t.byteWeights.every(n=>n>0);
 });
 const weightedTotal=byteWeighted?[...tracks.values()].reduce((sum,t)=>sum+t.byteTotal,0):0;
 const exact=inputs.length&&inputs.every(f=>Number(f.filesize)>0),expected=exact?inputs.reduce((sum,f)=>sum+Number(f.filesize),0):Number(legacyExpected)||0;
 let monotonic=0;
 const state=format=>tracks.get(format);
 return {
  // Range hedges may report tentative bytes and roll them back when that
  // attempt loses or fails. Keep the committed byte estimate non-negative.
  bytes(format,count){const track=state(format);if(track&&Number.isFinite(count)&&count!==0)track.bytes=Math.max(0,track.bytes+count);},
  // `received` is an absolute count for one attempt.  Losing/failed attempts
  // can therefore be removed without subtracting bytes that a winner owns.
  segmentBytes(format,index,received,attempt='default'){
   const track=state(format);if(!track||!Number.isInteger(index)||index<0||index>=track.weights.length||track.seen.has(index)||!Number.isFinite(received)||received<0)return;
   let attempts=track.attempts.get(index);if(!attempts){attempts=new Map();track.attempts.set(index,attempts);}
   attempts.set(attempt,Math.max(attempts.get(attempt)||0,received));
  },
  clearSegmentAttempt(format,index,attempt='default'){
   const track=state(format),attempts=track?.attempts.get(index);if(!attempts)return;
   attempts.delete(attempt);if(!attempts.size)track.attempts.delete(index);
  },
  segment(format,index){const track=state(format);if(!track||!Number.isInteger(index)||index<0||index>=track.weights.length||track.seen.has(index))return;track.attempts.delete(index);track.seen.add(index);track.committed+=track.weights[index];},
  complete(format){const track=state(format);if(track)track.done=true;},
  percent(){
   if(!inputs.length)return null;
   const allVerified=[...tracks.values()].every(t=>t.done || (segmented&&t.weights.length>0&&t.seen.size===t.weights.length));
   if(allVerified)return 100;
   let fraction;
   if(segmented&&byteWeighted)fraction=[...tracks.values()].reduce((sum,t)=>sum+(t.done?t.byteTotal:[...t.seen].reduce((n,i)=>n+t.byteWeights[i],0)+[...t.attempts].reduce((n,[i,attempts])=>n+(t.byteWeights[i]||0)*Math.min(1,Math.max(...attempts.values(),0)/(t.byteWeights[i]||1)),0)),0)/weightedTotal;
   else if(segmented)fraction=inputs.reduce((sum,f)=>{const t=state(f);return sum+(t.done?1:t.total?t.committed/t.total:Number(f.filesize)>0?Math.min(1,t.bytes/f.filesize):0);},0)/inputs.length;
   else{if(!(expected>0))return null;fraction=[...tracks.values()].reduce((sum,t)=>sum+t.bytes,0)/expected;}
   monotonic=Math.max(monotonic,Math.max(0,Math.min(99,fraction*100)));return monotonic;
  }
 };
}
