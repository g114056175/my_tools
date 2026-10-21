import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForMediaSource} from '../extension/media-readiness.js';

const run=async({videos,model=false,source=false,target={mediaKey:1,contentId:'post-1'},ticks=0}={})=>{
 const old={document:globalThis.document,location:globalThis.location};
 const nodes=videos.map(v=>({key:v.key,id:v.id}));
 globalThis.document={querySelectorAll:()=>nodes};
 globalThis.location={href:'https://example.test/feed'};
 globalThis[Symbol.for('video-pocket.identities')]={keys:{get:video=>video.key}};
 globalThis[Symbol.for('video-pocket.sourceEvidence')]={collectMediaEvidence:({video})=>({identity:{id:video.id}})};
 globalThis[Symbol.for('video-pocket.mediaObserver')]={modelFor:()=>model,sourcesFor:()=>({candidates:source?[{url:'https://cdn.example/video.mp4',downloadable:true}]:[]})};
 try{return await waitForMediaSource({...target,timeoutMs:ticks||30});}finally{globalThis.document=old.document;globalThis.location=old.location;delete globalThis[Symbol.for('video-pocket.identities')];delete globalThis[Symbol.for('video-pocket.sourceEvidence')];delete globalThis[Symbol.for('video-pocket.mediaObserver')];}
};
test('waits for an existing model or paired source without using duration',async()=>{assert.equal((await run({videos:[{key:1,id:'post-1'}],source:true})).ready,true);assert.equal((await run({videos:[{key:1,id:'post-1'}]})).ready,false);});
test('recycled key with a different content ID reports changed',async()=>{const result=await run({videos:[{key:1,id:'post-2'}],target:{mediaKey:1,contentId:'post-1'}});assert.equal(result.changed,true);});
test('a replaced node may be reidentified only by a unique matching content ID',async()=>{const result=await run({videos:[{key:2,id:'post-1'}],source:true,target:{mediaKey:1,contentId:'post-1'}});assert.equal(result.ready,true);});

test('post-scroll settling does not accept a ready source before the minimum delay',async()=>{
 const start=Date.now();const result=await run({videos:[{key:1,id:'post-1'}],source:true,target:{mediaKey:1,contentId:'post-1',settleMs:25},ticks:50});
 assert.equal(result.ready,true);assert.ok(Date.now()-start>=25);
});
