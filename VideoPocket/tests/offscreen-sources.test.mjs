import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {HlsParser,parseDash} from '../extension/vendor/parsers.js';
import {mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs} from '../extension/browser-media.js';
import {parseSubtitles} from '../extension/subtitles.js';
import {classifyFailure} from '../extension/diagnostics.js';
import {resolveAnime1,mediaCredentials} from '../extension/anime1.js';
import {parseTransportStreamCodecs} from '../extension/transport-stream.js';
import {readMp4Metadata} from '../extension/mp4-metadata.js';
import {decryptHlsSample,hlsIv} from '../extension/hls-sample.js';
import {twitchVodManifest} from '../extension/twitch-adapter.js';

const EMPTY={videoCodec:'',audioCodec:''};
function response(body,{status=200,type='application/octet-stream',length,contentRange=null}={}){
  const bytes=typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body||[]);
  let read=false;return {ok:status>=200&&status<300,status,headers:{get:k=>k.toLowerCase()==='content-type'?type:k.toLowerCase()==='content-length'?String(length ?? bytes.length):k.toLowerCase()==='content-range'?contentRange:null},text:async()=>new TextDecoder().decode(bytes),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),body:{cancel:async()=>{},getReader:()=>({read:async()=>read?{done:true}:{done:(read=true,false),value:bytes},cancel:async()=>{}})},arrayBuffer:async()=>bytes.buffer, _bytes:bytes};
}
function ts(){
  const psi=(table,body)=>{const n=body.length+4,s=new Uint8Array(3+body.length+4);s[0]=table;s[1]=0xb0|n>>8;s[2]=n;s.set(body,3);return s;};
  const pat=psi(0,[0,1,0xc1,0,0,0,1,0xe1,0]);const pmt=psi(2,[0,1,0xc1,0,0,0xe1,0,0xf0,0,0x1b,0xe1,0,0xf0,0,0x0f,0xe1,0,0xf0,0]);
  const packet=(pid,s)=>{const p=new Uint8Array(188);p.fill(255);p.set([0x47,0x40|pid>>8,pid&255,0x30],0);p[4]=183-s.length-1;p.set([0,...s],5+p[4]);return p;};
  return Uint8Array.from([...packet(0,pat),...packet(0x100,pmt)]);
}
function fakeVideo(){const v={preload:'',muted:false,videoHeight:720,duration:12,removeAttribute(){},load(){}};Object.defineProperty(v,'src',{set(){queueMicrotask(()=>v.onloadedmetadata?.())}});return v;}
function mp4Box(type,payload){const out=new Uint8Array(8+payload.length),size=out.length;out.set([size>>>24,(size>>>16)&255,(size>>>8)&255,size&255,...type].map((x,i)=>typeof x==='string'?x.charCodeAt(0):x));out.set(payload,8);return out;}
function largeMp4(){
  const avc=mp4Box('avc1',new Uint8Array(28)),aac=mp4Box('mp4a',new Uint8Array(20));
  const stsdPayload=new Uint8Array(8+avc.length+aac.length);stsdPayload.set([0,0,0,0,0,0,0,2]);stsdPayload.set(avc,8);stsdPayload.set(aac,8+avc.length);
  const stbl=mp4Box('stbl',mp4Box('stsd',stsdPayload));
  const minf=mp4Box('minf',stbl),mdia=mp4Box('mdia',minf),trak=mp4Box('trak',mdia),moov=mp4Box('moov',trak);
  const total=220000,out=new Uint8Array(total);out.set([0,0,0,8,102,116,121,112]);const freeSize=200000-8;out.set([freeSize>>>24,(freeSize>>>16)&255,(freeSize>>>8)&255,freeSize&255,102,114,101,101],8);out.set(moov,200000);return out;
}

async function makeRuntime(routes){
  const messages=[];let listener;
  const chrome={runtime:{id:'test-extension',sendMessage:async message=>{messages.push({kind:'rpc',message});return {ok:true,result:{}}},onMessage:{addListener:fn=>{listener=fn}}}};
  const fetchLog=[];
  const fetch=async (url,options={})=>{const u=String(url),opts={...options,headers:{...(options.headers||{})}};fetchLog.push({url:u,options:opts,credentials:opts.credentials});const route=routes.find(r=>r.match(u,opts));if(!route)throw new Error('unmocked '+u);if(typeof route.reply==='function')return route.reply(u,opts);return route.reply;};
  const source=await fs.readFile(new URL('../extension/offscreen.js',import.meta.url),'utf8');
  const code=source.replace(/^import[^;]+;\s*/gm,'');
  const context={HlsParser,parseDash,mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs,parseSubtitles,directTransfer:async()=>{},downloadYoutube:async()=>{},TransferControl:class{},classifyFailure,resolveAnime1,mediaCredentials,parseTransportStreamCodecs,readMp4Metadata,decryptHlsSample,hlsIv,chrome,fetch,document:{createElement:()=>fakeVideo()},VideoPocketDiskMedia:{removeMediaFiles:async()=>{}},crypto,URL,URLSearchParams,TextEncoder,TextDecoder,AbortSignal,Uint8Array,ArrayBuffer,File:class{},Worker:class{},setInterval:()=>{},setTimeout,clearTimeout,queueMicrotask,console};
    vm.runInNewContext(code,{...context,twitchVodManifest},{filename:'offscreen.js'});
  assert.equal(typeof listener,'function');
  async function inspect(descriptor){return new Promise((resolve,reject)=>listener({target:'offscreen',action:'inspect',descriptor},{id:'test-extension'},reply=>reply?.ok?resolve(reply.result):reject(Object.assign(new Error(reply?.error||'inspect failed'),reply?.failure||{}))));}
  return {inspect,fetchLog,messages};
}

test('Anime1 API and CDN requests use include credentials and produce a video choice',async()=>{
  const referer='https://anime1.me/12/34';
  const media='https://v.anime1.me/12/34.mp4',token=encodeURIComponent(JSON.stringify({c:'12',e:'34'}));
  const rt=await makeRuntime([
    {match:u=>u==='https://v.anime1.me/api',reply:response(JSON.stringify({s:[{src:media}]}),{type:'application/json'})},
    {match:u=>u===media,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:1000}):response(new Uint8Array([1,2,3]),{type:'video/mp4'})},
  ]);
  const result=await rt.inspect({referer,platform:{site:'anime1',apiRequest:token},title:'episode'});
  assert.equal(result.choices.video.auto.enabled,true);
  assert.ok(rt.fetchLog.filter(x=>x.url.startsWith('https://v.anime1.me/')).every(x=>x.credentials==='include'));
});

test('HEAD failure followed by bounded GET can still inspect a source',async()=>{
  const url='https://cdn.example/video.mp4',rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{status:405}):response(new Uint8Array([0,1,2]),{type:'video/mp4'})}]);
  const result=await rt.inspect({url,referer:'https://example.test/watch',title:'x'});
  assert.equal(result.choices.video.auto.enabled,true);assert.ok(rt.fetchLog.some(x=>x.options.headers.Range==='bytes=0-131071'));
});

test('Twitch playback lookup runs in offscreen and renews the manifest for the selected VOD',async()=>{
 const referer='https://www.twitch.tv/videos/2891894094',child='https://cdn.example/vod/index.m3u8';
 const rt=await makeRuntime([
  {match:u=>u==='https://gql.twitch.tv/gql',reply:(u,o)=>{assert.equal(JSON.parse(o.body).variables.vodID,'2891894094');return response(JSON.stringify({data:{videoPlaybackAccessToken:{value:'new-token',signature:'sig'}}}),{type:'application/json'});}},
  {match:u=>u.startsWith('https://usher.ttvnw.net/vod/2891894094.m3u8?'),reply:(u)=>{assert.equal(new URL(u).searchParams.get('token'),'new-token');return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n'+child+'\n');}},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n')}
 ]);
 const result=await rt.inspect({url:'https://old.example/stale.m3u8',referer,platform:{site:'twitch',id:'2891894094',manifest:'old'}});
 assert.equal(result.choices.video.auto.enabled,true);assert.deepEqual([...result.choices.video.auto.heights],[360]);
 assert.equal(rt.fetchLog.some(r=>r.url.includes('old.example')),false);
});

test('GET 403 is reported as HTTP_AUTH rather than unknown MP4',async()=>{
  const url='https://cdn.example/private.mp4',rt=await makeRuntime([{match:u=>u===url,reply:response('',{status:403,type:'video/mp4'})}]);
  const reply=await rt.inspect({url,referer:'https://example.test/watch'}).then(result=>({ok:true,result}),error=>({ok:false,error}));
  assert.equal(reply.ok,false);assert.equal(classifyFailure(reply.error,'inspect').code,'HTTP_AUTH');
});

test('MMOV master without CODECS sniffs child TS PMT for video and audio',async()=>{
  const master='https://hk.mmov.io/vodplay/416398/master.m3u8',child='https://hk.mmov.io/vodplay/416398/720.m3u8',segment='https://hk.mmov.io/vodplay/416398/720.ts',bytes=ts();
  const rt=await makeRuntime([
    {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720.m3u8\n',{type:'application/vnd.apple.mpegurl'})},
    {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n720.ts\n#EXT-X-ENDLIST\n',{type:'application/vnd.apple.mpegurl'})},
    {match:u=>u===segment,reply:response(bytes,{type:'video/mp2t'})},
  ]);
  const result=await rt.inspect({url:master,referer:'https://hk.mmov.io/vodplay/416398/6-1.html',title:'MMOV'});
  assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
});

test('AES-128 HLS without CODECS inspects bounded decrypted TS and enables both modes',async()=>{
 const base='https://bahamut.akamaized.net/fixture/',master=base+'playlist.m3u8',child=base+'chunklist.m3u8',keyUrl=base+'key.m3u8key',segment=base+'0.ts';
 const rawKey=crypto.getRandomValues(new Uint8Array(16)),iv=hlsIv(null,17),key=await crypto.subtle.importKey('raw',rawKey,{name:'AES-CBC'},false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},key,ts()));
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nchunklist.m3u8\n')},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:17\n#EXT-X-KEY:METHOD=AES-128,URI="key.m3u8key"\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n')},
  {match:u=>u===keyUrl,reply:response(rawKey)},
  {match:u=>u===segment,reply:response(encrypted)},
 ]);
 const result=await rt.inspect({url:master,referer:'https://ani.gamer.com.tw/animeVideo.php?sn=1'});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
 assert.equal(rt.fetchLog.find(x=>x.url===segment).options.headers.Range,'bytes=0-131071');
 assert.equal(rt.fetchLog.find(x=>x.url===keyUrl).options.headers.Range,'bytes=0-16');
});

test('ordinary source requests omit credentials',async()=>{
  const url='https://cdn.example/plain.mp4',rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:3}):response(new Uint8Array([1]),{type:'video/mp4'})}]);
  await rt.inspect({url,referer:'https://example.test/watch'});assert.ok(rt.fetchLog.every(x=>x.credentials==='omit'));
});

test('large MP4 metadata seeks beyond the initial 128 KiB and enables audio/video',async()=>{
  const url='https://cdn.example/large.mp4',bytes=largeMp4(),total=bytes.length;
  const rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>{
    if(o.method==='HEAD')return response('',{type:'video/mp4',length:total});
    const range=String(o.headers.Range||'').match(/bytes=(\d+)-(\d+)/),start=range?Number(range[1]):0,end=range?Math.min(total-1,Number(range[2])):total-1;
    return response(bytes.slice(start,end+1),{status:206,type:'video/mp4',contentRange:`bytes ${start}-${end}/${total}`});
  }}]);
  const result=await rt.inspect({url,referer:'https://example.test/watch',title:'large'});
  assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
  assert.ok(rt.fetchLog.some(x=>x.options.headers.Range==='bytes=196608-219999'));
});
