import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLinkedMedia} from '../extension/linked-media.js';

const link={url:'https://example.test/reel/abc',id:'abc'},referer='https://example.test/feed';
const model=(id='abc',url='https://cdn.example/video.mpd')=>JSON.stringify({id,video:{id,contentUrl:url}});
const response=(body,{type='text/html',url=link.url,status=200,chunk=body.length}={})=>{const bytes=new TextEncoder().encode(body);let at=0,cancelled=false;return {ok:status>=200&&status<300,status,url,headers:{get:key=>key.toLowerCase()==='content-type'?type:''},body:{getReader:()=>({read:async()=>at>=bytes.length?{done:true}:{done:false,value:bytes.slice(at,at+=chunk)},cancel:async()=>{cancelled=true;}})},get cancelled(){return cancelled;}};};
const documentFor=body=>({querySelectorAll:selector=>selector.includes('application/json')||selector.includes('ld+json')?body.map(text=>({textContent:text})):[]});
const resolve=(scripts,options={})=>resolveLinkedMedia(link,referer,async(url,ref,init)=>response(options.body || '<html/>',options),{parseDocument:()=>documentFor(scripts)});

test('same-ID JSON and LD+JSON sources merge into one embedded model',async()=>{const value=await resolve([model(),JSON.stringify({videoId:'abc',contentUrl:'https://cdn.example/video.mp4',length_in_second:14.06})]);assert.equal(value.site,'embedded');assert.ok(value.aliases.includes('abc'));assert.ok(value.versions.length);assert.equal(value.duration,14.06);});
test('different recommendation IDs are ignored',async()=>{const value=await resolve([model(),model('recommendation','https://cdn.example/other.mp4')]);assert.equal(value.id,'abc');});
test('conflicting models that both claim the permalink are rejected',async()=>{await assert.rejects(resolve([JSON.stringify({videoId:'abc',video:{id:'other-a',contentUrl:'https://cdn/a.mpd'}}),JSON.stringify({videoId:'abc',video:{id:'other-b',contentUrl:'https://cdn/b.mpd'}})]),{code:'SOURCE_UNAVAILABLE'});});
test('cross-origin links, credentials and invalid IDs are rejected',async()=>{await assert.rejects(resolveLinkedMedia({...link,url:'http://example.test/reel/abc'},referer,async()=>response('<html/>')),{code:'SOURCE_UNAVAILABLE'});await assert.rejects(resolveLinkedMedia({...link,url:'https://evil.test/reel/abc'},referer,async()=>response('<html/>')),{code:'SOURCE_UNAVAILABLE'});await assert.rejects(resolveLinkedMedia({...link,id:''},referer,async()=>response('<html/>')),{code:'SOURCE_UNAVAILABLE'});});
test('redirects must stay on the exact permalink path',async()=>{await assert.rejects(resolve([], {url:'https://example.test/login'}),{code:'SOURCE_UNAVAILABLE'});});
test('redirects may normalize only a trailing slash and query',async()=>{const value=await resolve([model()],{url:'https://example.test/reel/abc/?v=2'});assert.equal(value.site,'embedded');});
test('content and document limits are enforced',async()=>{await assert.rejects(resolve([], {type:'application/json'}),{code:'SOURCE_UNAVAILABLE'});await assert.rejects(resolve([], {body:'x'.repeat(4*1024*1024+1),url:link.url,chunk:1024*1024}),{code:'SOURCE_UNAVAILABLE'});});
test('HTTP failures and aborts remain unchanged',async()=>{const http=Object.assign(new Error('blocked'),{status:403});await assert.rejects(resolveLinkedMedia(link,referer,async()=>{throw http;}),error=>error===http);const abort=Object.assign(new Error('aborted'),{name:'AbortError'});await assert.rejects(resolveLinkedMedia(link,referer,async()=>{throw abort;}),error=>error===abort);});

const xLink={url:'https://x.com/user/status/1234567890',id:'1234567890'},xBid='broadcast-123',xBroadcast='https://x.com/i/broadcasts/'+xBid;
const xCard={rest_id:xLink.id,card:{legacy:{binding_values:Object.entries({broadcast_id:xBid,broadcast_url:xBroadcast,broadcast_media_key:'28_123456789'}).map(([key,string_value])=>({key,value:{string_value}}))}}};
const streamed=value=>'$_TSR.stream.push({result:{kind:"Result.Ok",value:'+JSON.stringify(JSON.stringify(value))+'}});';
function xDocument(body,{bid=xBid,key='28_123456789',media='https://video.example/replay.m3u8'}={}){
 const scripts=body==='post'?[streamed({data:{tweet_result:{result:xCard}}}),streamed({data:{broadcast_by_rest_id:{broadcast_id:xBid,media_key:'28_123456789',status:'Exact replay'}}})]:[];
 const meta={'twitter:text:broadcast_id':bid,'twitter:text:broadcast_media_key':key,'og:video:url':media,'og:video:secure_url':media,'twitter:text:broadcast_title':'Exact replay'};
 return {querySelectorAll:selector=>selector.startsWith('script')?scripts.map(textContent=>({textContent})):Object.entries(meta).filter(([name])=>selector.includes('"'+name+'"')).map(([,content])=>({getAttribute:()=>content}))};
}

test('X broadcast lookup follows only the matched card and verifies replay metadata before using HLS',async()=>{
 const requests=[];
 const result=await resolveLinkedMedia(xLink,'https://x.com/user',async url=>{requests.push(url);return response(url===xLink.url?'post':'broadcast',{url,type:'text/html'});},{parseDocument:xDocument});
 assert.equal(result.title,'Exact replay');assert.equal(result.manifestUrl,'https://video.example/replay.m3u8');assert.equal(result.bindingOnly,false);
 assert.deepEqual(requests,[xLink.url,xBroadcast]);assert.ok(result.aliases.includes(xLink.id));
});

test('X replay lookup rejects a changed broadcast ID, media key or non-media URL',async()=>{
 for(const override of [{bid:'other-broadcast'},{key:'28_987654321'},{media:'https://video.example/error.html'},{media:'https://user:secret@video.example/replay.m3u8'}]){
  await assert.rejects(resolveLinkedMedia(xLink,'https://x.com/user',async url=>response(url===xLink.url?'post':'broadcast',{url}),{parseDocument:body=>xDocument(body,body==='post'?{}:override)}),{code:'SOURCE_UNAVAILABLE'});
 }
});

test('X cannot use a neighbouring post card or a redirected broadcast document',async()=>{
 let requests=0;
 await assert.rejects(resolveLinkedMedia({...xLink,id:'neighbour'},'https://x.com/user',async url=>{requests++;return response('post',{url});},{parseDocument:xDocument}),{code:'SOURCE_UNAVAILABLE'});
 assert.equal(requests,1);
 await assert.rejects(resolveLinkedMedia(xLink,'https://x.com/user',async url=>response(url===xLink.url?'post':'broadcast',{url:url===xLink.url?url:'https://x.com/i/broadcasts/different-broadcast'}),{parseDocument:xDocument}),error=>error.code==='SOURCE_UNAVAILABLE'&&error.sourceStage==='linked-redirect');
});
