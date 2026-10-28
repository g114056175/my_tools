import test from 'node:test';
import assert from 'node:assert/strict';
import {createVimeoConfigurationReader} from '../extension/vimeo-source.js';

const pageUrl='https://vimeo.com/1084537';
const endpoint='https://player.vimeo.com/video/1084537/config';
const config=(id='1084537')=>({video:{id,title:'Big Buck Bunny',duration:12},request:{files:{hls:{default_cdn:'main',cdns:{main:{url:'https://cdn.test/current/master.m3u8'}}}}}});
const json=(data,options={})=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'},...options});
function fixture({url=pageUrl,fetch,scriptProps,viewer}={}){
 const video={isConnected:true,mediaKeys:null,currentSrc:'blob:current',duration:12};
 const target={location:{href:url},document:{scripts:[],querySelectorAll:()=>[video],querySelector:selector=>selector==='script#__NEXT_DATA__'&&scriptProps?{textContent:JSON.stringify({props:{pageProps:scriptProps}})}:selector==='script#viewer-bootstrap'&&viewer?{textContent:JSON.stringify(viewer)}:null}};
 const requests=[];
 const reader=createVimeoConfigurationReader({target,fetch:async(url,options)=>{requests.push({url,options});return fetch?fetch(url,options):json(config());}});
 return {video,target,requests,reader};
}

test('late Vimeo selection recovers exact config and caches only its media payload',async()=>{
 const f=fixture();
 const result=await f.reader.get(f.video);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,endpoint);
 assert.equal(result.video.id,'1084537');assert.equal(result.video.title,'Big Buck Bunny');
 assert.equal(result.request.files.hls.cdns.main.url,'https://cdn.test/current/master.m3u8');
 assert.equal(await f.reader.get(f.video),result);assert.equal(f.requests.length,1);
 f.video.currentSrc='blob:replacement';await f.reader.get(f.video);assert.equal(f.requests.length,2);
 f.reader.dispose();
});

test('an already loaded exact Vimeo config needs no metadata request',async()=>{
 const f=fixture();f.target.playerConfig=config();
 const result=await f.reader.get(f.video);assert.equal(result.video.id,'1084537');assert.equal(f.requests.length,0);f.reader.dispose();
});

test('Next.js Vimeo uses the selected clip bootstrap then verifies both API and config IDs',async()=>{
 const signed=endpoint+'?token=fixture-only';
 const f=fixture({scriptProps:{clipId:'1084537',clip:{uri:'/videos/1084537'},pageMetadata:{clipSignature:'clip-fixture'}},viewer:{jwt:'short-lived-fixture'},fetch:async(url,options)=>{
  if(url===endpoint)return json({}, {status:403});
  if(url.startsWith('https://api.vimeo.com/')){
   const u=new URL(url);assert.equal(u.pathname,'/videos/1084537');assert.equal(u.searchParams.get('anon_signature'),'clip-fixture');
   assert.equal(options.headers.Authorization,'jwt short-lived-fixture');assert.equal(u.searchParams.get('fields'),'uri,embed_player_config_url');
   return json({uri:'/videos/1084537',embed_player_config_url:signed});
  }
  assert.equal(url,signed);assert.equal(options.headers.Authorization,undefined,'API credentials never go to the player or CDN');return json(config());
 }});
 const result=await f.reader.get(f.video);assert.equal(result.video.title,'Big Buck Bunny');assert.equal(f.requests.length,3);
 assert.equal(JSON.stringify(result).includes('short-lived-fixture'),false);f.reader.dispose();
});

test('non Vimeo pages, multiple players, detached elements and DRM perform no metadata requests',async()=>{
 for(const kind of ['other-site','multiple','detached','drm']){
  const f=fixture({url:kind==='other-site'?'https://www.youtube.com/watch?v=id':pageUrl});
  if(kind==='multiple')f.target.document.querySelectorAll=()=>[f.video,{}];
  if(kind==='detached')f.video.isConnected=false;
  if(kind==='drm')f.video.mediaKeys={};
  assert.equal(await f.reader.get(f.video),null,kind);assert.equal(f.requests.length,0,kind);f.reader.dispose();
 }
});

test('navigation, replaced source or changed player while resolving cannot adopt the old config',async()=>{
 for(const change of ['route','source','element']){
  let release;const f=fixture({fetch:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.reader.get(f.video);
  if(change==='route')f.target.location.href='https://vimeo.com/999999';
  if(change==='source')f.video.currentSrc='blob:other';
  if(change==='element')f.target.document.querySelectorAll=()=>[{}];
  release(json(config()));assert.equal(await pending,null,change);f.reader.dispose();
 }
});

test('wrong video IDs, protected configs and mismatched duration remain unavailable',async()=>{
 for(const data of [config('999999'),{...config(),drm:true},{...config(),video:{id:'1084537',duration:99}}]){
  const f=fixture({fetch:()=>json(data)});assert.equal(await f.reader.get(f.video),null);f.reader.dispose();
 }
});

test('Vimeo bootstrap and API cannot redirect lookup to other videos or hosts',async()=>{
 for(const bad of ['https://evil.test/video/1084537/config','https://player.vimeo.com/video/999999/config','https://user:secret@player.vimeo.com/video/1084537/config']){
  const f=fixture({scriptProps:{clipId:'1084537',clip:{uri:'/videos/1084537'},viewerBootstrap:{jwt:'fixture'}},fetch:url=>url===endpoint?json({},{status:403}):json({uri:'/videos/1084537',config_url:bad})});
  assert.equal(await f.reader.get(f.video),null);assert.equal(f.requests.length,2);f.reader.dispose();
 }
 const f=fixture({scriptProps:{clipId:'999999',clip:{uri:'/videos/999999'},viewerBootstrap:{jwt:'fixture'}},fetch:()=>json({},{status:403})});
 assert.equal(await f.reader.get(f.video),null);assert.equal(f.requests.length,1);f.reader.dispose();
});

test('concurrent selection shares one lookup and disposal aborts its request',async()=>{
 let entered,aborted=false;const ready=new Promise(resolve=>{entered=resolve;});
 const f=fixture({fetch:async(url,{signal})=>{entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}});
 const a=f.reader.get(f.video),b=f.reader.get(f.video);await ready;f.reader.dispose();
 assert.deepEqual(await Promise.all([a,b]),[null,null]);assert.equal(f.requests.length,1);assert.equal(aborted,true);
 assert.equal(await f.reader.get(f.video),null);
});

test('oversized config responses are cancelled within the metadata budget',async()=>{
 let cancelled=false;
 const f=fixture({fetch:()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(512*1024+1)}),cancel:async()=>{cancelled=true;}})}})});
 assert.equal(await f.reader.get(f.video),null);assert.equal(cancelled,true);assert.equal(f.requests.length,1);f.reader.dispose();
});
