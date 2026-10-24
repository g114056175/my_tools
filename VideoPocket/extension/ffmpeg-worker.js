importScripts('destinations.js', 'disk-media.js', 'file-save.js', 'opfs-filesystem.js', 'ffmpeg-diagnostics.js', 'vendor/ffmpeg-core.js');
let core,cancelled=false;
const disk=self.VideoPocketDiskMedia;
async function initCore(){
 const coreURL=new URL('vendor/ffmpeg-core.js',self.location.href).href,wasmURL=new URL('vendor/ffmpeg-core.wasm',self.location.href).href;let logger;
 const instance=await createFFmpegCore({mainScriptUrlOrBlob:coreURL+'#'+btoa(JSON.stringify({wasmURL,workerURL:''})),locateFile:name=>name.endsWith('.wasm')?wasmURL:new URL('vendor/'+name,self.location.href).href,noInitialRun:true,noExitRuntime:true,print:()=>{},printErr:message=>logger?.({message})});
 if(typeof instance.exec!=='function'){
  instance.exec=(...args)=>{try{const result=instance.callMain(['-nostdin','-y',...args]);return Number.isInteger(result)?result:0;}catch(error){if(error.name==='ExitStatus')return error.status;throw error;}};
  instance.setLogger=callback=>{logger=callback;};instance.setProgress=()=>{};instance.reset=()=>{};
 }
 return instance;
}
onmessage=async({data})=>{
 if(data.action==='cancel'){cancelled=true;return;}cancelled=false;
 const processingBegan=Date.now(),mounts=[],diagnostics=VideoPocketFFmpegDiagnostics();let output,finished=false,failureCode;
 try{
  core=await initCore();core.setLogger(({message})=>{diagnostics.observe(message);if(/out of memory|Cannot enlarge memory|memory access out of bounds|allocation failed/i.test(message))failureCode='MEMORY_LIMIT';if(/No space left on device|QuotaExceededError/i.test(message))failureCode='TEMP_STORAGE_FULL';});
  const inputs=data.inputs || [];if(inputs.some(f=>!f.file?.name)||!core.FS.filesystems?.WORKERFS)throw new Error('合併輸入檔格式無效');
  for(const f of inputs)if(f.name!==f.file.name)throw new Error('合併輸入檔名稱不一致');
  try{core.FS.mkdir('/inputs');}catch{}core.FS.mount(core.FS.filesystems.WORKERFS,{files:inputs.map(f=>f.file)},'/inputs');mounts.push('/inputs');
  output=await disk.createSyncMediaFile(data.scope || 'ffmpeg-output',data.outputPath || data.output);
  try{core.FS.mkdir('/output');}catch{}core.FS.mount(VideoPocketOutputFS(core.FS,output.access,data.output),{},'/output');mounts.push('/output');
  if(data.guardOutputReadFile){const read=core.FS.readFile;core.FS.readFile=(file,...args)=>{if(String(file).includes(data.output))throw new Error('disk output must not call FS.readFile');return read.call(core.FS,file,...args);};}
  if(data.guardWorkerFsInput){const write=core.FS.writeFile;core.FS.writeFile=(file,...args)=>{if(String(file).startsWith('/inputs/'))throw new Error('disk inputs must not call FS.writeFile');return write.call(core.FS,file,...args);};}
  const args=(data.args || []).map(arg=>String(arg).startsWith('input:')?'/inputs/'+String(arg).slice(6):arg===data.output?'/output/'+data.output:arg);
  core.setProgress(({progress})=>postMessage({type:'progress',progress}));const code=core.exec(...args);if(code!==0)throw Object.assign(new Error('來源影音無法合併或抽取音訊'),{code:failureCode || 'MERGE_FAILED',...diagnostics.failure(code)});
  for(const mount of mounts.splice(0).reverse())core.FS.unmount(mount);
  const result=output.finish();finished=true;
  if(data.destinationId)postMessage({type:'readyToSave',...result});
  const processingMs=Date.now()-processingBegan,saveBegan=Date.now();
  const saved=data.destinationId?await VideoPocketFileSave({path:result.path,destinationId:data.destinationId,cancelled:()=>cancelled,onStart:()=>postMessage({type:'saving'}),onProgress:progress=>postMessage({type:'saveProgress',progress})}):{saved:false};
  postMessage({type:'done',...result,...saved,timings:{processingMs,...(data.destinationId?{saveMs:Date.now()-saveBegan}:{})}});
 }catch(error){if(output&&!finished){await Promise.resolve(output.abort?.()).catch(()=>{});output=null;}postMessage({type:'error',error:error.message || String(error),errorCode:error.code || (error.name==='QuotaExceededError'?'TEMP_STORAGE_FULL':failureCode),saveStage:error.saveStage,saveReason:error.saveReason,...(error.processingReason?{processingReason:error.processingReason,ffmpegExitCode:error.ffmpegExitCode}:{})});}
 finally{for(const mount of mounts.reverse())try{core.FS.unmount(mount);}catch{}if(output&&!finished)await Promise.resolve(output.abort?.()).catch(()=>{});core?.reset();}
};
