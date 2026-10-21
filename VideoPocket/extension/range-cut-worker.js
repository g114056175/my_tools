importScripts('disk-media.js','vendor/mediabunny.js','range-mp4-copy.js','range-smart.js','range-cut.js');
let cancelled=false;
onmessage=async({data})=>{
 if(data.action==='cancel'){cancelled=true;VideoPocketRangeCut.cancel();return;}
 cancelled=false;
 try{
  const result=await VideoPocketRangeCut.cutRange({...data,signal:{get aborted(){return cancelled;}},onProgress:progress=>postMessage({type:'cutProgress',progress})});
  postMessage({type:'done',...result});
 }catch(error){postMessage({type:'error',error:error.message||String(error),errorCode:cancelled?'CANCELLED':error.code||'RANGE_PROCESSING_FAILED'});}
};
