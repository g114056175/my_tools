export function createDownloadStallGuard({now=Date.now,timeoutMs=120_000}={}){
 if(typeof now!=='function')throw new TypeError('now must be a function');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('timeoutMs must be a positive finite number');

 const downloads=new Map();
 const reset=id=>downloads.delete(id);

 function update(item,{paused=false,choosing=false}={}){
  const id=item?.id;
  if(id==null)return false;
  const state=item?.state;
  const bytes=Number(item?.bytesReceived);
  if(state!=='in_progress'||item?.paused===true||paused||choosing||!Number.isFinite(bytes)||bytes<0){
   reset(id);
   return false;
  }

  const time=Number(now());
  if(!Number.isFinite(time)){
   reset(id);
   return false;
  }

  const previous=downloads.get(id);
  if(!previous||time<previous.since){
   downloads.set(id,{bytes,since:time});
   return false;
  }
  if(bytes>previous.bytes){
   downloads.set(id,{bytes,since:time});
   return false;
  }
  return time-previous.since>=timeoutMs;
 }

 return {update,reset,clear:()=>downloads.clear()};
}
