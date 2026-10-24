import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaModelStore, extractMediaModels} from '../extension/media-models.js';

function model(id, url = `https://cdn.example/${id}.mp4`) {
  return extractMediaModels({__typename: 'Video', id, video_url: url})[0];
}

function documentFor(videos = []) {
  return {querySelectorAll: selector => selector === 'video' ? videos : []};
}

function video({props, fiber, document: doc, parentElement} = {}) {
  const node = {
    nodeType: 1,
    currentSrc: '', src: '',
    ownerDocument: doc,
    parentElement: parentElement || null,
    closest: () => null,
    getAttribute: () => '',
  };
  if (props) Object.defineProperty(node, '__reactProps$test', {value: props});
  if (fiber) Object.defineProperty(node, '__reactFiber$test', {value: fiber});
  return node;
}

function storeWith(...ids) {
  const store = createMediaModelStore();
  store.merge(ids.map(id => model(id)));
  return store;
}

test('Instagram Polaris media IDs bind to the exact decimal player ID without changing other sites',()=>{
 const id='3971730051816042598',other='3971730051816042599',page='https://www.instagram.com/reel/Dcea3BiPTBm/';
 const payload=id=>({id:`POLARIS_${id}`,code:id===other?'OtherReel':'Dcea3BiPTBm',video_versions:[{url:`https://cdn.example/${id}.mp4`,width:720,height:1280}],video_dash_manifest:'<MPD></MPD>'});
 const primary=video({props:{videoID:id}}),neighbor=video({props:{videoID:other}}),doc=documentFor([primary,neighbor]);primary.ownerDocument=neighbor.ownerDocument=doc;
 const store=createMediaModelStore();store.merge(extractMediaModels([payload(id),payload(other)],{baseUrl:page}));
 assert.equal(store.modelFor(primary,page)?.id,`POLARIS_${id}`);
 assert.equal(store.modelFor(neighbor,page)?.id,`POLARIS_${other}`);
 assert.ok(store.modelFor(primary,page)?.versions[0].url.endsWith(`/${id}.mp4`));
 for(const baseUrl of ['https://www.facebook.com/feed','https://x.com/post','https://notinstagram.com/']){
  const [model]=extractMediaModels(payload(id),{baseUrl});assert.ok(!model.aliases.includes(id));
 }
});

test('Instagram does not normalize approximate Polaris spellings or borrow an unrelated media ID',()=>{
 const id='3971730051816042598',page='https://www.instagram.com/reel/Dcea3BiPTBm/',target=video({props:{videoID:id}});target.ownerDocument=documentFor([target]);
 for(const wrong of [`NOT_POLARIS_${id}`,`POLARIS_${id}_owner`,`POLARIS_3971730051816042599`]){
  const store=createMediaModelStore();store.merge(extractMediaModels({id:wrong,video_url:'https://cdn.example/other.mp4'},{baseUrl:page}));
  assert.equal(store.modelFor(target,page),null);
 }
});

test('React props videoID selects the exact model and extracts its owned payload', () => {
  const doc = documentFor();
  const target = video({props: {player: {videoID: 'fb-a', videoDeliveryLegacyFields: {id: 'fb-a', browser_native_hd_url: 'https://cdn.example/fb-a.mp4'}}}, document: doc});
  doc.querySelectorAll = selector => selector === 'video' ? [target] : [];
  const store = createMediaModelStore();
  assert.equal(store.modelFor(target, 'https://www.facebook.com/feed')?.id, 'fb-a');
  assert.equal(store.modelFor(target, 'https://www.facebook.com/feed')?.versions[0].url, 'https://cdn.example/fb-a.mp4');
});

test('two feed videos remain bound to their own React IDs', () => {
  const a = video({props: {videoID: 'a'}}), b = video({props: {videoId: 'b'}});
  const doc = documentFor([a, b]); a.ownerDocument = b.ownerDocument = doc;
  const store = storeWith('a', 'b');
  assert.equal(store.modelFor(a, 'https://www.facebook.com/feed')?.id, 'a');
  assert.equal(store.modelFor(b, 'https://www.facebook.com/feed')?.id, 'b');
});

test('multiple IDs in one props tree are ambiguous and rejected', () => {
  const target = video({props: {videoID: 'a', nested: {videoId: 'b', video_url: 'https://cdn.example/b.mp4'}}});
  target.ownerDocument = documentFor([target]);
  const store = storeWith('a', 'b');
  assert.equal(store.modelFor(target, 'https://www.facebook.com/feed'), null);
});

test('descriptor getters are not invoked while inspecting props', () => {
  let reads = 0;
  const props = {};
  Object.defineProperty(props, 'videoId', {get() { reads++; throw new Error('getter invoked'); }, enumerable: true});
  const target = video({props}); target.ownerDocument = documentFor([target]);
  assert.doesNotThrow(() => createMediaModelStore().modelFor(target, 'https://www.facebook.com/feed'));
  assert.equal(reads, 0);
});

test('fiber traversal inspects only the current fiber and its parents', () => {
  const child = {memoizedProps: {videoID: 'child'}};
  const sibling = {memoizedProps: {videoID: 'sibling'}};
  const parent = {memoizedProps: {videoID: 'parent', video_url: 'https://cdn.example/parent.mp4'}, child, sibling};
  const current = {memoizedProps: {}, return: parent, stateNode: null};
  const target = video({fiber: current}); target.ownerDocument = documentFor([target]);
  const store = storeWith('child', 'sibling', 'parent');
  assert.equal(store.modelFor(target, 'https://www.facebook.com/feed')?.id, 'parent');
});

test('a video ID on its own React node can bind a source payload from an ancestor player',()=>{
  const parent={memoizedProps:{videoDeliveryLegacyFields:{id:'fb-current',browser_native_hd_url:'https://cdn.example/fb-current.mp4'}}};
  const current={memoizedProps:{videoID:'fb-current'},return:parent};
  const target=video({fiber:current});target.ownerDocument=documentFor([target]);
  const store=storeWith('fb-current','fb-old');
  assert.equal(store.modelFor(target,'https://www.facebook.com/kfctaiwan')?.id,'fb-current');
  assert.equal(store.modelFor(target,'https://www.facebook.com/kfctaiwan')?.versions[0].url,'https://cdn.example/fb-current.mp4');
});

test('a conflicting ancestor source identity is not borrowed by the selected video',()=>{
  const parent={memoizedProps:{videoID:'fb-sibling',videoDeliveryLegacyFields:{id:'fb-sibling',browser_native_hd_url:'https://cdn.example/fb-sibling.mp4'}}};
  const current={memoizedProps:{videoID:'fb-current'},return:parent};
  const target=video({fiber:current});target.ownerDocument=documentFor([target]);
  assert.equal(storeWith('fb-current','fb-sibling').modelFor(target,'https://www.facebook.com/kfctaiwan'),null);
});

test('an explicit player ID without a source never borrows the old route model', () => {
  const target = video({props: {videoID: 'new-id', request: {files: {}}}});
  target.ownerDocument = documentFor([target]);
  const store = storeWith('old-route');
  assert.equal(store.modelFor(target, 'https://www.facebook.com/reel/old-route'), null);
});

test('TikTok post and media resource IDs are aliases of one model, not conflicting videos',()=>{
 const target=video({props:{item:{id:'7690095904514297106',desc:'Correct post',video:{id:'7690095904514297106',videoID:'v14025g50000resource',playAddr:'https://cdn.example/current.mp4'}}}});
 target.ownerDocument=documentFor([target]);
 const store=createMediaModelStore(),result=store.modelFor(target,'https://www.tiktok.com/zh-Hant-TW/');
 assert.ok(result);assert.ok(result.aliases.includes('7690095904514297106'));
 assert.ok(result.aliases.includes('v14025g50000resource'));assert.equal(result.title,'');
 assert.ok(result.versions.some(item=>item.url==='https://cdn.example/current.mp4'));
});

test('owned Facebook response fragments expose sources without borrowing neighbouring players',()=>{
 const target=video({props:{videoID:'fb-new',videoDeliveryResponseFragment:{videoDeliveryResponseResult:{progressive_urls:[{progressive_url:'https://cdn.example/current.mp4'}]}}}});
 target.ownerDocument=documentFor([target]);
 const result=createMediaModelStore().modelFor(target,'https://www.facebook.com/feed');
 assert.equal(result.id,'fb-new');assert.equal(result.versions[0].url,'https://cdn.example/current.mp4');
});

for(const key of ['videoFBID','mediaID'])test(`Facebook ${key} source aliases match the rendered player without borrowing a neighbour`,()=>{
 const target=video({props:{[key]:'fb-current'}});target.ownerDocument=documentFor([target]);
 const payload=id=>({__typename:'Video',[key]:id,videoDeliveryResponseFragment:{videoDeliveryResponseResult:{progressive_urls:[{progressive_url:`https://video.fbcdn.net/${id}.mp4`}]}}});
 const store=createMediaModelStore();store.merge(extractMediaModels(payload('fb-neighbour')));
 assert.equal(store.modelFor(target,'https://www.facebook.com/feed'),null);
 store.merge(extractMediaModels(payload('fb-current')));
 const model=store.modelFor(target,'https://www.facebook.com/feed');
 assert.equal(model.id,'fb-current');assert.ok(model.aliases.includes('fb-current'));
 assert.equal(model.versions[0].url,'https://video.fbcdn.net/fb-current.mp4');
});
