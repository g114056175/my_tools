importScripts('disk-media.js','vendor/mediabunny.js','range-mp4-copy.js','range-smart.js','range-h264-smart.js','range-cut.js');
let cancelled=false;
let activityStage=null,activityProgress=-Infinity,activityAt=0;
onmessage=async({data})=>{
 if(data.action==='cancel'){cancelled=true;VideoPocketRangeCut.cancel();return;}
 cancelled=false;
 try{
  activityStage=null;activityProgress=-Infinity;activityAt=0;
  const result=await VideoPocketRangeCut.cutRange({...data,signal:{get aborted(){return cancelled;}},onActivity:(stage,progress)=>{
   const now=Date.now(),changed=stage!==activityStage,advanced=Number.isFinite(progress)&&progress>activityProgress;
   if(changed||advanced&&now-activityAt>=250){activityStage=stage;if(Number.isFinite(progress))activityProgress=progress;activityAt=now;postMessage({type:'cutActivity',stage,progress});}
  },onProgress:progress=>postMessage({type:'cutProgress',progress})});
  postMessage({type:'done',...result});
 }catch(error){postMessage({type:'error',error:error.message||String(error),errorCode:cancelled?'CANCELLED':error.code||'RANGE_PROCESSING_FAILED',processingStage:error.processingStage});}
};
