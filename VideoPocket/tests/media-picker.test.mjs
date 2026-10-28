import test from 'node:test';
import assert from 'node:assert/strict';
import {MEDIA_PICKER_ACTIONS, matchRememberedMedia, rememberedMediaSelector, startMediaPicker} from '../extension/media-picker.js';

class NodeMock {
  constructor(tag, rect = {}) { this.tagName = tag.toUpperCase(); this.style = {}; this.attrs = {}; this.children = []; this.parentNode = null; this.rect = {left: 0, top: 0, width: 100, height: 60, ...rect}; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] || null; }
  querySelectorAll(selector) { return selector === 'video' ? (this.videos || []) : []; }
  querySelector() { return null; }
  getBoundingClientRect() { return this.rect; }
}

function world(videos) {
  const listeners = new Map();
  const body = new NodeMock('body'); body.videos = videos;
  const documentMock = {
    body, documentElement: body,
    querySelectorAll: selector => selector === 'video' ? videos : [],
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); },
    dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event); },
    createElement: tag => new NodeMock(tag),
  };
  const old = {document: globalThis.document, location: globalThis.location};
  globalThis.document = documentMock; globalThis.location = {href: 'https://example.test/feed'};
  return {documentMock, restore() { globalThis.document = old.document; globalThis.location = old.location; }};
}

test('selector remembers mediaKey/frame/document and matches a later snapshot', () => {
  const selection = {mediaKey: 22, frameId: 3, documentId: 'doc-1', localMediaIndex: 1};
  assert.deepEqual(rememberedMediaSelector(selection), {...selection, url: null});
  assert.equal(matchRememberedMedia({frameId: 3, documentId: 'doc-1', videos: [{mediaKey: 11}, {mediaKey: 22, title: '第二部'}]}, selection).title, '第二部');
  assert.equal(matchRememberedMedia({frameId: 2, documentId: 'doc-1', videos: [{mediaKey: 22}]}, selection), null);
});

test('picker selects the hovered second video and prevents site click', async () => {
  const first = new NodeMock('video', {left: 0}); const second = new NodeMock('video', {left: 120});
  second.title = '第二部'; const state = world([first, second]);
  try {
    const picked = startMediaPicker({requestId: 'r1', frameId: 4, documentId: 'doc'});
    assert.equal(state.documentMock.body.children[1].textContent,'Select video');
    assert.equal(state.documentMock.body.children[2].textContent,'Click a video, then reopen VideoPocket · Esc cancels');
    state.documentMock.dispatch('pointermove', {clientX: 130, clientY: 20, composedPath: () => [second]});
    assert.equal(state.documentMock.body.children[1].textContent,'Selected: 第二部','the source video title is preserved');
    let prevented = false; let stopped = false;
    state.documentMock.dispatch('click', {clientX: 130, clientY: 20, composedPath: () => [second], preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; }});
    const result = await picked;
    assert.equal(result.action, MEDIA_PICKER_ACTIONS.selected); assert.equal(result.localMediaIndex, 1); assert.equal(result.frameId, 4); assert.equal(result.documentId, 'doc');
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(state.documentMock.body.children.length, 0, 'picker overlay and label are cleaned up');
  } finally { state.restore(); }
});

test('picker uses an English fallback label when the page exposes only a generic title',async()=>{
 const video=new NodeMock('video');video.title='影片';const state=world([video]);
 try{
  const pending=startMediaPicker({requestId:'english-fallback'});
  state.documentMock.dispatch('pointermove',{clientX:20,clientY:20,composedPath:()=>[video]});
  assert.equal(state.documentMock.body.children[1].textContent,'Selected: Video 1');
  state.documentMock.dispatch('keydown',{key:'Escape',preventDefault(){},stopImmediatePropagation(){}});await pending;
 }finally{state.restore();}
});

test('Escape cancels and removes the active overlay without touching playback', async () => {
  const video = new NodeMock('video'); video.currentTime = 12; const state = world([video]);
  try {
    const pending = startMediaPicker({requestId: 'r2'});
    state.documentMock.dispatch('keydown', {key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}});
    const result = await pending;
    assert.equal(result.action, MEDIA_PICKER_ACTIONS.cancelled); assert.equal(video.currentTime, 12); assert.equal(state.documentMock.body.children.length, 0);
  } finally { state.restore(); }
});

test('Bilibili mini-player picking returns the same route/part identity used by snapshots',async()=>{
 const main=new NodeMock('video'),mini=new NodeMock('video',{left:120});mini.closest=selector=>selector.includes('#bilibili-player')?{}:null;
 const state=world([main,mini]);globalThis.location={href:'https://www.bilibili.com/video/BVfixture/?p=2'};
 try{
  const pending=startMediaPicker({requestId:'bili-mini',frameId:0,documentId:'doc'});
  state.documentMock.dispatch('click',{clientX:130,clientY:20,composedPath:()=>[mini],preventDefault(){},stopImmediatePropagation(){}});
  const result=await pending;assert.equal(result.ok,true);assert.equal(result.mediaIdentity,'bilibili:BVfixture:2');
 }finally{state.restore();}
});

test('picker recognizes a Bilibili bwp-video host through an open shadow boundary',async()=>{
 const main=new NodeMock('video'),ad=new NodeMock('video',{left:120});const host={closest:selector=>selector.includes('bwp-video')?{}:null};main.getRootNode=()=>({host});ad.getRootNode=()=>({host:null});
 const state=world([main,ad]);globalThis.location={href:'https://www.bilibili.com/video/BVshadow01/?p=2'};
 try{const pending=startMediaPicker({requestId:'bili-shadow',frameId:0,documentId:'doc'});state.documentMock.dispatch('click',{clientX:20,clientY:20,composedPath:()=>[main],preventDefault(){},stopImmediatePropagation(){}});const result=await pending;assert.equal(result.mediaIdentity,'bilibili:BVshadow01:2');}
 finally{state.restore();}
});

test('picker never chooses a video hidden behind a login dialog',async()=>{
 const video=new NodeMock('video');const state=world([video]);const query=state.documentMock.querySelectorAll;
 const modal=new NodeMock('div');modal.contains=()=>false;
 state.documentMock.querySelectorAll=selector=>selector.includes('[role="dialog"]')?[modal]:query(selector);
 try{
  const pending=startMediaPicker({requestId:'blocked'});let prevented=false;
  state.documentMock.dispatch('pointermove',{clientX:20,clientY:20,composedPath:()=>[video]});
  assert.equal(state.documentMock.body.children[0].style.display,'none');
  state.documentMock.dispatch('click',{clientX:20,clientY:20,composedPath:()=>[video],preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.equal(prevented,false);state.documentMock.dispatch('keydown',{key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal((await pending).ok,false);
 }finally{state.restore();}
});

test('picker accepts an SVG inside an owned player button without activating playback',async()=>{
 const video=new NodeMock('video'),state=world([video]);
 const wrapper=new NodeMock('div'),button=new NodeMock('button'),icon=new NodeMock('path');
 wrapper.parentElement=state.documentMock.body;wrapper.contains=node=>node===video||node===button||node===icon;
 button.parentElement=wrapper;icon.closest=()=>button;
 state.documentMock.elementsFromPoint=()=>[icon,button,wrapper];
 try{
  const pending=startMediaPicker({requestId:'svg-control'});let prevented=false;
  state.documentMock.dispatch('click',{clientX:20,clientY:20,composedPath:()=>[icon,button,wrapper],preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.equal((await pending).ok,true);assert.equal(prevented,true);
 }finally{state.restore();}
});

test('picker rejects covering card links and unrelated buttons outside the video',async()=>{
 for(const kind of ['link','unrelated-button']){
  const video=new NodeMock('video'),state=world([video]),wrapper=new NodeMock('div'),control=new NodeMock(kind==='link'?'a':'button'),icon=new NodeMock('span');
  wrapper.parentElement=state.documentMock.body;wrapper.contains=node=>node===video||node===control;control.parentElement=wrapper;icon.closest=()=>control;
  state.documentMock.elementsFromPoint=()=>[icon,control,wrapper];
  try{
   const pending=startMediaPicker({requestId:kind});let prevented=false;
   state.documentMock.dispatch('click',{clientX:kind==='link'?20:500,clientY:20,composedPath:()=>[icon,control,wrapper],preventDefault(){prevented=true;},stopImmediatePropagation(){}});
   assert.equal(prevented,false);state.documentMock.dispatch('keydown',{key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal((await pending).ok,false);
  }finally{state.restore();}
 }
});
