import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {classifyFailure,briefFailure} from '../extension/diagnostics.js';
const source=await fs.readFile(new URL('../extension/ffmpeg-diagnostics.js',import.meta.url),'utf8');
function create(){const context={};vm.runInNewContext(source,context);return context.VideoPocketFFmpegDiagnostics();}

test('FFmpeg processing categories distinguish corrupt input, missing tracks and unsupported containers',()=>{
 for(const [message,reason] of [['moov atom not found','invalid-input'],['could not find corresponding trex (id 2)','invalid-input'],['Stream map 1:a:0 matches no streams','missing-track'],['Could not find tag for codec xyz in stream #0, codec not currently supported in container','unsupported-format'],['non monotonically increasing dts','timestamps']]){const diagnostics=create();diagnostics.observe(message);assert.equal(diagnostics.failure(1).processingReason,reason);}
});
test('FFmpeg diagnostic categories do not retain raw log paths, URLs or unknown text',()=>{
 const diagnostics=create();diagnostics.observe('https://private.example/file?token=SECRET');diagnostics.observe('/private/path: partial file');
 const value=diagnostics.failure(1);assert.equal(value.processingReason,'invalid-input');assert.ok(!JSON.stringify(value).includes('SECRET'));assert.ok(!JSON.stringify(value).includes('/private'));
 const safe=classifyFailure({code:'MERGE_FAILED',...value});assert.equal(classifyFailure(safe).processingReason,'invalid-input');assert.match(briefFailure(safe).message,/輸入影音異常/);
 assert.equal(classifyFailure({code:'MERGE_FAILED',processingReason:'private token',ffmpegExitCode:9999}).processingReason,undefined);
 assert.equal(classifyFailure({code:'MERGE_FAILED',ffmpegExitCode:9999}).ffmpegExitCode,undefined);
});
test('resource failures outrank earlier incidental input warnings',()=>{
 const diagnostics=create();diagnostics.observe('Packet corrupt');diagnostics.observe('Cannot enlarge memory');assert.equal(diagnostics.failure(1).processingReason,'memory');
});

test('the shipped worker forwards a safe cause on a nonzero FFmpeg exit',async()=>{
 const worker=await fs.readFile(new URL('../extension/ffmpeg-worker.js',import.meta.url),'utf8'),messages=[];let logger;
 const context={URL,btoa:text=>Buffer.from(text).toString('base64'),location:{href:'https://extension.test/ffmpeg-worker.js'},importScripts(){},postMessage:message=>messages.push(message),VideoPocketDiskMedia:{createSyncMediaFile:async()=>({access:{},abort(){}})},VideoPocketOutputFS:()=>({}),createFFmpegCore:async()=>({FS:{filesystems:{WORKERFS:{}},mkdir(){},mount(){},unmount(){}},setLogger:callback=>{logger=callback;},setProgress(){},reset(){},exec(){logger({message:'/private/path?token=SECRET: error reading header'});return 1;}})};
 context.self=context;vm.createContext(context);vm.runInContext(source,context);vm.runInContext(worker,context);
 await context.onmessage({data:{inputs:[{name:'video.mp4',file:{name:'video.mp4'}}],output:'output.mp4',args:['-i','input:video.mp4','-c','copy','output.mp4']}});
 const error=messages.find(message=>message.type==='error');assert.equal(error.errorCode,'MERGE_FAILED');assert.equal(error.processingReason,'invalid-input');assert.equal(error.ffmpegExitCode,1);assert.ok(!JSON.stringify(messages).includes('SECRET'));
});

test('FFmpeg seals its disk output before opening a target and preserves it for browser fallback',async()=>{
 const worker=await fs.readFile(new URL('../extension/ffmpeg-worker.js',import.meta.url),'utf8');
 for(const saved of [true,false]){
  const messages=[];let sealed=false,aborted=false;
  const context={URL,btoa:text=>Buffer.from(text).toString('base64'),location:{href:'https://extension.test/ffmpeg-worker.js'},importScripts(){},postMessage:message=>messages.push(message),
   VideoPocketDiskMedia:{createSyncMediaFile:async()=>({access:{},finish(){sealed=true;return {path:'completed.mp4',size:8};},abort(){aborted=true;}})},
   VideoPocketOutputFS:()=>({}),VideoPocketFileSave:async data=>{assert.ok(sealed);assert.equal(messages.at(-1).type,'readyToSave');assert.equal(data.path,'completed.mp4');return saved?{saved:true}:{saved:false,saveFailure:{code:'SAVE_FAILED',saveStage:'open-target',saveReason:'permission'}};},
   createFFmpegCore:async()=>({FS:{filesystems:{WORKERFS:{}},mkdir(){},mount(){},unmount(){}},setLogger(){},setProgress(){},reset(){},exec(){return 0;}})};
  context.self=context;vm.createContext(context);vm.runInContext(source,context);vm.runInContext(worker,context);
  await context.onmessage({data:{inputs:[{name:'video.mp4',file:{name:'video.mp4'}}],destinationId:'target',output:'output.mp4',args:['-i','input:video.mp4','-c','copy','output.mp4']}});
  assert.equal(aborted,false);assert.equal(messages.at(-1).type,'done');assert.equal(messages.at(-1).saved,saved);assert.equal(messages.at(-1).size,8);
  if(!saved)assert.equal(messages.at(-1).saveFailure.saveReason,'permission');
 }
});
