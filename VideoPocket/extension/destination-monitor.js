// Poll only while a native Save As choice is pending. Keep one check in flight
// and stop scheduling as soon as the last choosing job leaves that state.
export function createDestinationMonitor({pending,check,intervalMs=200,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>{}}){
 let timer=null,running=false,stopped=false;
 const refresh=()=>{
  if(stopped||!pending()){
   if(timer!==null)clearTimer(timer);timer=null;return;
  }
  if(timer===null&&!running)timer=setTimer(()=>{timer=null;void tick();},intervalMs);
 };
 const tick=async()=>{
  if(stopped||running||!pending()){refresh();return;}
  running=true;
  try{await check();}catch(error){onError(error);}finally{running=false;refresh();}
 };
 return {refresh,stop(){stopped=true;if(timer!==null)clearTimer(timer);timer=null;},check:tick};
}
