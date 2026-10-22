// Shared worker-side save. Only target-file failures can fall back to the
// browser download manager; cancellation and corrupt input must still fail.
(function(root){
 const targetStages=new Set(['get-target','open-target','write-target','close-target']);
 const reasons={NotAllowedError:'permission',SecurityError:'blocked',NotFoundError:'not-found',NotReadableError:'unreadable',NoModificationAllowedError:'busy',InvalidStateError:'invalid-state',AbortError:'aborted'};
 root.VideoPocketFileSave=async({path,destinationId,cancelled=()=>false,onStart=()=>{},onProgress=()=>{}})=>{
  let access,writer,stage='open-temp';
  const check=()=>{if(cancelled())throw Object.assign(new Error('已取消'),{code:'CANCELLED'});};
  try{
   check();const input=await root.VideoPocketDiskMedia.openSyncMediaFile(path);access=input.access;
   stage='read-temp';const size=access.getSize();if(!Number.isSafeInteger(size)||size<=0)throw Object.assign(new Error('輸出檔案不完整'),{code:'INCOMPLETE_MEDIA'});
   onStart();onProgress(0);check();stage='get-target';
   const target=await root.VideoPocketDestinations.get(destinationId);
   if(!target)throw new DOMException('儲存位置已失效','NotFoundError');
   stage='open-target';writer=await target.createWritable();
   const chunk=new Uint8Array(4*1024*1024);
   for(let at=0;at<size;){
    check();stage='read-temp';const count=access.read(chunk.subarray(0,Math.min(chunk.length,size-at)),{at});
    if(!count)throw Object.assign(new Error('輸出檔案不完整'),{code:'INCOMPLETE_MEDIA'});
    stage='write-target';await writer.write(chunk.subarray(0,count));at+=count;onProgress(at/size*100);
   }
   check();stage='close-target';await writer.close();writer=null;return {saved:true};
  }catch(error){
   try{await writer?.abort();}catch{}
   const targetFailure=targetStages.has(stage),quota=error.name==='QuotaExceededError';
   const code=cancelled()||error.code==='CANCELLED'?'CANCELLED':quota&&!targetFailure?'TEMP_STORAGE_FULL':error.code==='INCOMPLETE_MEDIA'?'INCOMPLETE_MEDIA':'SAVE_FAILED';
   const detail={code,saveStage:stage,saveReason:quota?'disk-full':reasons[error.name] || 'unknown'};
   if(code==='SAVE_FAILED'&&targetStages.has(stage))return {saved:false,saveFailure:detail};
   throw Object.assign(new Error(code==='CANCELLED'?'已取消':code==='INCOMPLETE_MEDIA'?'輸出檔案不完整':'檔案儲存失敗'),detail);
  }finally{try{access?.close();}catch{}}
 };
})(typeof self!=='undefined'?self:globalThis);
