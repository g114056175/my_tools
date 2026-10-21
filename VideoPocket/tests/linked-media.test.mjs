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
