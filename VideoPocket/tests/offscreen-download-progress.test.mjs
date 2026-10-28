import {createSourceRetention} from '../extension/source-retention.js';
import {sharedHttpRequestPolicy,parseRetryAfter} from '../extension/http-resilience.js';
import {validateMediaRecovery} from '../extension/media-recovery.js';
import {createMediaRangeVersions} from '../extension/media-range-versions.js';
import {createYoutubeSourceSessions} from '../extension/youtube-source-session.js';
import {inspectionReuseKey,inspectionReusable} from '../extension/inspection-reuse.js';
import {parseByteRange as byteRange,rangeCapability,formatRangeCapability} from '../extension/range-capability.js';
import {createMediaTransfer} from '../extension/media-transfer.js';
import {resolveNetworkCandidates} from '../extension/source-candidates.js';
import {platformSource} from '../extension/platform-formats.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {HlsParser,parseDash} from '../extension/vendor/parsers.js';
import {mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs} from '../extension/browser-media.js';
import {parseSubtitles} from '../extension/subtitles.js';
import {classifyFailure} from '../extension/diagnostics.js';
import {resolveAnime1} from '../extension/anime1.js';
import {mediaCredentials} from '../extension/media-credentials.js';
import {parseTransportStreamCodecs} from '../extension/transport-stream.js';
import {readMp4Metadata} from '../extension/mp4-metadata.js';
import {createTransferProgress} from '../extension/transfer-progress.js';
import {TransferControl} from '../extension/transfer-control.js';
import {assembleSegments} from '../extension/ordered-segments.js';

const encoder=new TextEncoder();
const master='https://mmov.test/vod/master.m3u8';
const child='https://mmov.test/vod/720.m3u8';
const segmentUrls=[1,2,3].map(i=>`https://mmov.test/vod/${i}.ts`);
const segmentBytes=[new Uint8Array([1,2,3]),new Uint8Array([4,5]),new Uint8Array([6,7,8,9])];

function response(body,{status=200,type='application/octet-stream',length,contentRange,chunkSize=0,chunkDelay=0}={}){
 const bytes=typeof body==='string'?encoder.encode(body):new Uint8Array(body||[]);
 let offset=0;
 const headers={get(name){name=name.toLowerCase();if(name==='content-type')return type;if(name==='content-length')return String(length ?? bytes.length);if(name==='content-range')return contentRange || null;return null;}};
 return {ok:status>=200&&status<300,status,headers,text:async()=>new TextDecoder().decode(bytes),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),body:{cancel:async()=>{},getReader:()=>({read:async()=>{if(offset>=bytes.length)return {done:true};if(chunkDelay)await new Promise(resolve=>setTimeout(resolve,chunkDelay));const end=Math.min(bytes.length,offset+(chunkSize||bytes.length)),value=bytes.slice(offset,end);offset=end;return {done:false,value};},cancel:async()=>{}})}};
}

function makeDisk(){
 const files=new Map(),created=[];let next=0;const stats={maxSegmentRetained:0,maxSegmentBytes:0,segmentRetained:0,segmentBytes:0,appendOrder:[],outputBytes:0};
 const sample=()=>{stats.maxSegmentRetained=Math.max(stats.maxSegmentRetained,stats.segmentRetained);stats.maxSegmentBytes=Math.max(stats.maxSegmentBytes,stats.segmentBytes);};
 const createMediaFile=async(scope,name)=>{
  const path=`video-pocket/${scope}/${name}-${++next}.part`,parts=[];let size=0,closed=false,isSegment=name==='segment',isOutput=name==='input';
  const sink={path,get size(){return size;},append:async data=>{const b=new Uint8Array(data);parts.push({offset:size,bytes:b.slice()});size+=b.length;if(isOutput){stats.appendOrder.push(...b);stats.outputBytes+=b.length;}},writeAt:async(data,offset)=>{const b=new Uint8Array(data);parts.push({offset:Number(offset),bytes:b.slice()});size=Math.max(size,Number(offset)+b.length);},truncate:async length=>{size=length;},finish:async()=>{const out=new Uint8Array(size);for(const p of parts)out.set(p.bytes,p.offset);files.set(path,out);closed=true;if(isSegment){stats.segmentRetained++;stats.segmentBytes+=size;sample();}return {path,size};},abort:async()=>{closed=true;}};
  created.push(sink);return sink;
 };
 const readMediaFile=async path=>new Blob([files.get(path) || new Uint8Array()]);
 const removeMediaFile=async path=>{const removed=files.get(path);if(removed&&/\/segment-/.test(path)){stats.segmentRetained--;stats.segmentBytes-=removed.length;}return files.delete(path);};
 return {files,created,stats,createMediaFile,readMediaFile,removeMediaFile,removeMediaFiles:async scope=>{for(const path of [...files.keys()])if(scope==null||path.includes(`/${scope}/`))await removeMediaFile(path);}};
}

async function makeRuntime({missing=false,segmentCount=3,failureIndex=missing?1:-1,outOfOrder=false,fetchDelay=0,failureStatus=404,chunkSize=0,chunkDelay=0}={}){
 const disk=makeDisk(),messages=[];let listener;const urls=segmentCount===3?segmentUrls:Array.from({length:segmentCount},(_,i)=>`https://mmov.test/vod/${i+1}.ts`);
 const bytes=segmentCount===3?segmentBytes:Array.from({length:segmentCount},(_,i)=>new Uint8Array([i&255,(i+1)&255,(i+2)&255]));
 const routes=new Map(urls.map((url,i)=>[url,{bytes:bytes[i],missing:i===failureIndex,calls:0}]));
 const fetch=async (url,options={})=>{
  const u=String(url);
  if(u===master)return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=900000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720\n720.m3u8\n',{type:'application/vnd.apple.mpegurl'});
  if(u===child)return response(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n${urls.map((_,i)=>`#EXTINF:1,\n${i+1}.ts\n`).join('')}#EXT-X-ENDLIST\n`,{type:'application/vnd.apple.mpegurl'});
  const route=routes.get(u);if(!route)throw new Error(`unmocked ${u}`);route.calls++;if(outOfOrder&&fetchDelay)await new Promise(resolve=>setTimeout(resolve,(segmentCount-(Number(u.match(/(\d+)\.ts$/)?.[1])||1))%7*fetchDelay));if(route.missing)return response('',{status:failureStatus});return response(route.bytes,{type:'video/mp2t',chunkSize,chunkDelay});
 };
 const chrome={runtime:{id:'test-extension',getURL:name=>`chrome-extension://test/${name}`,sendMessage:async message=>{messages.push(message);return {ok:true,result:{}}},onMessage:{addListener:fn=>{listener=fn}}}};
 class WorkerMock{constructor(){this.onmessage=null;this.onerror=null;}postMessage(message){const path=message.output || 'output.mp4';disk.files.set(path,new Uint8Array([9,8,7]));queueMicrotask(()=>this.onmessage?.({data:{type:'done',path,saved:false}}));}terminate(){}}
 const source=await fs.readFile(new URL('../extension/offscreen.js',import.meta.url),'utf8');
 const code=source.replace(/^import[^;]+;\s*/gm,'');
 const FileCtor=globalThis.File || class File extends Blob{constructor(parts,name,options={}){super(parts,options);this.name=name;}};
 const context={createSourceRetention:options=>createSourceRetention({...options,setTimer:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;}}),sharedHttpRequestPolicy,parseRetryAfter,validateMediaRecovery,createMediaRangeVersions,createYoutubeSourceSessions,inspectionReuseKey,inspectionReusable,byteRange,rangeCapability,formatRangeCapability,createMediaTransfer,resolveNetworkCandidates,platformSource,assembleSegments,HlsParser,parseDash,mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs,parseSubtitles,directTransfer:async()=>{},downloadYoutube:async()=>{},TransferControl,assembleSegments,createTransferProgress,classifyFailure,resolveAnime1,mediaCredentials,parseTransportStreamCodecs,readMp4Metadata,chrome,fetch,document:{createElement:()=>({})},VideoPocketDiskMedia:disk,crypto:{randomUUID:()=>`id-${Math.random()}`},URL,URLSearchParams,TextEncoder,TextDecoder,AbortSignal,AbortController,Uint8Array,ArrayBuffer,Blob,File:FileCtor,Worker:WorkerMock,setInterval:()=>{},setTimeout,clearTimeout,queueMicrotask,console,performance};
 vm.runInNewContext(code,context,{filename:'offscreen.js'});assert.equal(typeof listener,'function');
 const call=(action,data)=>new Promise((resolve,reject)=>listener({target:'offscreen',action,...data},{id:'test-extension'},reply=>reply?.ok?resolve(reply.result):reject(Object.assign(new Error(reply?.error||'request failed'),reply?.failure||{}))));
 return {call,messages,routes,segmentUrls:urls,disk};
}

test('real HLS download reports committed 100% before processing despite a large estimate',async()=>{
 const rt=await makeRuntime();
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'MMOV'}});
 assert.equal(inspected.choices.video.auto.enabled,true);
 await rt.call('download',{sourceId:inspected.id,id:'job-ok',kind:'video',height:720,filename:'mmov'});
 const progress=rt.messages.filter(m=>m.action==='progress');
 const running=progress.filter(m=>m.state==='running');
 const last100=running.map((m,i)=>m.progress===100?i:-1).filter(i=>i>=0).at(-1);
 const processing=progress.findIndex(m=>m.state==='processing');
 assert.ok(last100>=0,'expected a running 100% update');
 assert.ok(processing>last100,'processing must follow running 100%');
 assert.equal(rt.routes.get(segmentUrls[0]).bytes.length+rt.routes.get(segmentUrls[1]).bytes.length+rt.routes.get(segmentUrls[2]).bytes.length,9);
 assert.deepEqual(segmentUrls.map(url=>rt.routes.get(url).calls),[1,1,1]);
});

test('unknown-length HLS retains committed-segment progress with delayed stream chunks',async()=>{
 const rt=await makeRuntime({chunkSize:1,chunkDelay:130});
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'Slow MMOV'}});
 await rt.call('download',{sourceId:inspected.id,id:'job-slow',kind:'video',height:720,filename:'slow-mmov'});
 const running=rt.messages.filter(m=>m.action==='progress'&&m.state==='running').map(m=>m.progress).filter(Number.isFinite);
 assert.ok(running.some(value=>value>0&&value<100),`expected partial progress, got ${running}`);
 assert.equal(running.at(-1),100);
});

test('a missing HLS fragment fails without reporting done or retrying the fragment',async()=>{
 const rt=await makeRuntime({missing:true});
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'MMOV'}});
 await assert.rejects(rt.call('download',{sourceId:inspected.id,id:'job-fail',kind:'video',height:720,filename:'mmov'}));
 const progress=rt.messages.filter(m=>m.action==='progress');
 assert.equal(progress.some(m=>m.state==='processing'),false);
 assert.equal(progress.some(m=>m.state==='done'),false);
 assert.equal(progress.filter(m=>m.state==='running'&&m.progress===100).length,0);
 assert.equal(rt.routes.get(segmentUrls[1]).calls,1);
});

test('offscreen VM assembles 32 out-of-order fragments with at most four retained ahead',async()=>{
 const rt=await makeRuntime({segmentCount:32,outOfOrder:true,fetchDelay:2});
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'Long MMOV'}});
 await rt.call('download',{sourceId:inspected.id,id:'job-32',kind:'video',height:720,filename:'long-mmov'});
 const expected=rt.segmentUrls.flatMap((_,i)=>[i&255,(i+1)&255,(i+2)&255]);
 assert.deepEqual(rt.disk.stats.appendOrder,expected);
 assert.ok(rt.disk.stats.maxSegmentRetained<=4,`retained ${rt.disk.stats.maxSegmentRetained}`);
 assert.ok(rt.disk.stats.maxSegmentBytes<=4*3);
 assert.equal(rt.disk.stats.segmentRetained,0);
 assert.equal(rt.disk.stats.segmentBytes,0);
});

test('offscreen VM preserves the original HTTP fragment failure and cleans retained parts',async()=>{
 const rt=await makeRuntime({segmentCount:32,outOfOrder:true,fetchDelay:1,failureIndex:11,failureStatus:404});
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'Failing MMOV'}});
 await assert.rejects(rt.call('download',{sourceId:inspected.id,id:'job-http-fail',kind:'video',height:720,filename:'failing-mmov'}),error=>error.code==='HTTP_NOT_FOUND');
 assert.equal(rt.messages.some(m=>m.action==='progress'&&m.state==='done'),false);
 assert.equal(rt.disk.stats.segmentRetained,0);
 assert.equal(rt.disk.stats.segmentBytes,0);
});

test('offscreen VM cancellation stops fragment assembly and cleans temporary files',async()=>{
 const rt=await makeRuntime({segmentCount:32,outOfOrder:true,fetchDelay:8});
 const inspected=await rt.call('inspect',{descriptor:{url:master,referer:'https://mmov.test/watch',title:'Cancelled MMOV'}});
 const download=rt.call('download',{sourceId:inspected.id,id:'job-cancel',kind:'video',height:720,filename:'cancelled-mmov'});
 setTimeout(()=>void rt.call('cancel',{id:'job-cancel'}),20);
 await assert.rejects(download,/取消|CANCELLED|aborted/i);
 assert.equal(rt.disk.stats.segmentRetained,0);
 assert.equal(rt.disk.stats.segmentBytes,0);
});
