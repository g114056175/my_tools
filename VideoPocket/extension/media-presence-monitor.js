export const mediaTargetKey=target=>JSON.stringify([target.documentId,Number(target.frameId),String(target.mediaKey)]);

export function createMediaPresenceMonitor({targets,read,onMissing,intervalMs=1200,setTimer=setTimeout,clearTimer=clearTimeout}){
 let stopped=true,timer=null,running=false,generation=0;
 const signature=list=>JSON.stringify(list.map(mediaTargetKey));
 const schedule=()=>{if(!stopped&&timer===null)timer=setTimer(()=>{timer=null;void tick();},intervalMs);};
 const tick=async()=>{
  if(stopped||running)return;
  const current=targets();if(!current.length){schedule();return;}
  const before=signature(current),turn=generation;running=true;
  try{
   const result=await read(current);
   if(stopped||generation!==turn||before!==signature(targets())||result?.checked!==true||!Array.isArray(result.missing))return;
   const expected=new Set(current.map(mediaTargetKey)),missing=result.missing.filter(target=>expected.has(mediaTargetKey(target)));
   if(missing.length)await onMissing(missing);
  }catch{}finally{running=false;schedule();}
 };
 return {start(){if(!stopped)return;stopped=false;generation++;schedule();},stop(){stopped=true;generation++;if(timer!==null)clearTimer(timer);timer=null;},check:tick};
}
