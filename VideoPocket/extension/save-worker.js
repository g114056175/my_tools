importScripts('destinations.js','disk-media.js','file-save.js');
let cancelled=false;
onmessage=async({data})=>{
 if(data.action==='cancel'){cancelled=true;return;}cancelled=false;
 try{
  const result=await VideoPocketFileSave({path:data.path,destinationId:data.destinationId,cancelled:()=>cancelled,onProgress:progress=>postMessage({type:'progress',progress})});
  postMessage({type:'done',...result});
 }catch(error){postMessage({type:'error',error:error.message,code:error.code,saveStage:error.saveStage,saveReason:error.saveReason});}
};
