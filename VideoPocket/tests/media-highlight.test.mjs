import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightMedia} from '../extension/media-highlight.js';

class NodeMock {
  constructor(tag, rect = {}) { this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.parentNode = null; this.rect = {left: 4, top: 8, width: 120, height: 70, ...rect}; this.isConnected = true; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.isConnected = false; }
  setAttribute() {}
  querySelectorAll(selector) { return selector === 'video' ? (this.videos || []) : (this.nodes || []); }
  contains(node) { return node === this || this.videos?.includes(node) || this.children.includes(node) || this.children.some(child => child.contains?.(node)); }
  getBoundingClientRect() { return this.rect; }
}

function world(videos) {
  const listeners = new Map();
  const root = new NodeMock('html'); const body = new NodeMock('body'); root.append(body); body.videos = videos;
  const documentMock = {documentElement: root, body, createElement: tag => new NodeMock(tag), querySelectorAll: selector => selector === 'video' ? videos : (body.nodes || []),};
  const old = {document: globalThis.document, addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener};
  globalThis.document = documentMock;
  globalThis.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
  globalThis.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn));
  return {root, body, listeners, restore() { globalThis.document = old.document; globalThis.addEventListener = old.addEventListener; globalThis.removeEventListener = old.removeEventListener; }};
}

function identities(entries) {
  const keys = new WeakMap(); for (const [video, key] of entries) keys.set(video, key);
  globalThis[Symbol.for('video-pocket.identities')] = {keys};
  globalThis[Symbol.for('video-pocket.selection')] = {videos: entries.map(([video]) => video)};
}

test('highlights only the exact keyed video and tracks scroll/resize', () => {
  const first = new NodeMock('video', {left: 1}); const second = new NodeMock('video', {left: 20}); const state = world([first, second]);
  try {
    identities([[first, 11], [second, 22]]);
    assert.deepEqual(highlightMedia({mediaKey: 22}), {highlighted: true});
    assert.equal(state.body.children.length, 1);
    const frame = state.body.children[0]; assert.equal(frame.style.left, '20px'); assert.equal(frame.style.background, undefined); assert.equal(frame.style.pointerEvents, 'none');
    second.rect.left = 44; for (const fn of state.listeners.get('scroll') || []) fn(); assert.equal(frame.style.left, '44px');
  } finally { highlightMedia({clear: true}); state.restore(); }
});

test('expired or unknown keys do not fall back to the first video', () => {
  const first = new NodeMock('video'); const state = world([first]);
  try { identities([[first, 1]]); assert.deepEqual(highlightMedia({mediaKey: 2}), {highlighted: false}); assert.equal(state.body.children.length, 0); first.isConnected = false; assert.deepEqual(highlightMedia({mediaKey: 1}), {highlighted: false}); }
  finally { highlightMedia({clear: true}); state.restore(); }
});

test('only an explicit selection scrolls the exact player and paints its new position',()=>{
 const first=new NodeMock('video'),second=new NodeMock('video',{top:1800}),state=world([first,second]);
 const scrolls=[];first.scrollIntoView=options=>scrolls.push({video:'first',options});
 second.scrollIntoView=options=>{scrolls.push({video:'second',options});second.rect.top=220;};
 try{
  identities([[first,1],[second,2]]);
  highlightMedia({mediaKey:2});assert.equal(scrolls.length,0);
  highlightMedia({mediaKey:2,scrollIntoView:true});
  assert.deepEqual(scrolls,[{video:'second',options:{behavior:'instant',block:'center',inline:'nearest'}}]);
  assert.equal(state.body.children[0].style.top,'220px');
  highlightMedia({renew:true});assert.equal(scrolls.length,1);
  highlightMedia({mediaKey:404,scrollIntoView:true});assert.equal(scrolls.length,1,'expired identities must not scroll a different player');
 }finally{highlightMedia({clear:true});state.restore();}
});

test('repeated calls remove the previous frame and timer/listeners', () => {
  const video = new NodeMock('video'); const state = world([video]);
  try {
    identities([[video, 7]]); highlightMedia({mediaKey: 7}); const first = state.body.children[0];
    highlightMedia({mediaKey: 7}); assert.equal(state.body.children.length, 1); assert.notEqual(state.body.children[0], first); assert.equal((state.listeners.get('scroll') || []).length, 1); assert.equal((state.listeners.get('resize') || []).length, 1);
    highlightMedia({clear: true}); assert.equal(state.body.children.length, 0); assert.equal((state.listeners.get('scroll') || []).length, 0); assert.equal((state.listeners.get('resize') || []).length, 0);
  } finally { highlightMedia({clear: true}); state.restore(); }
});

test('open shadow video uses composed root when isConnected is unavailable', () => {
  const video = new NodeMock('video'); delete video.isConnected;
  const shadow = new NodeMock('#shadow'); shadow.videos = [video];
  const host = new NodeMock('div'); host.shadowRoot = shadow;
  const state = world([]); state.body.nodes = [host];
  video.getRootNode = () => globalThis.document;
  try {
    identities([[video, 31]]);
    assert.deepEqual(highlightMedia({mediaKey: 31}), {highlighted: true});
    assert.equal(state.body.children.length, 1);
  } finally { highlightMedia({clear: true}); state.restore(); }
});

test('name badge lasts eight seconds and hides while a different modal covers the page',()=>{
 const video=new NodeMock('video'),state=world([video]);const old={setTimeout,clearTimeout,setInterval,clearInterval};let tick,expire,duration;
 globalThis.setTimeout=(fn,ms)=>{expire=fn;duration=ms;return 1;};globalThis.clearTimeout=()=>{};
 globalThis.setInterval=fn=>{tick=fn;return 2;};globalThis.clearInterval=()=>{};
 try{
  identities([[video,5]]);highlightMedia({mediaKey:5,title:'flower'});const frame=state.body.children[0];
  assert.equal(frame.children[0].textContent,'flower');assert.equal(frame.style.border,'3px solid #2b85bf');assert.equal(frame.style.position,'absolute');assert.equal(frame.style.zIndex,'2');assert.equal(duration,8000);
  const modal=new NodeMock('div');state.body.nodes=[modal];tick();assert.equal(frame.style.display,'none');
  modal.rect.width=0;tick();assert.equal(frame.style.display,'block');expire();assert.equal(state.body.children.length,0);
 }finally{highlightMedia({clear:true});Object.assign(globalThis,old);state.restore();}
});

test('missing title uses the neutral media label instead of page or aria text',()=>{
 const video=new NodeMock('video');video.getAttribute=()=> '頁面標題';video.title='播放器控制';const state=world([video]);
 try{identities([[video,6]]);highlightMedia({mediaKey:6});assert.equal(state.body.children[0].children[0].textContent,'Video');}
 finally{highlightMedia({clear:true});state.restore();}
});

test('marker is positioned within its local scaled containing block',()=>{
 const video=new NodeMock('video',{left:140,top:100,width:240,height:140}),state=world([video]);const parent=new NodeMock('div',{left:100,top:80,width:400,height:300});parent.offsetWidth=200;parent.offsetHeight=150;parent.scrollLeft=5;parent.scrollTop=7;parent.clientLeft=1;parent.clientTop=2;
 const create=state.body.append.bind(state.body);state.body.append=(frame)=>{frame.offsetParent=parent;create(frame);};
 try{identities([[video,8]]);highlightMedia({mediaKey:8});const f=state.body.children[0];assert.equal(f.style.left,'24px');assert.equal(f.style.top,'15px');assert.equal(f.style.width,'120px');assert.equal(f.style.height,'70px');}finally{highlightMedia({clear:true});state.restore();}
});

test('first visible paint and return from a modal measure the rendered offsetParent',()=>{
 const video=new NodeMock('video',{left:140,top:100,width:240,height:140}),state=world([video]);
 const parent=new NodeMock('div',{left:100,top:80,width:400,height:300});Object.assign(parent,{offsetWidth:200,offsetHeight:150,scrollLeft:5,scrollTop:7,clientLeft:1,clientTop:2});
 const append=state.body.append.bind(state.body);let tick;
 const originalInterval=globalThis.setInterval;globalThis.setInterval=fn=>{tick=fn;return originalInterval(fn,200);};
 state.body.append=frame=>{
  Object.defineProperty(frame,'offsetParent',{get(){return frame.style.display==='none'?null:parent;}});
  append(frame);
 };
 try{
  identities([[video,81]]);highlightMedia({mediaKey:81});const frame=state.body.children[0];
  const verify=()=>{assert.equal(frame.style.visibility,'visible');assert.equal(frame.style.left,'24px');assert.equal(frame.style.top,'15px');assert.equal(frame.style.width,'120px');assert.equal(frame.style.height,'70px');};
  verify();assert.equal(frame.style.transition,'none');
  const modal=new NodeMock('div');state.body.nodes=[modal];tick();assert.equal(frame.style.display,'none');
  modal.rect.width=0;tick();verify();
 }finally{highlightMedia({clear:true});globalThis.setInterval=originalInterval;state.restore();}
});

test('a stale marker owner cannot clear or renew a newer marker',()=>{
 const video=new NodeMock('video'),state=world([video]);try{
  identities([[video,9]]);highlightMedia({mediaKey:9,requestId:'old'});highlightMedia({mediaKey:9,requestId:'new'});
  assert.equal(highlightMedia({clear:true,requestId:'old'}).highlighted,false);assert.equal(state.body.children.length,1);
  assert.equal(highlightMedia({renew:true,requestId:'new'}).highlighted,true);assert.equal(state.body.children.length,1);
  highlightMedia({clear:true,requestId:'new'});assert.equal(state.body.children.length,0);
 }finally{highlightMedia({clear:true});state.restore();}
});
