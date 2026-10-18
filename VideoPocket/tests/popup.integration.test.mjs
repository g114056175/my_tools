import test from 'node:test';
import assert from 'node:assert/strict';

class ClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, force) { if (force === undefined ? !this.values.delete(name) : force) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.options = []; this.listeners = {}; this.classList = new ClassList(); this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.title = ''; this.selected = false; this.dataset = {}; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async dispatch(name) { for (const fn of this.listeners[name] || []) await fn({target:this}); }
  async click() { if (!this.disabled) await this.dispatch('click'); }
  append(...items) { for (const item of items) this.children.push(item); }
  replaceChildren(...items) { this.children = []; this.options = []; this.append(...items); }
  add(item) { this.options.push(item); this.children.push(item); }
  setAttribute(name, value) { this[name] = value; }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
  get clientHeight() { return 24; }
}
class DocumentMock {
  constructor() { this.nodes = new Map(); for (const id of ['sourceLabel','pageTitle','mediaSelect','refresh','downloadSection','subtitleSection','videoTab','audioTab','subtitleTab','videoSettings','audioSettings','videoFormat','audioFormat','height','audioQuality','download','language','subtitleFormat','loadSubtitle','subtitleContent','preview','copy','saveSubtitle','job','notice','diagnosticRow','diagnosticText','dismissError']) this.nodes.set(id, new Element(id.includes('Select') || ['mediaSelect','videoFormat','audioFormat','height','audioQuality','language','subtitleFormat'].includes(id) ? 'select' : 'div')); }
  getElementById(id) { return this.nodes.get(id); }
  createElement(tag) { return new Element(tag); }
}

const documentMock = new DocumentMock();
globalThis.document = documentMock;
globalThis.Option = class Option { constructor(text, value = '') { this.textContent = text; this.value = value; this.disabled = false; this.title = ''; } };
Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{clipboard:{writeText:async()=>{}}}});
globalThis.indexedDB = {open() { const request = {}; setTimeout(() => { request.result = {createObjectStore(){}, transaction(){ return {objectStore(){return {put(){},delete(){}}}, commit(){}}; }}; request.onsuccess?.(); }, 0); return request; }};

const state = {phase:0, snapshotCalls:0, inspectCalls:0};
const jobs = [{id:'job-1', state:'running', title:'existing download', progress:42, createdAt:Date.now()}];
const pageFor = () => {
  if (state.phase === 0) return {url:'https://example.test/empty',title:'Empty',videos:[],tracks:[]};
  if (state.phase === 1) return {url:'https://example.test/no-source',title:'No source',videos:[{title:'only video element'}],tracks:[]};
  if (state.phase === 2) return {url:'https://example.test/subtitle',title:'Subtitle only',videos:[{title:'captioned',downloadUrl:''}],tracks:[{language:'en',name:'English',source:'native'}]};
  return {url:'https://example.test/multi',title:'Multiple',mediaIndex:state.phase === 3 ? 0 : 1,videos:[{title:'first',downloadUrl:'https://cdn.test/first.mp4',url:'https://cdn.test/first.mp4'},{title:'second',downloadUrl:'https://cdn.test/second.mp4',url:'https://cdn.test/second.mp4'}],tracks:[]};
};
globalThis.chrome = {
  runtime:{connect:()=>({}),sendMessage:async message => {
    if (message.action === 'snapshot') { state.snapshotCalls++; return {ok:true,result:pageFor()}; }
    if (message.action === 'inspect') { state.inspectCalls++; if (state.phase < 3) return {ok:false,error:'inspect failed',failure:{code:'NETWORK_FAILURE'}}; return {ok:true,result:{title:'usable',downloadKey:'k',choices:{video:{auto:{enabled:true,heights:[360],extensions:{360:'mp4'},sizes:{360:{bytes:1}}}},audio:{original:{enabled:false}}},tracks:[]}}; }
    if (message.action === 'lastError') return {ok:true,result:null};
    return {ok:true,result:{}};
  }},
  storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async key => key === 'jobs' ? {jobs} : {},set:async()=>{}},onChanged:{addListener(){}}},
  i18n:{getUILanguage:()=> 'en'}, tabs:{query:async()=>[{id:7,url:'https://example.test'}]}, downloads:{download:async()=>1}
};

await import('../extension/destinations.js');
globalThis.VideoPocketDestinations = {ready:async()=>{}, putNow(){}, put:async()=>'', get:async()=>null, remove:async()=>{}, clear:async()=>{}};
await import('../extension/popup.js');
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error(`popup state did not settle: snapshots=${state.snapshotCalls}, inspects=${state.inspectCalls}, jobHidden=${documentMock.getElementById('job').hidden}, source=${documentMock.getElementById('sourceLabel').textContent}, detail=${documentMock.getElementById('sourceLabel').title}`); };

test('popup integration hides unusable media UI, preserves subtitle-only UI, and recovers after media switch', async () => {
  await wait(() => state.snapshotCalls >= 1 && !documentMock.getElementById('job').hidden);
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('job').children.length, 1);

  state.phase = 1; await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 2 && documentMock.getElementById('sourceLabel').textContent === '未取得影片資訊');
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('mediaSelect').hidden, true);

  state.phase = 2; await documentMock.getElementById('refresh').click();
  await wait(() => !documentMock.getElementById('downloadSection').hidden && !documentMock.getElementById('subtitleTab').disabled);
  assert.equal(documentMock.getElementById('subtitleSection').hidden, false);
  assert.equal(documentMock.getElementById('videoTab').disabled, true);
  assert.equal(documentMock.getElementById('job').children.length, 1);

  state.phase = 3; await documentMock.getElementById('refresh').click();
  await wait(() => !documentMock.getElementById('mediaSelect').hidden && !documentMock.getElementById('videoTab').disabled);
  assert.equal(documentMock.getElementById('downloadSection').hidden, false);
  assert.equal(documentMock.getElementById('job').children.length, 1);
  documentMock.getElementById('mediaSelect').value = '1'; state.phase = 4; await documentMock.getElementById('mediaSelect').dispatch('change');
  await wait(() => state.snapshotCalls >= 5 && !documentMock.getElementById('downloadSection').hidden);
  assert.equal(documentMock.getElementById('job').children.length, 1);
});
