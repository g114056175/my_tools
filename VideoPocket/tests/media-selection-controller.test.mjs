import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaSelectionController, selectedMediaIndex, collapseBilibiliPlayers, recoverBilibiliRoute} from '../extension/media-selection-controller.js';
import {stableHash} from '../extension/download-identity.js';

const frames = [{frameId: 0, documentId: 'top-doc', result: {url: 'https://example.test/feed'}}, {frameId: 2, documentId: 'child-doc', result: {url: 'https://example.test/frame'}}];

function apiMock() {
  const calls = []; const badges = []; const writes = []; let writeResolve;
  const api = {
    calls, badges, writes,
    action: {setBadgeText: async value => { badges.push(value); }},
    storage: {session: {set: async value => { writes.push(value); if (!writeResolve) await new Promise(resolve => { writeResolve = resolve; }); else await writeResolve; }}},
    scripting: {executeScript: async request => {
      calls.push(request);
      if (request.func.toString().includes('location.href')) return frames;
      return new Promise(resolve => { request.resolve = resolve; });
    }},
    releaseStorage() { writeResolve?.(); },
  };
  return api;
}

test('selectedMediaIndex requires page, frame, document, media identity and source token', () => {
  const url = 'https://example.test/feed';
  const selection = {pageToken: stableHash(url), frameId: 2, documentId: 'child-doc', mediaKey: 8, sourceToken: stableHash('https://cdn/video.mp4')};
  const videos = [{frameId: 2, documentId: 'child-doc', mediaKey: 8, url: 'https://cdn/video.mp4'}];
  assert.equal(selectedMediaIndex(videos, selection, url), 0);
  assert.equal(selectedMediaIndex([{...videos[0], documentId: 'other'}], selection, url), -1);
  assert.equal(selectedMediaIndex([{...videos[0], url: 'https://cdn/new-post.mp4'}], selection, url), -1);
});

test('picker model identity survives summary evidence identity changing before deep snapshot',()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const selection={pageToken:stableHash(url),frameId:0,documentId:'x-doc',mediaKey:11,sourceToken:stableHash('blob:broadcast'),modelToken:stableHash('broadcast-model'),selectionIdentity:'x-broadcast',selectionToken:stableHash('x-broadcast')};
 // Picker captured the deep model ID; summary only exposes the post-scoped
 // evidence key. The stable element key still identifies the same player.
 const summary=[{frameId:0,documentId:'x-doc',mediaKey:11,url:'blob:broadcast',mediaIdentity:'x.com:2112242739198959913',selectionIdentity:'x-broadcast'}];
 assert.equal(selectedMediaIndex(summary,selection,url),0);
});

test('stable selection identity does not permit a changed element identity or source',()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const selection={pageToken:stableHash(url),frameId:0,documentId:'x-doc',mediaKey:11,sourceToken:stableHash('blob:broadcast'),selectionIdentity:'x-broadcast',selectionToken:stableHash('x-broadcast')};
 const base={frameId:0,documentId:'x-doc',mediaKey:11,selectionIdentity:'x-broadcast',url:'blob:broadcast'};
 assert.equal(selectedMediaIndex([{...base}],selection,url),0);
 assert.equal(selectedMediaIndex([{...base,selectionIdentity:'x-other'}],selection,url),-1);
 assert.equal(selectedMediaIndex([{...base,url:'blob:changed'}],selection,url),-1);
});

test('Twitch selection survives player replacement for the same VOD but never another VOD or frame',()=>{
 const url='https://www.twitch.tv/videos/123',id='twitch-vod:123',selection={pageToken:stableHash(url),frameId:0,documentId:'doc',mediaKey:1,sourceToken:stableHash('blob:old'),modelToken:stableHash(id)};
 const video={frameId:0,documentId:'doc',mediaKey:99,url:'blob:new',mediaIdentity:id};
 assert.equal(selectedMediaIndex([video],selection,url),0);
 assert.equal(selectedMediaIndex([{...video,mediaIdentity:'twitch-vod:456'}],selection,url),-1);
 assert.equal(selectedMediaIndex([{...video,frameId:2}],selection,url),-1);
});

test('Bilibili normal and floating elements collapse within one document and preserve independent videos',()=>{
 const main={bilibiliMain:true,mediaIdentity:'bilibili:BVfixture:1',mediaKey:1,frameId:0,documentId:'doc',bilibiliRank:1,localMediaIndex:0};
 const mini={...main,mediaKey:2,bilibiliRank:8,localMediaIndex:1},ad={mediaKey:3,frameId:0,documentId:'doc'},otherFrame={...mini,frameId:2};
 const input=[main,mini,ad,otherFrame],result=collapseBilibiliPlayers(input);
 assert.equal(result.length,3);assert.equal(result[0].mediaKey,2);assert.equal(result[0].localMediaIndex,1);assert.deepEqual(result[0].aliasMediaKeys,[1,2]);
 assert.equal(result[1],ad);assert.equal(result[2].frameId,2);assert.equal(main.mediaKey,1);
 assert.equal(collapseBilibiliPlayers([main,{...mini,mediaIdentity:'bilibili:BVother:1'}]).length,2);
});

test('Bilibili picked selection survives main/mini replacement but rejects another part or document',()=>{
 const url='https://www.bilibili.com/video/BVfixture/?p=2',id='bilibili:BVfixture:2';
 const selection={pageToken:stableHash(url),frameId:0,documentId:'doc',mediaKey:1,sourceToken:stableHash('blob:old'),modelToken:stableHash(id)};
 const video={bilibiliMain:true,mediaIdentity:id,mediaKey:99,frameId:0,documentId:'doc',url:'blob:new'};
 assert.equal(selectedMediaIndex([video],selection,url),0);
 for(const changed of [{mediaIdentity:'bilibili:BVfixture:1'},{documentId:'new-doc'},{frameId:3},{bilibiliMain:false}])assert.equal(selectedMediaIndex([{...video,...changed}],selection,url),-1);
});

test('Bilibili route recovery creates only a verified canonical target and keeps real downloads',()=>{
 const top={url:'https://www.bilibili.com/video/BVroute01/?p=2',bilibiliContext:{site:'bilibili',bvid:'BVroute01',cid:22,page:2,title:'Route',duration:600}};
 const frame={frameId:0,documentId:'doc'};
 const unknown={mediaKey:8,url:'blob:unknown'},real={mediaKey:9,url:'blob:real',downloadUrl:'https://cdn.test/real.mp4'};
 const result=recoverBilibiliRoute([unknown,real],top,frame);assert.equal(result.length,2);assert.equal(result[0].routeOnly,true);assert.equal(result[0].downloadUrl,top.url);assert.equal(result[1],real);
});

test('Bilibili route recovery rejects stale BVID, page, and missing CID contexts',()=>{
 const frame={frameId:0,documentId:'doc'},video={mediaKey:8,url:'blob:unknown'};
 assert.deepEqual(recoverBilibiliRoute([video],{url:'https://www.bilibili.com/video/BVold01/?p=2',bilibiliContext:{site:'bilibili',bvid:'BVcurrent01',cid:22,page:2}},frame),[video]);
 assert.deepEqual(recoverBilibiliRoute([video],{url:'https://www.bilibili.com/video/BVcurrent01/?p=3',bilibiliContext:{site:'bilibili',bvid:'BVcurrent01',cid:22,page:2}},frame),[video]);
 assert.deepEqual(recoverBilibiliRoute([video],{url:'https://www.bilibili.com/video/BVcurrent01/?p=2',bilibiliContext:{site:'bilibili',bvid:'BVcurrent01',cid:0,page:2}},frame),[video]);
});

test('explicit clear cancels the picker and waits for a pending selection write before removal',async()=>{
 const order=[];let selected,release;
 const api={action:{setBadgeText:async()=>{}},storage:{session:{set:async()=>{order.push('write-start');await new Promise(r=>release=r);order.push('write-end');},remove:async()=>order.push('remove')}},scripting:{executeScript:async request=>{
  if(!request.args)return [frames[0]];
  if(request.func.name==='cancelMediaPicker')return [];
  return new Promise(resolve=>{selected=()=>resolve([{result:{ok:true,requestId:request.args[0].requestId,mediaKey:1}}]);});
 }}};
 const controller=createMediaSelectionController(api);await controller.begin(3);selected();await new Promise(r=>setImmediate(r));
 const clearing=controller.clear(3);await new Promise(r=>setImmediate(r));assert.deepEqual(order,['write-start']);
 release();await clearing;assert.deepEqual(order,['write-start','write-end','remove']);
});

test('begin claims tab before frame discovery and a later begin owns the tab', async () => {
  const api = apiMock(); const controller = createMediaSelectionController(api);
  let firstDiscoveryResolve; let discoveryCount = 0; api.scripting.executeScript = async request => {
    api.calls.push(request);
    if (!request.args) { discoveryCount++; if (discoveryCount === 1) return new Promise(resolve => { firstDiscoveryResolve = resolve; }); return frames; }
    return [];
  };
  const first = controller.begin(11); const second = controller.begin(11);
  firstDiscoveryResolve(frames);
  assert.deepEqual(await first, {started: false});
  assert.equal((await second).started, true);
});

test('late storage completion from an old selection cannot clear a newer request', async () => {
  const api = apiMock(); const controller = createMediaSelectionController(api);
  let pickerResolve; let discoveryCount = 0;
  api.scripting.executeScript = async request => {
    api.calls.push(request);
    if (!request.args) { discoveryCount++; return frames; }
    if (discoveryCount === 1) return new Promise(resolve => { pickerResolve = resolve; });
    return new Promise(() => {});
  };
  const first = await controller.begin(12); assert.equal(first.started, true);
  const firstStart = api.calls.find(call => call.args?.[0]?.requestId);
  const requestId = firstStart.args[0].requestId;
  pickerResolve([{result: {ok: true, requestId, frameId: 2, documentId: 'child-doc', mediaKey: 9, url: 'https://cdn/one'}}]);
  await new Promise(resolve => setImmediate(resolve));
  const second = await controller.begin(12); assert.equal(second.started, true);
  api.releaseStorage();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(api.badges, [], 'selection requests must leave the toolbar icon unchanged');
  const cancelCall = api.calls.find(call => call.args?.[0]?.requestId === requestId && call.target?.allFrames);
  assert.ok(cancelCall, 'replacing a request cancels every frame with the old requestId');
});

function pickerApi({storageSet, frameResult = () => null} = {}) {
  const calls = []; const badges = [];
  return {
    calls, badges,
    action: {setBadgeText: async value => badges.push(value)},
    storage: {session: {set: storageSet || (async () => {})}},
    scripting: {executeScript: async request => {
      calls.push(request);
      if (!request.args) return frames;
      if (request.target?.allFrames) return [];
      const options = request.args[0]; const result = frameResult(options);
      return result ? [{result: {...result, requestId: options.requestId, frameId: options.frameId, documentId: options.documentId}}] : new Promise(() => {});
    }},
  };
}

test('successful selection cancels every other frame with the same requestId', async () => {
  const api = pickerApi({frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: 7, url: 'https://cdn/selected'} : null});
  const controller = createMediaSelectionController(api); await controller.begin(20);
  await new Promise(resolve => setImmediate(resolve));
  const picker = api.calls.find(call => call.args?.[0]?.frameId === 2); const requestId = picker.args[0].requestId;
  const cancel = api.calls.find(call => call.target?.allFrames && call.args?.[0]?.requestId === requestId);
  assert.ok(cancel, 'selection completion broadcasts cancellation to all frames');
  assert.deepEqual(api.badges, [], 'successful selection must not add a toolbar badge');
});

test('Escape cancellation broadcasts to every frame', async () => {
  const api = pickerApi({frameResult: options => options.frameId === 0 ? {ok: false, reason: 'cancelled'} : null});
  const controller = createMediaSelectionController(api); await controller.begin(21);
  await new Promise(resolve => setImmediate(resolve));
  const picker = api.calls.find(call => call.args?.[0]?.frameId === 0); const requestId = picker.args[0].requestId;
  assert.ok(api.calls.some(call => call.target?.allFrames && call.args?.[0]?.requestId === requestId));
  assert.deepEqual(api.badges, [], 'cancellation must not change the toolbar badge');
});

test('storage failure releases active request so a later selection can start', async () => {
  let attempts = 0;
  const api = pickerApi({storageSet: async () => { attempts++; throw new Error('session unavailable'); }, frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: attempts + 1, url: `https://cdn/${attempts}`} : null});
  const controller = createMediaSelectionController(api);
  assert.equal((await controller.begin(22)).started, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.deepEqual(api.badges, [], 'a failed selection must not change the toolbar badge');
  assert.equal((await controller.begin(22)).started, true, 'retry is accepted after the failed write');
});

test('delayed storage writes stay ordered across two selections', async () => {
  const writes = []; const resolvers = [];
  const api = pickerApi({storageSet: async value => { writes.push(value); await new Promise(resolve => resolvers.push(resolve)); }, frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: options.requestId.endsWith('a') ? 1 : 2, url: `https://cdn/${options.requestId}`} : null});
  const controller = createMediaSelectionController(api);
  // Make request IDs deterministic for this ordering assertion.
  const originalRandomUUID = crypto.randomUUID; let serial = 0; crypto.randomUUID = () => `${++serial}a`;
  try {
    await controller.begin(23); await new Promise(resolve => setImmediate(resolve));
    const first = api.calls.find(call => call.args?.[0]?.frameId === 2); const firstId = first.args[0].requestId;
    assert.equal(writes.length, 1);
    crypto.randomUUID = () => '2b';
    await controller.begin(23); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.length, 1, 'second write waits for first');
    resolvers.shift()(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.length, 2); assert.equal(Object.values(writes[0])[0].mediaKey, 1); assert.equal(Object.values(writes[1])[0].mediaKey, 2);
    resolvers.shift()();
  } finally { crypto.randomUUID = originalRandomUUID; }
});

function reopenApi({activeTabId=20,openPopup=true,focused=true}={}){
 const calls=[],opened=[],framesLocal=frames;
 const api={calls,opened,action:{setBadgeText:async()=>{},...(openPopup?{openPopup:async options=>opened.push(options)}:{})},tabs:{query:async()=>[{id:activeTabId,windowId:7}]},windows:{get:async()=>({focused})},storage:{session:{set:async()=>{},remove:async()=>{}}},scripting:{executeScript:async request=>{
   calls.push(request);if(!request.args)return framesLocal;if(request.target?.allFrames)return [];
   return request.args[0].frameId===2?[{result:{ok:true,requestId:request.args[0].requestId,frameId:2,documentId:'child-doc',mediaKey:4,url:'https://cdn/selected'}}]:new Promise(()=>{});
 }} };
 return api;
}

test('successful selection reopens popup only when the original tab remains active',async()=>{
 const api=reopenApi();const controller=createMediaSelectionController(api);assert.equal((await controller.begin(20)).started,true);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(api.opened,[{windowId:7}]);
 const switched=reopenApi({activeTabId:99});const other=createMediaSelectionController(switched);await other.begin(20);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(switched.opened,[]);
});

test('a newer selection request invalidates a pending popup reopen',async()=>{
 const api=reopenApi();let releaseQuery;api.tabs.query=async()=>new Promise(resolve=>{releaseQuery=()=>resolve([{id:20,windowId:7}]);});const controller=createMediaSelectionController(api);await controller.begin(20);await new Promise(resolve=>setImmediate(resolve));
 const second=controller.begin(20);releaseQuery();await second;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(api.opened,[]);
});

test('missing openPopup feature degrades without rejecting a successful selection',async()=>{
 const api=reopenApi({openPopup:false});const controller=createMediaSelectionController(api);await controller.begin(20);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(api.opened,[]);
});

test('selection does not reopen a popup when the browser window is not focused',async()=>{
 const api=reopenApi({focused:false}),controller=createMediaSelectionController(api);await controller.begin(20);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(api.opened,[]);
});
