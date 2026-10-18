import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilibiliClient,decodeBilibiliMetadata,bilibiliTrackKey} from '../extension/bilibili-api.js';
import {loadBilibiliSubtitle} from '../extension/bilibili-subtitles.js';
import {mergeTracks} from '../extension/tracks.js';

const createClient=({fetchApi,...rest})=>createBilibiliClient({...rest,fetchApi:async(url,init)=>new URL(url).pathname==='/x/web-interface/nav'?{ok:true,json:async()=>({code:-101,data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}})}:fetchApi(url,init)});
const encode=new TextEncoder(),bvid='BVfixture01',bootstrap={bvid,aid:123,pages:[{cid:11,duration:60},{cid:22,duration:90}]};
const variable=number=>{let n=BigInt(number),bytes=[];do{let b=Number(n&127n);n>>=7n;bytes.push(b|(n?128:0));}while(n);return bytes;};
const field=(id,value)=>{const bytes=typeof value==='string'?encode.encode(value):value;return [(id<<3)|2,...variable(bytes.length),...bytes];};
const track=(lang='ai-zh',id='9007199254740993123',file='correct')=>({lan:lang,id_str:id,lan_doc:lang==='ai-zh'?'中文':'English',subtitle_url:`https://aisubtitle.hdslb.com/bfs/ai_subtitle/${file}.json?auth_key=SECRET`});
const proto=tracks=>new Uint8Array(field(1,tracks.flatMap(t=>field(3,[...field(2,t.id_str),...field(3,t.lan),...field(4,t.lan_doc),...field(5,t.subtitle_url)]))));
const response=bytes=>({ok:true,status:200,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});

test('current player Protobuf supports uint64 IDs, multilingual tracks and an empty data message',()=>{
 const tracks=[track(),track('ai-en','2')];assert.deepEqual(decodeBilibiliMetadata(proto(tracks)),tracks);
 assert.deepEqual(decodeBilibiliMetadata(new Uint8Array([10,0])),[]);
 // A data length of 123 (ASCII '{') is still Protobuf, not JSON.
 const bytes=new Uint8Array(field(1,field(8,'x'.repeat(121))));assert.deepEqual(decodeBilibiliMetadata(bytes),[]);
});

test('malformed Protobuf and actual JSON API errors preserve distinct causes',()=>{
 for(const bytes of [[],[10,8,26],[0],[10,1,255],[10,1,0],[10,255,255,255,255,255,255,255,255,255,255,1]])assert.throws(()=>decodeBilibiliMetadata(new Uint8Array(bytes)),error=>error.code==='BILI_LIST_INVALID');
 assert.throws(()=>decodeBilibiliMetadata(encode.encode('\uFEFF\n {"code":-412}')),error=>error.code==='BILI_LIST_API'&&error.apiCode===-412);
 assert.throws(()=>decodeBilibiliMetadata(encode.encode('{"code":-101}')),error=>error.code==='BILI_LOGIN_REQUIRED');
});

test('metadata query pairs aid/cid for the selected part and never calls unsigned legacy endpoints',async()=>{
 const urls=[];const client=createClient({fetchApi:async raw=>{const u=new URL(raw);urls.push(u);return response(proto([track()]));}});
 const inventory=await client.inventory({bvid,page:2,bootstrap});
 assert.equal(inventory.cid,22);assert.equal(inventory.aid,123);assert.equal(inventory.duration,90);
 assert.equal(urls.length,1);assert.equal(urls[0].pathname,'/x/v2/subtitle/web/view');assert.equal(urls[0].searchParams.get('oid'),'22');assert.equal(urls[0].searchParams.get('pid'),'123');
 assert.equal(inventory.tracks[0].apiTrackId,'9007199254740993123');
});

test('missing bootstrap resolves a fresh BVID/aid/pages identity; a conflicting BVID is rejected',async()=>{
 let view=0;const client=createClient({fetchApi:async raw=>{const u=new URL(raw);if(u.pathname==='/x/web-interface/view'){view++;return {ok:true,json:async()=>({code:0,data:bootstrap})};}return response(proto([track()]));}});
 const result=await client.inventory({bvid,page:1});assert.equal(result.cid,11);assert.equal(view,1);
 await assert.rejects(client.inventory({bvid,page:1,expectedCid:99}),e=>e.code==='BILI_IDENTITY_MISMATCH');
 const wrong=createClient({fetchApi:async()=>({ok:true,json:async()=>({code:0,data:{...bootstrap,bvid:'BVother01'}})})});
 await assert.rejects(wrong.inventory({bvid}),e=>e.code==='BILI_IDENTITY_MISMATCH');
});

test('capture re-resolves exact selected ID despite list reorder and signed URL rotation',async()=>{
 let calls=0;const client=createClient({fetchApi:async()=>response(proto(++calls===1?[track(),track('ai-en','2')]:[track('ai-en','2'),track('ai-zh','9007199254740993123','rotated')]))});
 const original=(await client.inventory({bvid,bootstrap})).tracks[0];
 const selected=await client.prepare({expectedBvid:bvid,expectedCid:11,expectedPage:1,pageTrackId:original.pageTrackId,apiTrackId:original.apiTrackId});
 assert.match(selected.url,/rotated\.json/);assert.equal(calls,2);assert.equal(selected.language,'zh');
});

test('a disappeared subtitle is never replaced with another same-language track',async()=>{
 let calls=0;const client=createClient({fetchApi:async()=>response(proto([++calls===1?track():track('ai-zh','999','unrelated')]))});
 const original=(await client.inventory({bvid,bootstrap})).tracks[0];
 await assert.rejects(client.prepare({expectedBvid:bvid,expectedCid:11,expectedPage:1,pageTrackId:original.pageTrackId,apiTrackId:original.apiTrackId}),e=>e.code==='BILI_TRACK_MISSING');
});

test('ID-less track identity retains content query parameters but ignores only ephemeral signatures',()=>{
 const a={...track(),id_str:'',subtitle_url:'https://subtitle.bilibili.com/file?cid=11&auth_key=old'},b={...a,subtitle_url:'https://subtitle.bilibili.com/file?auth_key=new&cid=11'},c={...a,subtitle_url:'https://subtitle.bilibili.com/file?cid=22'};
 assert.equal(bilibiliTrackKey(a,bvid,11),bilibiliTrackKey(b,bvid,11));assert.notEqual(bilibiliTrackKey(a,bvid,11),bilibiliTrackKey(c,bvid,11));
});

test('unsafe metadata URL and HTTP failures do not become empty inventories',async()=>{
 const unsafe=createClient({fetchApi:async()=>response(proto([{...track(),subtitle_url:'https://evil.example/file'}]))});await assert.rejects(unsafe.inventory({bvid,bootstrap}),e=>e.code==='BILI_SOURCE_REJECTED');
 const blocked=createClient({fetchApi:async()=>({ok:false,status:412})});await assert.rejects(blocked.inventory({bvid,bootstrap}),e=>e.code==='BILI_LIST_HTTP'&&e.status===412);
});

test('old metadata URLs cannot enter current Bilibili results through another media parser',()=>{
 const native=[{source:'native',language:'zh',automatic:true,url:'https://subtitle.bilibili.com/wrong.json'}];
 assert.deepEqual(mergeTracks({platform:{site:'bilibili'},tracks:[]},native),[]);
});

test('end-to-end capture consumes only the current binary source, not any legacy response',async()=>{
 const files=[];const client=createClient({fetchApi:async raw=>{assert.equal(new URL(raw).pathname,'/x/v2/subtitle/web/view');return response(proto([track()]));}});
 const original=(await client.inventory({bvid,bootstrap})).tracks[0];
 const result=await loadBilibiliSubtitle({selector:{expectedBvid:bvid,expectedCid:11,expectedPage:1,pageTrackId:original.pageTrackId,apiTrackId:original.apiTrackId},prepare:client.prepare,verify:async()=>({verified:true}),fetchFile:async url=>{files.push(url);return {ok:true,status:200,url,text:async()=>JSON.stringify({body:[{from:5,to:6,content:'正確影片後段'},{from:1,to:2,content:'正確影片前段'}]})};}});
 assert.equal(files.length,1);assert.match(files[0],/correct\.json/);assert.equal(result.cues[0].text,'正確影片前段');
});

test('temporary empty binary response preserves only the same known current-video inventory',async()=>{
 let calls=0;const client=createClient({fetchApi:async()=>response(proto(++calls===1?[track()]:[]))});
 const original=await client.inventory({bvid,bootstrap}),again=await client.inventory({bvid,bootstrap});
 assert.deepEqual(again.tracks,original.tracks);
});

test('empty binary metadata falls back only to the signed player endpoint and checks CID',async()=>{
 let signed=0;const client=createClient({fetchApi:async url=>{
  const u=new URL(url);if(u.pathname==='/x/v2/subtitle/web/view')return response(proto([]));
  assert.equal(u.pathname,'/x/player/wbi/v2');assert.match(u.searchParams.get('w_rid'),/^[0-9a-f]{32}$/);signed++;
  return {ok:true,json:async()=>({code:0,data:{bvid,cid:signed===1?11:999,subtitle:{subtitles:[track()]}}})};
 }});
 const result=await client.inventory({bvid,bootstrap});assert.equal(result.tracks.length,1);
 await assert.rejects(client.inventory({bvid,bootstrap,ignoreCached:true}),e=>e.code==='BILI_IDENTITY_MISMATCH');
});

test('AI product URLs naming another aid/CID are rejected despite matching API response identities',async()=>{
 const client=createClient({fetchApi:async()=>response(proto([track('ai-zh','1','prod/9999999999999999999999999abcdefabcdefabcdefabcdefabcdefab')]))});
 await assert.rejects(client.inventory({bvid,bootstrap}),e=>e.code==='BILI_IDENTITY_MISMATCH');
});

test('a hash-only translated track does not invalidate the current-video Chinese track',async()=>{
 const client=createClient({fetchApi:async()=>response(proto([track(),track('ai-en','2','prod/1c56037602b39527f5cc5a14ad5b1f96')]))});
 assert.equal((await client.inventory({bvid,bootstrap})).tracks.length,2);
});

test('native DOM timeout codes are reported as Bilibili timeout rather than an unknown error',async()=>{
 const client=createClient({fetchApi:async()=>{throw new DOMException('timeout','TimeoutError');}});
 await assert.rejects(client.inventory({bvid,bootstrap}),e=>e.code==='BILI_TIMEOUT'&&e.subtitleStage==='list');
});

test('after a cached empty response, a changed track ID is rejected at capture time',async()=>{
 let calls=0;const client=createClient({fetchApi:async()=>response(proto(++calls===1?[track()]:calls===2?[]:[track('ai-zh','999','changed')]))});
 const first=(await client.inventory({bvid,bootstrap})).tracks[0];assert.equal((await client.inventory({bvid})).tracks[0].apiTrackId,first.apiTrackId);
 await assert.rejects(client.prepare({expectedBvid:bvid,expectedCid:11,expectedPage:1,pageTrackId:first.pageTrackId,apiTrackId:first.apiTrackId}),e=>e.code==='BILI_TRACK_MISSING');
});

test('expired-file renewal bypasses cached sources and preserves explicit login failure',async()=>{
 let calls=0;const client=createClient({fetchApi:async raw=>{
  if(new URL(raw).pathname==='/x/player/wbi/v2')return {ok:true,json:async()=>({code:0,data:{bvid,cid:11,need_login_subtitle:true,subtitle:{subtitles:[]}}})};
  return response(proto(++calls===1?[track()]:[]));
 }});
 const first=(await client.inventory({bvid,bootstrap})).tracks[0];
 await assert.rejects(client.prepare({expectedBvid:bvid,expectedCid:11,expectedPage:1,pageTrackId:first.pageTrackId,apiTrackId:first.apiTrackId,refreshBilibiliSource:true}),e=>e.code==='BILI_LOGIN_REQUIRED');
});
