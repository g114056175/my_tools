import test from 'node:test';
import assert from 'node:assert/strict';
import {createYoutubeSourceSessions} from '../extension/youtube-source-session.js';

const NOW=1_800_000_000_000;

function descriptor({tabId=7,documentId='doc-a',frameId=0,videoId='video-a',streamId='stream-a',site='youtube'}={}){
 return {tabId,documentId,frameId,platform:{site,id:videoId,streamingData:{serverAbrStreamingUrl:`https://rr.googlevideo.com/videoplayback?id=${encodeURIComponent(streamId)}`}}};
}

function capture(source,overrides={}){
 return {tabId:source.tabId,documentId:source.documentId,frameId:source.frameId,streamId:new URL(source.platform.streamingData.serverAbrStreamingUrl).searchParams.get('id'),body:'bounded-session',createdAt:NOW,...overrides};
}

test('stores a bounded snapshot for its exact YouTube source and returns isolated clones',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),source=descriptor(),original=capture(source,{metadata:{tags:['seed']}});
 const remembered=sessions.remember(source,original);

 assert.deepEqual(remembered,original);
 assert.notStrictEqual(remembered,original);
 original.body='mutated input';original.metadata.tags.push('input mutation');
 assert.equal(sessions.get(source).body,'bounded-session');
 assert.deepEqual(sessions.get(source).metadata.tags,['seed']);

 const firstRead=sessions.get(source);
 assert.notStrictEqual(firstRead,remembered);
 firstRead.body='mutated result';firstRead.metadata.tags.push('read mutation');
 assert.equal(sessions.get(source).body,'bounded-session');
 assert.deepEqual(sessions.get(source).metadata.tags,['seed']);
 assert.equal(sessions.size,1);
});

test('does not share a snapshot across source identity changes',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),source=descriptor();
 sessions.remember(source,capture(source));
 const {frameId,...withoutFrame}=source;
 assert.equal(sessions.get(withoutFrame).body,'bounded-session','an omitted descriptor frame defaults to the top frame');

 for(const other of [
  descriptor({tabId:8}),
  descriptor({documentId:'doc-b'}),
  descriptor({frameId:1}),
  descriptor({videoId:'video-b'}),
  descriptor({streamId:'stream-b'}),
 ]) assert.equal(sessions.get(other),null);

 assert.equal(sessions.get(source).body,'bounded-session');
});

test('validates the descriptor and capture before remembering without replacing a valid entry',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW,maxBodyLength:16}),source=descriptor(),valid=capture(source);
 sessions.remember(source,valid);

 const invalidDescriptors=[
  descriptor({site:'vimeo'}),
  descriptor({videoId:''}),
  descriptor({tabId:-1}),
  descriptor({tabId:7.5}),
  descriptor({documentId:''}),
  {...source,platform:{...source.platform,streamingData:{serverAbrStreamingUrl:'not a url'}}},
  {...source,platform:{...source.platform,streamingData:{serverAbrStreamingUrl:'https://rr.googlevideo.com/videoplayback'}}},
 ];
 for(const invalid of invalidDescriptors){
  assert.equal(sessions.remember(invalid,valid),null);
  assert.equal(sessions.get(invalid),null);
 }

 const invalidCaptures=[
  {...valid,tabId:8},
  {...valid,documentId:'doc-b'},
  {...valid,frameId:1},
  {...valid,streamId:'stream-b'},
  {...valid,body:''},
  {...valid,body:'x'.repeat(17)},
  {...valid,createdAt:NaN},
  {...valid,createdAt:NOW+1},
  {...valid,createdAt:NOW-30*60*1000},
 ];
 for(const invalid of invalidCaptures)assert.equal(sessions.remember(source,invalid),null);

 assert.equal(sessions.get(source).body,'bounded-session');
});

test('enforces the default bounded body size',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),source=descriptor(),atLimit=capture(source,{body:'x'.repeat(87_384)});
 assert.equal(sessions.remember(source,atLimit).body.length,87_384);
 assert.equal(sessions.remember(source,{...atLimit,body:'x'.repeat(87_385)}),null);
 assert.equal(sessions.get(source).body.length,87_384);
});

test('accepts an omitted capture frame and enforces the configured size and TTL boundaries',()=>{
 let now=NOW;
 const source=descriptor(),sessions=createYoutubeSourceSessions({now:()=>now,ttlMs:100,maxBodyLength:4});
 const frameOptional=capture(source,{body:'1234',createdAt:now-99});delete frameOptional.frameId;
 assert.ok(sessions.remember(source,frameOptional));
 assert.equal(sessions.get(source).body,'1234');
 assert.equal(sessions.remember(source,capture(source,{body:'12345'})),null);

 now=NOW+1;
 assert.equal(sessions.get(source),null,'reads do not extend capture lifetime');
 assert.equal(sessions.remember(source,capture(source,{body:'1234',createdAt:now-100})),null,'age equal to TTL is expired');
 assert.equal(sessions.remember(source,capture(source,{body:'1234',createdAt:now-99})).body,'1234');
});

function assertStrongerCaptureRetained(weaker){
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),source=descriptor();
 const strong=capture(source,{body:'strong-session',poLength:4});
 sessions.remember(source,strong);
 const remembered=sessions.remember(source,weaker);
 assert.deepEqual(remembered,strong);
 assert.notStrictEqual(remembered,strong,'retained captures are returned as clones');
 remembered.body='mutated returned clone';
 assert.deepEqual(sessions.get(source),strong);
}

test('a shorter poToken length cannot replace a stronger cached capture',()=>{
 assertStrongerCaptureRetained(capture(descriptor(),{body:'short-session',poLength:1}));
});

test('a capture without poToken length cannot replace a stronger cached capture',()=>{
 const tokenless=capture(descriptor(),{body:'tokenless-session'});delete tokenless.poLength;
 assertStrongerCaptureRetained(tokenless);
});

test('equal poToken lengths prefer newer captures and reject older replacements',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),source=descriptor();
 const older=capture(source,{body:'older-session',poLength:3,createdAt:NOW-10});
 const newer=capture(source,{body:'newer-session',poLength:3,createdAt:NOW});
 sessions.remember(source,older);
 assert.deepEqual(sessions.remember(source,newer),newer);
 assert.deepEqual(sessions.remember(source,older),newer);
});

test('an expired stronger capture is pruned before a weaker capture is remembered',()=>{
 let now=NOW;
 const source=descriptor(),sessions=createYoutubeSourceSessions({now:()=>now,ttlMs:100});
 const strong=capture(source,{body:'expired-strong-session',poLength:8,createdAt:now-99});
 sessions.remember(source,strong);

 now=NOW+1;
 const weaker=capture(source,{body:'fresh-tokenless-session',poLength:0,createdAt:now});
 assert.deepEqual(sessions.remember(source,weaker),weaker);
 assert.deepEqual(sessions.get(source),weaker);
});

test('expires entries and removes only the requested tab',()=>{
 let now=NOW;
 const sessions=createYoutubeSourceSessions({now:()=>now,ttlMs:100}),one=descriptor({tabId:1}),two=descriptor({tabId:2});
 sessions.remember(one,capture(one));sessions.remember(two,capture(two));
 sessions.removeTab(1);
 assert.equal(sessions.get(one),null);
 assert.equal(sessions.get(two).body,'bounded-session');

 now=NOW+100;
 assert.equal(sessions.get(two),null);
});

test('expired source cleanup keeps only captures belonging to remaining exact sources',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW}),old=descriptor(),next=descriptor({videoId:'video-b',streamId:'stream-b'}),other=descriptor({tabId:8});
 for(const source of [old,next,other])sessions.remember(source,capture(source));
 sessions.retainSources([next,other,{tabId:7,platform:{site:'html'}}]);
 assert.equal(sessions.get(old),null,'an unrelated source in the same tab cannot keep an expired capture');
 assert.ok(sessions.get(next));assert.ok(sessions.get(other));
 sessions.retainSources([next,{...next}]);assert.equal(sessions.size,1,'duplicate source records may share their exact capture');
 sessions.retainSources([]);assert.equal(sessions.size,0);
});

test('evicts the least recently used source when the cache exceeds its limit',()=>{
 const sessions=createYoutubeSourceSessions({now:()=>NOW,maxEntries:2}),one=descriptor({videoId:'one',streamId:'one'}),two=descriptor({videoId:'two',streamId:'two'}),three=descriptor({videoId:'three',streamId:'three'});
 sessions.remember(one,capture(one));sessions.remember(two,capture(two));
 assert.ok(sessions.get(one),'reading an entry makes it recently used');
 sessions.remember(three,capture(three));

 assert.equal(sessions.size,2);
 assert.equal(sessions.get(two),null);
 assert.ok(sessions.get(one));
 assert.ok(sessions.get(three));
 sessions.clear();
 assert.equal(sessions.size,0);
});
