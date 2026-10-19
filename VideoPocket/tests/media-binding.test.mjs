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

test('an explicit player ID without a source never borrows the old route model', () => {
  const target = video({props: {videoID: 'new-id', request: {files: {}}}});
  target.ownerDocument = documentFor([target]);
  const store = storeWith('old-route');
  assert.equal(store.modelFor(target, 'https://www.facebook.com/reel/old-route'), null);
});
