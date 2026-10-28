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
  constructor() { this.nodes = new Map(); for (const id of ['sourceLabel','pageTitle','mediaSelect','pickMedia','refresh','downloadSection','subtitleSection','subtitleSettings','videoTab','audioTab','subtitleTab','videoSettings','audioSettings','videoFormat','videoFormatValue','audioFormat','audioFormatValue','height','heightValue','audioQuality','audioQualityValue','download','language','subtitleFormat','subtitleFormatValue','loadSubtitle','subtitleContent','preview','copy','saveSubtitle','job','notice','diagnosticRow','diagnosticText','dismissError','rangeSettings','rangeWarning','rangeSliders','rangeStart','rangeEnd','rangeStartSlider','rangeEndSlider']) this.nodes.set(id, new Element(id.includes('Select') || ['mediaSelect','videoFormat','audioFormat','height','audioQuality','language','subtitleFormat'].includes(id) ? 'select' : 'div'));for(const [id,value] of [['videoFormat','auto'],['audioFormat','original'],['subtitleFormat','txt']]){this.nodes.get(id).add({value,textContent:value,disabled:false});this.nodes.get(id).value=value;}this.nodes.get('job').hidden=true;this.nodes.get('downloadSection').hidden=true; }
  getElementById(id) { return this.nodes.get(id); }
  createElement(tag) { return new Element(tag); }
}

const documentMock = new DocumentMock();
globalThis.document = documentMock;
globalThis.Option = class Option { constructor(text, value = '') { this.textContent = text; this.value = value; this.disabled = false; this.title = ''; } };
Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{clipboard:{writeText:async text=>{state.clipboard=text;}}}});
globalThis.indexedDB = {open() { const request = {}; setTimeout(() => { request.result = {createObjectStore(){}, transaction(){ return {objectStore(){return {put(){},delete(){}}}, commit(){}}; }}; request.onsuccess?.(); }, 0); return request; }};

const state = {phase:0, snapshotCalls:0, inspectCalls:0, inspectFailure:'NETWORK_FAILURE',inspectEmpty:false,fastTimeout:false,snapshotHandler:null,inspectHandler:null,cacheHandler:null,cancelled:[]};let disconnectPopup,storageChanged;
const nativeGlobalAddEventListener=globalThis.addEventListener,globalEventHandlers=new Map();
globalThis.addEventListener=(name,listener,options={})=>{const list=globalEventHandlers.get(name)||[];list.push({listener,once:options?.once===true});globalEventHandlers.set(name,list);};
const dispatchGlobalEvent=name=>{const list=globalEventHandlers.get(name)||[];for(const item of [...list]){item.listener({type:name});if(item.once){const current=globalEventHandlers.get(name)||[];globalEventHandlers.set(name,current.filter(entry=>entry!==item));}}};
const nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout,presenceTimers=new Map();let nextPresenceTimer=0;
globalThis.setTimeout=(fn,ms,...args)=>{if(ms===1200){const handle=`presence-${++nextPresenceTimer}`;presenceTimers.set(handle,()=>fn(...args));return handle;}const handle=nativeTimeout(fn,state.fastTimeout&&ms===30000?25:ms,...args);if(ms===60000)handle.unref();return handle;};
globalThis.clearTimeout=handle=>{if(presenceTimers.delete(handle))return;nativeClearTimeout(handle);};
const firePresenceTimer=()=>{const entry=presenceTimers.entries().next().value;assert.ok(entry,'expected a scheduled presence check');presenceTimers.delete(entry[0]);entry[1]();};
test.after(()=>{disconnectPopup?.();globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClearTimeout;if(nativeGlobalAddEventListener===undefined)delete globalThis.addEventListener;else globalThis.addEventListener=nativeGlobalAddEventListener;});
const readyInfo={title:'usable',downloadKey:'k',choices:{video:{auto:{enabled:true,heights:[360],extensions:{360:'mp4'},sizes:{360:{bytes:1}}}},audio:{original:{enabled:false}}},tracks:[]};
const jobs = [{id:'job-1', state:'running', title:'existing download', progress:42, createdAt:Date.now()}];
const pageFor = () => {
  if (state.phase === 0) return {url:'https://example.test/empty',title:'Empty',videos:[],tracks:[]};
  if (state.phase === 1) return {url:'https://example.test/no-source',title:'No source',platform:{site:'embedded'},videos:[{title:'only video element'}],tracks:[],media:{discoveryReason:'no-associated-source',discoveryDiagnostics:{json:{observed:3},models:2,matches:0,reason:'identity-unmatched'}}};
  if (state.phase === 2) return {url:'https://example.test/subtitle',title:'Subtitle only',videos:[{title:'captioned',downloadUrl:''}],tracks:[{language:'en',name:'English',source:'native'}]};
  return {url:'https://example.test/multi',title:'Multiple',mediaIndex:state.phase === 3 ? 0 : 1,videos:[{title:'first',documentId:'doc-first',mediaKey:1,downloadUrl:'https://cdn.test/first.mp4',url:'https://cdn.test/first.mp4'},{title:'second',documentId:'doc-second',mediaKey:2,downloadUrl:'https://cdn.test/second.mp4',url:'https://cdn.test/second.mp4'}],tracks:[]};
};
globalThis.chrome = {
  runtime:{connect:()=>({postMessage:message=>{if(message.action==='highlightMedia'){state.lastHighlight=message;(state.highlightMessages ||= []).push(message);}},onDisconnect:{addListener:fn=>{disconnectPopup=fn;}}}),sendMessage:async message => {
    if (message.action === 'snapshot') { state.snapshotCalls++;state.lastSnapshot=message; return {ok:true,result:state.snapshotHandler?await state.snapshotHandler(message):pageFor()}; }
    if(message.action==='mediaPresence'){state.mediaPresenceCalls=(state.mediaPresenceCalls||0)+1;state.lastPresence=message;return state.presenceHandler?state.presenceHandler(message):{ok:true,result:{checked:true,missing:[]}};}
    if (message.action === 'genericInspect'){state.genericInspectCalls=(state.genericInspectCalls || 0)+1;state.lastGenericInspect=message;return state.genericInspectHandler?state.genericInspectHandler(message):{ok:false,error:'no source',failure:{code:'SOURCE_UNAVAILABLE'}};}
    if (message.action === 'cancelInspect'){state.cancelled.push(message.inspectionId);return {ok:true,result:{}};}
    if (message.action === 'waitMediaSource'){state.lastReadiness=message;return {ok:true,result:state.readinessHandler?await state.readinessHandler(message):{ready:false}};}
    if (message.action === 'inspect'&&state.inspectHandler){state.inspectCalls++;return state.inspectHandler(message);}
    if (message.action === 'inspect') { state.inspectCalls++; if(state.inspectEmpty)return {ok:true,result:{title:'player detected',downloadKey:'k',choices:{video:{auto:{enabled:false,heights:[],extensions:{},sizes:{}}},audio:{original:{enabled:false,qualities:[],extensions:{},sizes:{}}}},tracks:[]}}; if (state.phase < 3) return {ok:false,error:'inspect failed',failure:state.inspectFailure==='HTTP_AUTH'?{code:'HTTP_AUTH',httpStatus:403,requestMethod:'GET RANGE',requestHost:'v16m.tiktokcdn.com'}:{code:state.inspectFailure}}; return {ok:true,result:{title:'usable',downloadKey:'k',choices:{video:{auto:{enabled:true,heights:[360],extensions:{360:'mp4'},sizes:{360:{bytes:1}}}},audio:{original:{enabled:false}}},tracks:[]}}; }
    if(message.action==='captureSubtitle'&&state.captureHandler)return state.captureHandler(message);
    if(message.action==='mediaTime'){state.lastMediaTime=message;return {ok:true,result:{time:message.time??12.5,duration:60}};}
    if(message.action==='download'){state.lastDownload=message;return {ok:true,result:{id:'range-job'}};}
    if(message.action==='dismissJob'){state.dismissedJob=message.id;const index=jobs.findIndex(job=>job.id===message.id);if(index>=0)jobs.splice(index,1);return {ok:true,result:{}};}
    if(message.action==='highlightMedia')state.lastHighlight=message;
    if (message.action === 'lastError') return {ok:true,result:state.lastError||null};
    if(message.action==='dismissError'){state.dismissedError=message.id;state.lastError=null;return {ok:true,result:{}};}
    return {ok:true,result:{}};
  }},
  storage:{local:{get:async()=>({}),set:async value=>{if(value.downloadPreferences)state.savedPreferences={...value.downloadPreferences};}},session:{get:async key => key === 'jobs' ? {jobs} : key===null&&state.cacheHandler?state.cacheHandler():{},set:async value=>{if(value['rangeDraft:7'])state.savedRangeDraft=value['rangeDraft:7'];}},onChanged:{addListener(fn){storageChanged=fn;}}},
  i18n:{getUILanguage:()=> 'en'}, tabs:{query:async()=>[{id:7,url:'https://example.test'}]}, downloads:{download:async()=>1}
};

await import('../extension/destinations.js');
globalThis.VideoPocketDestinations = {ready:async()=>{}, putNow(){}, put:async()=>'', get:async()=>null, remove:async()=>{}, clear:async()=>{}};
await import('../extension/popup.js');
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error(`popup state did not settle: snapshots=${state.snapshotCalls}, inspects=${state.inspectCalls}, jobHidden=${documentMock.getElementById('job').hidden}, source=${documentMock.getElementById('sourceLabel').textContent}, detail=${documentMock.getElementById('sourceLabel').title}`); };
const waitForSourceFailure = label => wait(()=>!documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent===label);

test('popup integration hides unusable media UI, preserves subtitle-only UI, and recovers after media switch', async () => {
  await wait(() => state.snapshotCalls >= 1 && documentMock.getElementById('job').children.length===1);
  assert.equal(documentMock.getElementById('sourceLabel').textContent,'Could not get video information');assert.equal(documentMock.getElementById('sourceLabel').hidden,false);assert.equal(documentMock.getElementById('sourceLabel').classList.contains('error'),true);
  assert.equal(documentMock.getElementById('pageTitle').hidden,true);assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('job').children.length, 1);

  state.phase = 1; await documentMock.getElementById('refresh').click();
  assert.equal(state.lastSnapshot.preferPicked,false,'explicit refresh clears the previous picker choice instead of preserving stale selection');
  await wait(() => state.snapshotCalls >= 2 && !documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Could not read source');
  assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);assert.equal(documentMock.getElementById('pageTitle').textContent,'only video element');
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('mediaSelect').hidden, true);
  assert.equal(documentMock.getElementById('notice').hidden,true);assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);

  state.inspectFailure='SOURCE_UNAVAILABLE';await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 3 && !documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Video found, but no downloadable source');
  assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);assert.equal(documentMock.getElementById('pageTitle').hidden,false);
  assert.equal(documentMock.getElementById('sourceLabel').title,'');
  assert.equal(documentMock.getElementById('sourceLabel').tabIndex,-1);
  assert.equal(documentMock.getElementById('sourceLabel').role,'status');

  state.inspectEmpty=true;await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 4 && !documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Video found, but no downloadable source');
  assert.equal(documentMock.getElementById('downloadSection').hidden,true);
  assert.equal(documentMock.getElementById('sourceLabel').title,'');
  state.inspectEmpty=false;state.inspectFailure='HTTP_AUTH';await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 5 && !documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Access denied. Refresh the page and retry.');
  assert.equal(documentMock.getElementById('sourceLabel').title,'');
  assert.doesNotMatch(documentMock.getElementById('sourceLabel').title,/No URL or stream manifest/);

  state.phase = 2;state.inspectFailure='NETWORK_FAILURE'; await documentMock.getElementById('refresh').click();
  await wait(() => !documentMock.getElementById('downloadSection').hidden && !documentMock.getElementById('subtitleTab').disabled);
  assert.equal(documentMock.getElementById('subtitleSection').hidden, false);
  assert.equal(documentMock.getElementById('videoTab').disabled, true);
  assert.equal(documentMock.getElementById('job').children.length, 1);

  state.phase = 3; await documentMock.getElementById('refresh').click();
  await wait(() => !documentMock.getElementById('mediaSelect').hidden && !documentMock.getElementById('videoTab').disabled);
  assert.equal(documentMock.getElementById('downloadSection').hidden, false);
  assert.equal(documentMock.getElementById('job').children.length, 1);
  documentMock.getElementById('mediaSelect').value = '1'; state.phase = 4; await documentMock.getElementById('mediaSelect').dispatch('change');
  await wait(() => state.snapshotCalls >= 8 && !documentMock.getElementById('downloadSection').hidden);
  assert.equal(documentMock.getElementById('job').children.length, 1);
  assert.equal(state.lastHighlight.documentId,'doc-second');assert.equal(state.lastHighlight.mediaKey,2);
  assert.equal(state.highlightMessages?.filter(message=>message.scrollIntoView===true).at(-1)?.mediaKey,2,'a dropdown change scrolls once before rescanning');
  await documentMock.getElementById('refresh').click();await wait(()=>state.lastHighlight?.mediaKey===2&&state.lastHighlight.scrollIntoView===false);
});

test('pending media validation always shows parsing, and success reveals a working download button',async()=>{
 let release;state.phase=3;state.inspectHandler=()=>new Promise(resolve=>{release=resolve;});
 await documentMock.getElementById('refresh').click();await wait(()=>!!release);
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'Checking video source…');
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);
 release({ok:true,result:readyInfo});
 await wait(()=>!documentMock.getElementById('downloadSection').hidden&&!documentMock.getElementById('download').disabled);
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');
 assert.equal(documentMock.getElementById('sourceLabel').hidden,true);
 assert.equal(documentMock.getElementById('subtitleSettings').hidden,true);
 assert.equal(documentMock.getElementById('videoFormat').hidden,true);
 assert.equal(documentMock.getElementById('videoFormatValue').hidden,false);
 assert.equal(documentMock.getElementById('height').hidden,true);
 assert.equal(documentMock.getElementById('heightValue').textContent,'360p');state.inspectHandler=null;
});

test('an incomplete success payload renders an explicit failure that job updates cannot clear',async()=>{
 state.inspectHandler=async()=>({ok:true,result:{title:'detected element'}});
 await documentMock.getElementById('refresh').click();
 await waitForSourceFailure('Video found, but no downloadable source');
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);
 assert.equal(documentMock.getElementById('sourceLabel').classList.contains('error'),false);
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);
 storageChanged({jobs:{newValue:jobs}},'session');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);assert.equal(documentMock.getElementById('diagnosticText').textContent,'Video found, but no downloadable source');state.inspectHandler=null;
});

test('a stalled subtitle-cache read cannot block source validation or the download interface',async()=>{
 let releaseCache;state.cacheHandler=()=>new Promise(resolve=>{releaseCache=resolve;});state.inspectHandler=async()=>({ok:true,result:readyInfo});
 await documentMock.getElementById('refresh').click();
 await wait(()=>!!releaseCache&&!documentMock.getElementById('downloadSection').hidden);
 assert.equal(documentMock.getElementById('download').disabled,false);
 releaseCache({});state.cacheHandler=null;state.inspectHandler=null;
});

test('a stalled inspection fails by its deadline and a late success cannot remove the error',async()=>{
 let release,id;state.fastTimeout=true;state.inspectHandler=message=>{id=message.inspectionId;return new Promise(resolve=>{release=resolve;});};
 await documentMock.getElementById('refresh').click();
 await waitForSourceFailure('Source request timed out');state.fastTimeout=false;
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);assert.ok(state.cancelled.includes(id));
 release({ok:true,result:readyInfo});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);assert.equal(documentMock.getElementById('diagnosticText').textContent,'Source request timed out');assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);state.inspectHandler=null;
});

test('a late snapshot from a prior refresh cannot replace the current video or start its inspection',async()=>{
 let releaseOld,calls=0;const inspected=[];
 const snapshot=title=>({url:'https://social.example/feed',title,videos:[{title,mediaKey:title,downloadUrl:`https://cdn.example/${title}.mp4`}],tracks:[]});
 state.snapshotHandler=()=>++calls===1?new Promise(resolve=>{releaseOld=resolve;}):snapshot('current');
 state.inspectHandler=async message=>{inspected.push(message.descriptor.title);return {ok:true,result:readyInfo};};
 void documentMock.getElementById('refresh').dispatch('click');await wait(()=>!!releaseOld);
 void documentMock.getElementById('refresh').dispatch('click');await wait(()=>inspected.includes('current')&&!documentMock.getElementById('downloadSection').hidden);
 releaseOld(snapshot('obsolete'));await new Promise(resolve=>setImmediate(resolve));
 storageChanged({jobs:{newValue:jobs}},'session');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(documentMock.getElementById('pageTitle').textContent,'current');assert.deepEqual(inspected,['current']);
 state.snapshotHandler=null;state.inspectHandler=null;
});

test('popup preserves full titles for CSS and measured menu labels without changing download descriptors',async()=>{
 const long='這是一個很長的影片名稱與貼文敘述'.repeat(5),inspected=[];
 state.snapshotHandler=()=>({url:'https://www.tiktok.com/',title:'TikTok',mediaIndex:0,videos:[{title:long,mediaKey:1,downloadUrl:'https://cdn.example/one.mp4'},{title:'short',mediaKey:2}],tracks:[]});
 state.inspectHandler=async message=>{inspected.push(message.descriptor.title);return {ok:true,result:readyInfo};};
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>inspected.length&&!documentMock.getElementById('downloadSection').hidden);
  const option=documentMock.getElementById('mediaSelect').options[0];
  assert.equal(option.textContent,long);assert.equal(documentMock.getElementById('pageTitle').textContent,long);
  assert.equal(option.title,long);assert.equal(documentMock.getElementById('mediaSelect').title,long);
  assert.equal(inspected[0],long,'display truncation must not alter the media/download descriptor');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('a player permalink can be inspected without pretending it is a direct video source',async()=>{
 const linkedMedia={url:'https://www.facebook.com/reel/123/',id:'123'},descriptors=[];
 state.snapshotHandler=()=>({url:'https://www.facebook.com/feed',title:'Feed',videos:[{title:'post',mediaKey:1,linkedMedia}],tracks:[]});
 state.inspectHandler=async message=>{descriptors.push(message.descriptor);return {ok:true,result:readyInfo};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>descriptors.length&&!documentMock.getElementById('downloadSection').hidden);assert.deepEqual(descriptors[0].linkedMedia,linkedMedia);assert.equal(descriptors[0].url,undefined);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('an unavailable permalink keeps the short error without exposing diagnostic details',async()=>{
 state.snapshotHandler=()=>({url:'https://www.facebook.com/feed',title:'Feed',videos:[{title:'post',mediaKey:1,linkedMedia:{url:'https://www.facebook.com/reel/123/',id:'123'}}],tracks:[]});
 state.inspectHandler=async()=>({ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model'}});
 try{await documentMock.getElementById('refresh').click();await waitForSourceFailure('Video found, but no downloadable source');assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);assert.equal(documentMock.getElementById('pageTitle').textContent,'post');assert.equal(documentMock.getElementById('sourceLabel').title,'');assert.equal(documentMock.getElementById('downloadSection').hidden,true);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('early captions cannot replace a remembered video tab after delayed media inspection',async()=>{
 let finish;
 state.snapshotHandler=()=>({url:'https://www.youtube.com/watch?v=video',title:'Video',platform:{site:'youtube',id:'video'},videos:[{title:'Video',downloadUrl:'https://www.youtube.com/watch?v=video'}],tracks:[{language:'en',name:'English',source:'native'}]});
 state.inspectHandler=()=>new Promise(resolve=>{finish=resolve;});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!!finish);
  finish({ok:true,result:readyInfo});await wait(()=>!documentMock.getElementById('videoTab').disabled);
  await documentMock.getElementById('videoTab').click();
  assert.equal(state.savedPreferences.kind,'video');
  finish=null;await documentMock.getElementById('refresh').click();await wait(()=>!!finish);
  assert.equal(documentMock.getElementById('subtitleTab').disabled,false,'captions are available before video inspection finishes');
  finish({ok:true,result:readyInfo});await wait(()=>!documentMock.getElementById('videoTab').disabled);
  assert.equal(documentMock.getElementById('videoTab').classList.contains('active'),true);
  assert.equal(documentMock.getElementById('subtitleTab').classList.contains('active'),false);
  assert.equal(state.savedPreferences.kind,'video');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('an explicit subtitle choice stays selected after refresh and media inspection',async()=>{
 state.snapshotHandler=()=>({url:'https://www.youtube.com/watch?v=video',title:'Video',platform:{site:'youtube',id:'video'},videos:[{title:'Video',downloadUrl:'https://www.youtube.com/watch?v=video'}],tracks:[{language:'en',name:'English',source:'native'}]});
 state.inspectHandler=async()=>({ok:true,result:readyInfo});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('subtitleTab').disabled);
  await documentMock.getElementById('subtitleTab').click();assert.equal(state.savedPreferences.kind,'subtitle');
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('videoTab').disabled);
  assert.equal(documentMock.getElementById('subtitleTab').classList.contains('active'),true);
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('usable captions remain independently available when the video source is absent or refused',async()=>{
 const uiLanguage=chrome.i18n.getUILanguage;chrome.i18n.getUILanguage=()=> 'zh-TW';
 state.snapshotHandler=()=>({url:'https://player.example.test/watch',title:'Lecture',platform:{site:'embedded'},videos:[{title:'Lecture',mediaKey:123}],tracks:[{language:'zh',name:'中文',source:'native'}]});
 try{
  for(const [code,label] of [['SOURCE_UNAVAILABLE','Video found, but no downloadable source'],['HTTP_AUTH','Access denied. Refresh the page and retry.'],['HTTP_NOT_FOUND','Source unavailable. Refresh the page and retry.']]){
   state.inspectHandler=async()=>({ok:false,error:'media failed',failure:{code,...(code==='HTTP_AUTH'?{httpStatus:403}:{})}});
   await documentMock.getElementById('refresh').click();await waitForSourceFailure(label);
   assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);
   assert.equal(documentMock.getElementById('videoTab').disabled,true);
   assert.equal(documentMock.getElementById('subtitleTab').disabled,false);
   assert.equal(documentMock.getElementById('language').options[0].textContent,'Chinese','caption language labels stay English even when the browser UI locale is Chinese');
   await documentMock.getElementById('subtitleTab').click();
   assert.equal(documentMock.getElementById('subtitleSection').hidden,false);
   assert.equal(documentMock.getElementById('loadSubtitle').disabled,false);
  }
 }finally{state.snapshotHandler=null;state.inspectHandler=null;chrome.i18n.getUILanguage=uiLanguage;}
});

test('a delayed feed player is rescanned by identity before permalink fallback is attempted',async()=>{
 let release,scans=0;const inspected=[];
 const target={title:'PRIVATE',documentId:'fb-doc',frameId:0,mediaKey:2,mediaIdentity:'post-2',linkedMedia:{url:'https://www.facebook.com/reel/222/',id:'222'}};
 state.snapshotHandler=message=>{scans++;if(scans>1)assert.equal(message.expectedTarget.mediaKey,2);return {url:'https://www.facebook.com/feed',title:'Feed',documentId:'fb-doc',mediaIndex:0,platform:scans>1?{site:'embedded',id:'222'}:undefined,videos:[target],tracks:[]};};
 state.readinessHandler=()=>new Promise(resolve=>{release=resolve;});state.inspectHandler=async message=>{inspected.push(message.descriptor);return {ok:true,result:readyInfo};};
 try{
  void documentMock.getElementById('refresh').click();await wait(()=>!!release);assert.equal(inspected.length,0);
  release({ready:true});await wait(()=>inspected.length&&!documentMock.getElementById('downloadSection').hidden);
  assert.equal(scans,2);assert.equal(inspected[0].platform.id,'222');
 }finally{state.snapshotHandler=null;state.readinessHandler=null;state.inspectHandler=null;}
});

test('error labels do not expose or copy diagnostics',async()=>{
 state.snapshotHandler=()=>({url:'https://www.facebook.com/feed',title:'PRIVATE',videos:[{title:'PRIVATE',linkedMedia:{url:'https://www.facebook.com/reel/123/',id:'123'}}],media:{discoveryDiagnostics:{models:2,matches:0}},tracks:[]});
 state.inspectHandler=async()=>({ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model'}});
 try{state.clipboard='keep existing clipboard';await documentMock.getElementById('refresh').click();await waitForSourceFailure('Video found, but no downloadable source');const text=documentMock.getElementById('diagnosticText');assert.equal(text.textContent,'Video found, but no downloadable source');assert.doesNotMatch(text.textContent,/linked-no-model|PRIVATE|Diagnostics/i);await text.click();assert.equal(state.clipboard,'keep existing clipboard');assert.equal(text.title,'');assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);assert.equal(documentMock.getElementById('sourceLabel').tabIndex,-1);assert.equal((documentMock.getElementById('sourceLabel').listeners.keydown||[]).length,0);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('switching a virtual feed clears old controls and inspects only the post-scroll snapshot',async()=>{
 let releaseWait,scans=0;const inspected=[];
 const first={title:'A',documentId:'feed-doc',frameId:0,mediaKey:1,mediaContentId:'A',downloadUrl:'https://cdn.example/a.mp4'},second={title:'B',documentId:'feed-doc',frameId:0,mediaKey:2,mediaContentId:'B',downloadUrl:'https://cdn.example/b.mp4'};
 state.snapshotHandler=()=>{scans++;const selected=scans===1?0:1;return {url:'https://www.tiktok.com/feed',title:'Feed',documentId:'feed-doc',mediaIndex:selected,videos:[first,{...second,title:scans===2?'stale B':'actual B'}],platform:{site:'embedded',id:scans===2?'old-A':selected?'B':'A'},tracks:scans===1?[{language:'en',name:'English',source:'native'}]:[]};};
 state.inspectHandler=async message=>{inspected.push(message.descriptor);return {ok:true,result:readyInfo};};
 state.readinessHandler=()=>new Promise(resolve=>{releaseWait=resolve;});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('videoTab').disabled);
  documentMock.getElementById('mediaSelect').value='1';await documentMock.getElementById('mediaSelect').dispatch('change');await wait(()=>!!releaseWait);
  assert.equal(documentMock.getElementById('downloadSection').hidden,true);assert.equal(documentMock.getElementById('preview').value,'');assert.equal(inspected.length,1);
  releaseWait({ready:true});await wait(()=>inspected.length===2&&!documentMock.getElementById('downloadSection').hidden);
  assert.equal(inspected[1].platform.id,'B');assert.equal(inspected[1].title,'actual B');assert.equal(documentMock.getElementById('subtitleTab').disabled,true);
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('named options move above placeholders while switching retains the original player target',async()=>{
 const videos=[{title:'影片 1',documentId:'doc',mediaKey:1},{title:'Named lesson',documentId:'doc',mediaKey:2},{title:'影片 3',documentId:'doc',mediaKey:3}];
 state.snapshotHandler=message=>({url:'https://player.test/watch',documentId:'doc',mediaIndex:message.expectedTarget?2:0,platform:{site:'embedded'},videos,tracks:[]});
 state.inspectHandler=async()=>({ok:true,result:readyInfo});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  const select=documentMock.getElementById('mediaSelect');
  assert.deepEqual(select.options.map(option=>option.value),['1','0','2']);assert.equal(select.value,'0');
  select.value='2';await select.dispatch('change');await wait(()=>state.lastReadiness?.mediaKey===3&&!documentMock.getElementById('download').disabled);
  assert.equal(state.lastSnapshot.expectedTarget.mediaKey,3);assert.equal(select.value,'2');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('a source-less selected player can request owned-player recovery on unknown and known pages without new UI',async()=>{
 state.phase=3;const before=state.inspectCalls;
 state.snapshotHandler=()=>({url:'https://unknown.test/watch',title:'Page',documentId:'generic-doc',frameId:0,mediaIndex:0,videos:[{title:'影片 1',mediaKey:7,documentId:'generic-doc',frameId:0}],media:{mediaKey:7,duration:60},tracks:[]});
 state.genericInspectHandler=async()=>({ok:true,result:readyInfo});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  assert.equal(state.lastGenericInspect.descriptor.mediaKey,7);assert.equal(state.lastGenericInspect.descriptor.title,'影片 1');
  assert.equal(state.lastGenericInspect.descriptor.documentId,'generic-doc');assert.equal(state.inspectCalls,before);
  const genericCalls=state.genericInspectCalls;
  state.snapshotHandler=()=>({url:'https://x.com/a/status/1',title:'X',documentId:'x-doc',frameId:0,videos:[{title:'影片 1',mediaKey:7,documentId:'x-doc',frameId:0}],media:{mediaKey:7,duration:60},tracks:[]});
  await documentMock.getElementById('refresh').click();await wait(()=>state.genericInspectCalls===genericCalls+1&&!documentMock.getElementById('download').disabled);
  assert.equal(state.lastGenericInspect.descriptor.referer,'https://x.com/a/status/1');assert.equal(state.lastGenericInspect.descriptor.documentId,'x-doc');
 }finally{state.snapshotHandler=null;state.genericInspectHandler=null;}
});

test('a transient Dailymotion refusal performs only one delayed snapshot retry',async()=>{
 let calls=0;const selected={title:'Episode',documentId:'dm-doc',frameId:0,mediaKey:1,mediaContentId:'episode',dailymotionMain:true};
 state.snapshotHandler=()=>({url:'https://www.dailymotion.com/video/episode',title:'Episode',documentId:'dm-doc',videos:[selected],platform:{site:'dailymotion',id:'episode'},tracks:[]});
 state.readinessHandler=async()=>({ready:true});state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403,sourceStage:'stream-manifest',requestMethod:'GET',requestHost:'vod.dmcdn.net'}};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>calls===2&&!documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Access denied. Refresh the page and retry.');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);state.clipboard='keep existing clipboard';await documentMock.getElementById('diagnosticText').click();assert.equal(state.clipboard,'keep existing clipboard');assert.equal(documentMock.getElementById('diagnosticText').title,'');assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});


test('popup single timeline follows both endpoints and sends only the selected interval',async()=>{
 state.phase=3;state.inspectHandler=async()=>({ok:true,result:{...readyInfo,id:'r',browserSourceId:'r',downloadKey:'new-range-key',duration:60,range:{duration:60,supported:true,plans:{video:{0:true,360:true},audio:{best:false}}}}});
 try{
  assert.equal(documentMock.getElementById('rangeDuration'),undefined,'the timeline keeps only start and end fields');
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('rangeStart').disabled);
  const details=documentMock.getElementById('rangeSettings');details.open=true;await details.dispatch('toggle');
  const start=documentMock.getElementById('rangeStart'),end=documentMock.getElementById('rangeEnd');
  assert.equal(end.value,'00:01:00.0');
  start.value='00:00:10.2';await start.dispatch('change');end.value='00:00:20';await end.dispatch('change');
  const slider=documentMock.getElementById('rangeStartSlider');slider.value='12.5';await slider.dispatch('input');
  assert.equal(start.value,'00:00:12.5');assert.equal(end.value,'00:00:20.0');
  assert.match(documentMock.getElementById('download').textContent,/Download clip/);
  await documentMock.getElementById('download').click();assert.deepEqual(state.lastDownload.range,{start:12.5,end:20});
  assert.deepEqual(state.savedRangeDraft.range,{start:12.5,end:20});
  await documentMock.getElementById('refresh').click();await wait(()=>details.open===true&&!start.disabled);
  assert.equal(start.value,'00:00:12.5');assert.equal(end.value,'00:00:20.0');
  details.open=false;await details.dispatch('toggle');await documentMock.getElementById('download').click();assert.equal(state.lastDownload.range,undefined);
  state.snapshotHandler=()=>({url:'https://example.test/new',documentId:'new-doc',videos:[{title:'new',documentId:'new-doc',mediaKey:1,url:'https://cdn.test/new.mp4',downloadUrl:'https://cdn.test/new.mp4'}],tracks:[]});
  await documentMock.getElementById('refresh').click();await wait(()=>documentMock.getElementById('pageTitle').textContent==='new');
  assert.equal(details.open,false);assert.equal(start.value,'00:00:00.0');
 }finally{state.inspectHandler=null;state.snapshotHandler=null;}
});

test('advanced interval remains visible when a remembered subtitle mode falls back to video',async()=>{
 const target={title:'video',documentId:'disclosure-doc',mediaKey:1,url:'https://cdn.test/video.mp4',downloadUrl:'https://cdn.test/video.mp4'};
 const snapshot=tracks=>({url:'https://example.test/watch',title:'video',documentId:'disclosure-doc',videos:[target],tracks});
 const rangeInfo={...readyInfo,duration:60,range:{duration:60,supported:true,plans:{video:{0:true,360:true},audio:{best:false}}},choices:{...readyInfo.choices,audio:{original:{enabled:true,qualities:['best'],extensions:{best:'m4a'},sizes:{}}}}};
 state.snapshotHandler=()=>snapshot([{language:'en',name:'English',source:'native'}]);state.inspectHandler=async()=>({ok:true,result:rangeInfo});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('subtitleTab').disabled);
  await documentMock.getElementById('subtitleTab').click();assert.equal(documentMock.getElementById('rangeSettings').hidden,true);
  state.snapshotHandler=()=>snapshot([]);await documentMock.getElementById('refresh').click();await wait(()=>documentMock.getElementById('videoTab').classList.contains('active')&&!documentMock.getElementById('download').disabled);
  assert.equal(documentMock.getElementById('download').hidden,false);
  assert.equal(documentMock.getElementById('rangeSettings').hidden,false,'actual video mode must show its disclosure regardless of remembered subtitle preference');
  await documentMock.getElementById('audioTab').click();assert.equal(documentMock.getElementById('rangeSettings').hidden,true,'unsupported selected audio hides interval settings');assert.equal(documentMock.getElementById('rangeStart').disabled,true,'unsupported selected audio disables interval editing');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;await documentMock.getElementById('videoTab').click();}
});

test('a duration without range capability hides advanced interval settings',async()=>{
 const infoWithoutRange={...readyInfo,duration:60};state.phase=3;state.inspectHandler=async()=>({ok:true,result:infoWithoutRange});
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('rangeSettings').hidden,true);}
 finally{state.inspectHandler=null;}
});

test('multiple actual heights keep the quality dropdown interactive',async()=>{
 const choices={...readyInfo.choices,video:{auto:{enabled:true,heights:[360,720],extensions:{360:'mp4',720:'mp4'},sizes:{360:{bytes:1},720:{bytes:1}}}}};state.inspectHandler=async()=>({ok:true,result:{...readyInfo,choices}});
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('height').hidden,false);assert.equal(documentMock.getElementById('heightValue').hidden,true);const height=documentMock.getElementById('height');assert.equal(height.options.find(option=>option.value==='0').textContent,'Best (720p)');height.value='720';await height.dispatch('change');assert.equal(documentMock.getElementById('videoFormatValue').textContent,'MP4');}
 finally{const height=documentMock.getElementById('height');height.value='0';await height.dispatch('change');state.inspectHandler=null;}
});

test('Bilibili logical range draft survives a main player DOM replacement',async()=>{
 let generation=0;const rangeInfo={...readyInfo,duration:60,range:{duration:60,supported:true,plans:{video:{0:true,360:true},audio:{best:false}}}};
 state.snapshotHandler=()=>({url:'https://www.bilibili.com/video/BVdraft01/?p=2',title:'Bili',documentId:'bili-doc',videos:[{title:'Bili',documentId:'bili-doc',mediaKey:generation?22:11,bilibiliMain:true,mediaIdentity:'bilibili:BVdraft01:2',mediaContentId:'bilibili:BVdraft01:2',downloadUrl:'https://www.bilibili.com/video/BVdraft01/?p=2'}],tracks:[]});state.inspectHandler=async()=>({ok:true,result:rangeInfo});
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('rangeStart').disabled);const details=documentMock.getElementById('rangeSettings');details.open=true;await details.dispatch('toggle');const start=documentMock.getElementById('rangeStart'),end=documentMock.getElementById('rangeEnd');start.value='00:00:10.0';await start.dispatch('change');end.value='00:00:20.0';await end.dispatch('change');assert.deepEqual(state.savedRangeDraft.range,{start:10,end:20});generation=1;await documentMock.getElementById('refresh').click();await wait(()=>start.value==='00:00:10.0'&&end.value==='00:00:20.0');}
 finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('switching from unsupported to supported quality restores interval settings',async()=>{
 const rangeInfo={...readyInfo,duration:60,choices:{...readyInfo.choices,video:{auto:{enabled:true,heights:[360,720],extensions:{360:'mp4',720:'mp4'},sizes:{360:{bytes:1},720:{bytes:1}}}}},range:{duration:60,supported:true,plans:{video:{0:false,360:false,720:true},audio:{best:false}}}};state.inspectHandler=async()=>({ok:true,result:rangeInfo});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled&&documentMock.getElementById('rangeSettings').hidden===true);
  const height=documentMock.getElementById('height');height.value='720';await height.dispatch('change');
  assert.equal(documentMock.getElementById('rangeSettings').hidden,false);assert.equal(documentMock.getElementById('rangeStart').disabled,false);
  height.value='360';await height.dispatch('change');assert.equal(documentMock.getElementById('rangeSettings').hidden,true);assert.equal(documentMock.getElementById('rangeSettings').open,false);
 }finally{state.inspectHandler=null;}
});

test('processing jobs show their own percentage while keeping the same compact job row',async()=>{
 const saved={...jobs[0]};try{Object.assign(jobs[0],{state:'processing',progress:37});storageChanged({jobs:{newValue:jobs}},'session');await new Promise(resolve=>setImmediate(resolve));
 const row=documentMock.getElementById('job').children.find(r=>r.dataset.id===jobs[0].id);assert.ok(row);assert.equal(row.children.find(c=>c.className==='job-percent')?.textContent,'37%');assert.equal(row.children.find(c=>c.tagName==='PROGRESS')?.value,37);
 }finally{Object.assign(jobs[0],saved);storageChanged({jobs:{newValue:jobs}},'session');await new Promise(resolve=>setImmediate(resolve));}
});

test('a download failure remains visible and dismissible without diagnostic copying',async()=>{
 state.phase=3;state.lastError={id:'failed-job',time:Date.now()-15000,code:'HTTP_AUTH',stage:'download',httpStatus:403,requestMethod:'GET RANGE',requestHost:'cdn.example'};
 try{
  storageChanged({lastError:{newValue:state.lastError}},'session');await wait(()=>!documentMock.getElementById('diagnosticRow').hidden);
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);
  state.clipboard='keep existing clipboard';await documentMock.getElementById('diagnosticText').click();assert.equal(state.clipboard,'keep existing clipboard');assert.equal(documentMock.getElementById('diagnosticText').title,'');assert.doesNotMatch(documentMock.getElementById('diagnosticText').textContent,/Diagnostics|copy/i);assert.match(documentMock.getElementById('diagnosticText').textContent,/Access denied\. Refresh the page and retry/);
  await documentMock.getElementById('dismissError').click();assert.equal(state.dismissedError,'failed-job');assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);
 }finally{state.lastError=null;await documentMock.getElementById('dismissError').click();}
});

test('source errors remain in the bottom row, can be dismissed, and clear after successful inspection',async()=>{
 let calls=0;state.phase=3;state.lastError=null;
 state.snapshotHandler=()=>({url:'https://example.test/source-error',title:'Lesson page',platform:{site:'embedded'},mediaIndex:1,videos:[{title:'Lesson one',documentId:'source-one',mediaKey:1},{title:'Lesson two',documentId:'source-two',mediaKey:2}],tracks:[]});
 state.inspectHandler=async()=>++calls<3?{ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}}:{ok:true,result:readyInfo};
 try{
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Access denied. Refresh the page and retry.');
  assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);
  assert.equal(documentMock.getElementById('pageTitle').hidden,true);assert.equal(documentMock.getElementById('mediaSelect').hidden,false);
  assert.deepEqual(documentMock.getElementById('mediaSelect').options.map(option=>option.textContent),['Lesson one','Lesson two']);
  assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);
  await documentMock.getElementById('dismissError').click();assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Access denied. Refresh the page and retry.');
  await documentMock.getElementById('refresh').click();await wait(()=>calls===3&&!documentMock.getElementById('download').disabled);
  assert.equal(documentMock.getElementById('diagnosticRow').hidden,true,'successful inspection clears the prior source error');
  assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.lastError=null;}
});

test('a download failure takes precedence over a source inspection error',async()=>{
 state.phase=3;state.lastError=null;
 state.snapshotHandler=()=>({url:'https://example.test/source-error-priority',title:'Lesson',platform:{site:'embedded'},videos:[{title:'Lesson',documentId:'priority-doc',mediaKey:1}],tracks:[]});
 state.inspectHandler=async()=>({ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}});
 try{
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Access denied. Refresh the page and retry.');
  state.lastError={id:'priority-download',time:Date.now(),code:'HTTP_AUTH',stage:'download',httpStatus:403};
  storageChanged({lastError:{newValue:state.lastError}},'session');
  await wait(()=>!documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent==='Access denied. Refresh the page and retry. (E01)');
  assert.equal(documentMock.getElementById('diagnosticText').textContent,'Access denied. Refresh the page and retry. (E01)');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.lastError=null;await documentMock.getElementById('dismissError').click();}
});

test('YT03 reports a genuinely empty response without a misleading manual-caption instruction',async()=>{
 state.phase=3;state.lastError={id:'yt-empty',time:Date.now(),code:'YT_FILE_EMPTY',stage:'subtitle'};
 try{
  storageChanged({lastError:{newValue:state.lastError}},'session');await wait(()=>!documentMock.getElementById('diagnosticRow').hidden);
  const text=documentMock.getElementById('diagnosticText');assert.match(text.textContent,/YouTube returned no subtitle data/);assert.match(text.textContent,/YT03/);assert.doesNotMatch(text.textContent,/Diagnostics|selected subtitle|Turn on/i);
  state.clipboard='keep existing clipboard';await text.click();assert.equal(state.clipboard,'keep existing clipboard');assert.equal(text.title,'');
 }finally{state.lastError=null;await documentMock.getElementById('dismissError').click();}
});

test('a lost page-dependent job stays as an error record with only a dismissal button',async()=>{
 const record={id:'lost-source',state:'error',title:'Removed clip',errorCode:'PAGE_MEDIA_GONE',message:'The original video was removed or changed. Download stopped.',requiresDismiss:true,resumable:false,finishedAt:1};
 jobs.push(record);
 try{
  storageChanged({jobs:{newValue:jobs}},'session');await wait(()=>documentMock.getElementById('job').children.some(row=>row.dataset.id===record.id));
  const row=documentMock.getElementById('job').children.find(row=>row.dataset.id===record.id),buttons=row.children.filter(child=>child.tagName==='BUTTON');
  assert.equal(row.className,'job-row error');assert.equal(buttons.length,1);assert.equal(buttons[0].textContent,'×');assert.equal(buttons[0].title,'Remove record');
  await buttons[0].click();assert.equal(state.dismissedJob,record.id);assert.equal(documentMock.getElementById('job').children.some(row=>row.dataset.id===record.id),false);
 }finally{const index=jobs.indexOf(record);if(index>=0)jobs.splice(index,1);}
});

test('subtitle restore warning is dismissible and a later successful capture clears it',async()=>{
 let captures=0;state.phase=3;state.lastError=null;
 state.snapshotHandler=()=>({url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Captions',documentId:'caption-warning-doc',mediaIndex:0,platform:{site:'youtube',id:'abcdefghijk'},videos:[{title:'Captions',documentId:'caption-warning-doc',mediaKey:44,downloadUrl:'https://cdn.test/captions.mp4'}],tracks:[{trackId:'youtube-en',language:'en',name:'English',source:'native',pageSource:'youtube-page',pageLanguage:'en',pageTrackId:'youtube:0',pageTrackIndex:0}]});
 state.inspectHandler=async()=>({ok:true,result:readyInfo});
 state.captureHandler=async()=>({ok:true,result:{trackId:'youtube-en',language:'en',cues:[{start:0,end:1,text:'captured text'}],...(++captures===1?{warningCode:'YT_RESTORE_UNCONFIRMED'}:{})}});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('subtitleTab').disabled);await documentMock.getElementById('subtitleTab').click();
  await documentMock.getElementById('loadSubtitle').click();await wait(()=>documentMock.getElementById('diagnosticText').textContent==='Captured; caption settings may not be restored.'&&!documentMock.getElementById('diagnosticRow').hidden);
  assert.equal(documentMock.getElementById('copy').disabled,false);assert.equal(documentMock.getElementById('saveSubtitle').disabled,false);
  await documentMock.getElementById('copy').click();assert.match(state.clipboard,/captured text/);
  await documentMock.getElementById('saveSubtitle').click();
  await documentMock.getElementById('dismissError').click();assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);
  await documentMock.getElementById('loadSubtitle').click();await wait(()=>captures===2&&!documentMock.getElementById('copy').disabled);
  assert.equal(documentMock.getElementById('diagnosticRow').hidden,true,'a later complete capture without a warning clears the prior message');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.captureHandler=null;state.lastError=null;}
});

test('disabling diagnostic copies preserves the normal subtitle copy action',async()=>{
 state.phase=3;state.snapshotHandler=()=>({url:'https://example.test/caption-copy',title:'Caption copy',documentId:'copy-doc',mediaIndex:0,videos:[{title:'Caption copy',documentId:'copy-doc',mediaKey:1,downloadUrl:'https://cdn.test/copy.mp4'}],tracks:[{language:'en',name:'English',source:'native'}]});
 state.captureHandler=async()=>({ok:true,result:{language:'en',cues:[{start:0,end:1,text:'字幕內容測試'}]}});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('subtitleTab').disabled);await documentMock.getElementById('subtitleTab').click();await documentMock.getElementById('loadSubtitle').click();await wait(()=>!documentMock.getElementById('copy').disabled);await documentMock.getElementById('copy').click();assert.match(state.clipboard,/字幕內容測試/);
 }finally{state.snapshotHandler=null;state.captureHandler=null;}
});

test('a caption restore warning is visible even when the independent video source is unavailable',async()=>{
 state.lastError=null;state.phase=3;
 state.snapshotHandler=()=>({url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Caption only',documentId:'warning-only',mediaIndex:0,videos:[{title:'Caption only',documentId:'warning-only',mediaKey:45}],tracks:[{trackId:'warning-only-en',language:'en',name:'English',source:'native',pageSource:'youtube-page',pageLanguage:'en',pageTrackId:'youtube:0',pageTrackIndex:0}]});
 state.inspectHandler=async()=>({ok:false,error:'unavailable',failure:{code:'SOURCE_UNAVAILABLE'}});
 state.captureHandler=async()=>({ok:true,result:{language:'en',cues:[{start:0,end:1,text:'kept captions'}],warningCode:'YT_RESTORE_UNCONFIRMED'}});
 try{
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Video found, but no downloadable source');
  await documentMock.getElementById('subtitleTab').click();await documentMock.getElementById('loadSubtitle').click();
  assert.equal(documentMock.getElementById('diagnosticText').textContent,'Captured; caption settings may not be restored.');assert.equal(documentMock.getElementById('copy').disabled,false);
  await documentMock.getElementById('dismissError').click();assert.equal(documentMock.getElementById('diagnosticText').textContent,'Video found, but no downloadable source');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.captureHandler=null;state.lastError=null;}
});

test('sub-second range duration remains visible on the download button without a middle duration field',async()=>{
 state.phase=3;state.inspectHandler=async()=>({ok:true,result:{...readyInfo,duration:60,range:{supported:true,duration:60,plans:{video:{0:true,360:true},audio:{}}}}});
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('rangeStart').disabled);const details=documentMock.getElementById('rangeSettings');details.open=true;await details.dispatch('toggle');const start=documentMock.getElementById('rangeStart'),end=documentMock.getElementById('rangeEnd');start.value='00:00:10';await start.dispatch('change');end.value='00:00:10.1';await end.dispatch('change');assert.match(documentMock.getElementById('download').textContent,/00:00\.1/);}finally{state.inspectHandler=null;}
});

test('TikTok delayed source retries one bounded wait and preserves the selected video',async()=>{
 let scans=0,inspects=0,waits=0;
 const selected={title:'TikTok clip',documentId:'tt-doc',frameId:0,mediaKey:7,mediaContentId:'clip-7'};
 const audioReady={...readyInfo,choices:{...readyInfo.choices,audio:{original:{enabled:true,qualities:['best'],extensions:{best:'m4a'},sizes:{best:{bytes:1}}}}}};
 state.snapshotHandler=message=>{scans++;if(scans>1)assert.equal(message.expectedTarget?.mediaKey,7);return {url:'https://www.tiktok.com/@creator/video/7',title:'TikTok',documentId:'tt-doc',mediaIndex:0,platform:{site:'embedded'},videos:[{...selected,downloadUrl:scans>1?'https://cdn.test/tt-7.mp4':''}],tracks:[],media:{discoveryDiagnostics:{metadataQueue:0}}};};
 state.inspectHandler=async()=>{inspects++;if(inspects===1)return {ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE'}};return {ok:true,result:audioReady};};
 state.readinessHandler=async()=>{waits++;return {ready:true,changed:false};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>inspects===2&&!documentMock.getElementById('audioTab').disabled);assert.equal(scans,2);assert.equal(waits,1);assert.equal(inspects,2);assert.equal(state.lastSnapshot.expectedTarget.mediaKey,7);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('TikTok readiness change rejects the selected source without retrying or looping',async()=>{
 let scans=0,inspects=0,waits=0;
 const selected={title:'TikTok clip',documentId:'tt-doc-change',frameId:0,mediaKey:9,mediaContentId:'clip-9'};
 state.snapshotHandler=()=>{scans++;return {url:'https://www.tiktok.com/@creator/video/9',title:'TikTok',documentId:'tt-doc-change',mediaIndex:0,platform:{site:'embedded'},videos:[selected],tracks:[],media:{discoveryDiagnostics:{metadataQueue:0}}};};
 state.inspectHandler=async()=>{inspects++;return {ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE'}};};
 state.readinessHandler=async()=>{waits++;return {ready:false,changed:true};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('diagnosticRow').hidden&&documentMock.getElementById('diagnosticText').textContent.includes('changed'));assert.equal(documentMock.getElementById('sourceLabel').textContent,'Video:');assert.equal(documentMock.getElementById('sourceLabel').hidden,true);assert.equal(scans,1);assert.equal(inspects,1);assert.equal(waits,1);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('TikTok source with pending metadata retries once when audio is initially absent',async()=>{
 let scans=0,inspects=0,waits=0;
 const selected={title:'TikTok audio',documentId:'tt-doc-audio',frameId:0,mediaKey:11,mediaContentId:'clip-11',downloadUrl:'https://cdn.test/tt-11.mp4'};
 const noAudio={...readyInfo,choices:{...readyInfo.choices,audio:{original:{enabled:false}}}};
 const audioReady={...readyInfo,choices:{...readyInfo.choices,audio:{original:{enabled:true,qualities:['best'],extensions:{best:'m4a'},sizes:{best:{bytes:1}}}}}};
 state.snapshotHandler=()=>{scans++;return {url:'https://www.tiktok.com/@creator/video/11',title:'TikTok',documentId:'tt-doc-audio',mediaIndex:0,platform:{site:'embedded'},videos:[selected],tracks:[],media:{discoveryDiagnostics:{metadataQueue:scans===1?2:0}}};};
 state.inspectHandler=async()=>{inspects++;return {ok:true,result:inspects===1?noAudio:audioReady};};
 state.readinessHandler=async()=>{waits++;return {ready:true,changed:false};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>inspects===2&&!documentMock.getElementById('audioTab').disabled);assert.equal(scans,2);assert.equal(waits,1);assert.equal(inspects,2);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('TikTok silent inspection without pending metadata does not trigger a retry',async()=>{
 let scans=0,inspects=0,waits=0;
 const selected={title:'TikTok silent',documentId:'tt-doc-silent',frameId:0,mediaKey:13,mediaContentId:'clip-13',downloadUrl:'https://cdn.test/tt-13.mp4'};
 state.snapshotHandler=()=>{scans++;return {url:'https://www.tiktok.com/@creator/video/13',title:'TikTok',documentId:'tt-doc-silent',mediaIndex:0,platform:{site:'embedded'},videos:[selected],tracks:[],media:{discoveryDiagnostics:{metadataQueue:0}}};};
 state.inspectHandler=async()=>{inspects++;return {ok:true,result:{...readyInfo,choices:{...readyInfo.choices,audio:{original:{enabled:false}}}}};};
 state.readinessHandler=async()=>{waits++;return {ready:true,changed:false};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>inspects===1&&documentMock.getElementById('sourceLabel').textContent==='Video:');assert.equal(scans,1);assert.equal(waits,0);}
 finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('automatic quality is a distinct action that resolves downloads while preserving the original preference',async()=>{
 const height=documentMock.getElementById('height');let tiers=[1080,720,480];
 state.phase=3;state.inspectHandler=async()=>({ok:true,result:{...readyInfo,browserSourceId:'quality-source',downloadKey:'quality-policy',duration:60,choices:{...readyInfo.choices,video:{auto:{enabled:true,heights:tiers,sizes:Object.fromEntries(['0',...tiers.map(String)].map(k=>[k,{bytes:1000}])),extensions:Object.fromEntries(['0',...tiers.map(String)].map(k=>[k,'mp4']))}}},range:{supported:true,duration:60,plans:{video:{0:true,1080:true,720:true,480:true}}}}});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  height.value='1080';await height.dispatch('change');await wait(()=>state.savedPreferences.height==='1080');
  tiers=[720,480];await documentMock.getElementById('refresh').click();await wait(()=>height.value==='preferred');
  assert.deepEqual(height.options.map(o=>o.textContent),['Best (720p)','720p (Auto)','720p','480p']);
  assert.equal(documentMock.getElementById('rangeSettings').hidden,false);
  await height.dispatch('change');assert.equal(state.savedPreferences.height,'1080');
  await documentMock.getElementById('download').click();assert.equal(state.lastDownload.height,720);assert.equal(state.savedPreferences.height,'1080');
  height.value='720';await height.dispatch('change');await wait(()=>state.savedPreferences.height==='720');assert.equal(height.value,'720');assert.ok(!height.options.some(o=>o.value==='preferred'));
  height.value='0';await height.dispatch('change');await wait(()=>state.savedPreferences.height==='0');assert.equal(height.value,'0');
  height.value='480';await height.dispatch('change');await wait(()=>state.savedPreferences.height==='480');
  height.value='1080';await height.dispatch('change');
  tiers=[1080,720];await documentMock.getElementById('refresh').click();await wait(()=>height.value==='1080');assert.equal(state.savedPreferences.height,'1080');
 }finally{height.value='0';await height.dispatch('change');state.inspectHandler=null;}
});

test('full-cut warning follows the selected plan and unknown durations keep range controls disabled',async()=>{
 let fullCut=true,known=true,sizeKnown=false,estimatedInputBytes=8*1024**2;state.phase=3;
 state.inspectHandler=async()=>({ok:true,result:{...readyInfo,duration:known?60:0,range:{supported:known,duration:known?60:0,plans:{video:{0:known,360:known}},planDetails:{video:{0:{mode:fullCut?'full-cut':'partial',sizeKnown,estimatedInputBytes},360:{mode:fullCut?'full-cut':'partial',sizeKnown,estimatedInputBytes}}}}}});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('rangeSettings').hidden);
  assert.equal(documentMock.getElementById('rangeWarning').hidden,false);
  assert.equal(documentMock.getElementById('rangeWarning').title,'Full source: ~ 8.0 MB');
  sizeKnown=true;await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('rangeWarning').title,'Full source: ~ 8.0 MB');
  estimatedInputBytes=null;await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('rangeWarning').title,'Full source size unknown');
  fullCut=false;await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('rangeWarning').hidden,true);
  known=false;await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('rangeSettings').hidden,true);assert.equal(documentMock.getElementById('rangeStart').disabled,true);
 }finally{state.inspectHandler=null;}
});

test('presence checks cannot replace the selected media during subtitle capture and resume after settlement',async()=>{
 let finishCapture;const video={title:'YT video',documentId:'yt-doc',frameId:0,localMediaIndex:0,mediaKey:71,url:'blob:yt-player'};
 const page={url:'https://www.youtube.com/watch?v=abcdefghijk',title:'YT video',documentId:'yt-doc',frameId:0,localMediaIndex:0,mediaIndex:0,platform:{site:'youtube',id:'abcdefghijk'},videos:[video],media:{url:'blob:yt-player',mediaKey:71},tracks:[{language:'zh-TW',name:'中文',source:'youtube-page',pageTrackId:'zh-main',pageTrackIndex:0,captionName:''}]};
 state.snapshotHandler=()=>page;state.inspectHandler=async()=>({ok:true,result:readyInfo});
 state.captureHandler=message=>{state.lastCapture=message;return new Promise(resolve=>{finishCapture=()=>resolve({ok:true,result:{language:'zh-TW',cues:[{start:0,end:1,text:'字幕'}]}});});};
 state.presenceHandler=message=>({ok:true,result:{checked:true,missing:message.targets}});
 const snapshots=state.snapshotCalls,presenceReads=state.mediaPresenceCalls||0;let captureClick;
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>state.snapshotCalls===snapshots+1&&!documentMock.getElementById('subtitleTab').disabled);
  await documentMock.getElementById('subtitleTab').click();captureClick=documentMock.getElementById('loadSubtitle').click();await wait(()=>!!finishCapture);
  firePresenceTimer();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.mediaPresenceCalls||0,presenceReads,'capture suppresses presence reads');assert.equal(state.snapshotCalls,snapshots+1,'capture cannot trigger a replacement snapshot');
  assert.equal(state.lastCapture.selector.mediaKey,video.mediaKey);
  finishCapture();await captureClick;await wait(()=>!documentMock.getElementById('copy').disabled);
  firePresenceTimer();await wait(()=>state.mediaPresenceCalls===presenceReads+1&&state.snapshotCalls===snapshots+2);
  assert.equal(state.lastSnapshot.preferPicked,false,'a confirmed missing target is refreshed after capture settles');
 }finally{
  finishCapture?.();if(captureClick)await captureClick.catch(()=>{});
  state.snapshotHandler=null;state.inspectHandler=null;state.captureHandler=null;state.presenceHandler=null;
  disconnectPopup?.();
 }
});

test('collapsing clip settings preserves its range draft without applying the clip until reopened',async()=>{
 state.phase=3;state.savedRangeDraft=null;state.lastDownload=null;
 const target={title:'Draft clip',documentId:'draft-doc',mediaKey:902,url:'https://cdn.test/draft.mp4',downloadUrl:'https://cdn.test/draft.mp4'};
 state.snapshotHandler=()=>({url:'https://example.test/draft',documentId:'draft-doc',mediaIndex:0,videos:[target],tracks:[]});
 state.inspectHandler=async()=>({ok:true,result:{...readyInfo,browserSourceId:'draft-source',downloadKey:'draft-download',duration:60,range:{duration:60,supported:true,plans:{video:{0:true,360:true},audio:{best:false}}}}});
 try{
  const details=documentMock.getElementById('rangeSettings'),start=documentMock.getElementById('rangeStart'),end=documentMock.getElementById('rangeEnd');
  await documentMock.getElementById('refresh').click();await wait(()=>!start.disabled&&!documentMock.getElementById('download').disabled);
  details.open=true;await details.dispatch('toggle');
  start.value='00:00:01.2';await start.dispatch('change');end.value='00:00:05.6';await end.dispatch('change');
  assert.deepEqual(state.savedRangeDraft.range,{start:1.2,end:5.6});assert.equal(state.savedRangeDraft.open,true);
  details.open=false;await details.dispatch('toggle');
  assert.deepEqual(state.savedRangeDraft.range,{start:1.2,end:5.6});assert.equal(state.savedRangeDraft.open,false);
  await documentMock.getElementById('refresh').click();await wait(()=>start.value==='00:00:01.2'&&end.value==='00:00:05.6'&&!details.open&&!documentMock.getElementById('download').disabled);
  assert.deepEqual(state.savedRangeDraft.range,{start:1.2,end:5.6});assert.equal(state.savedRangeDraft.open,false);
  await documentMock.getElementById('download').click();assert.equal(state.lastDownload.range,undefined,'a restored draft remains inactive while the disclosure is collapsed');
  details.open=true;await details.dispatch('toggle');assert.equal(start.value,'00:00:01.2');assert.equal(end.value,'00:00:05.6');
  await documentMock.getElementById('download').click();assert.deepEqual(state.lastDownload.range,{start:1.2,end:5.6});
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('an English numbered placeholder cannot replace a resolved original filename',async()=>{
 state.phase=3;state.lastDownload=null;
 const target={title:'Video 1',documentId:'filename-doc',mediaKey:903,url:'https://cdn.test/filename.mp4',downloadUrl:'https://cdn.test/filename.mp4'};
 state.snapshotHandler=()=>({url:'https://example.test/filename',documentId:'filename-doc',mediaIndex:0,videos:[target],tracks:[]});
 state.inspectHandler=async()=>({ok:true,result:{...readyInfo,title:'Resolved original media title',browserSourceId:'filename-source',downloadKey:'filename-download'}});
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  await documentMock.getElementById('download').click();
  assert.equal(state.lastDownload.title,'Resolved original media title');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('HTTP_AUTH retries a generic selected source once using its same frame, document, and media key',async()=>{
 state.phase=3;let scans=0,calls=0,readiness=0;
 const selected={title:'Lesson',frameId:2,documentId:'player-doc',mediaKey:'media-17',mediaContentId:'lesson-17',selectionIdentity:'player-video-17'};
 state.snapshotHandler=message=>{scans++;if(scans>1)assert.deepEqual(message.expectedTarget,selected);return {url:'https://player.example.test/watch',documentId:'top-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}};};
 state.readinessHandler=async()=>{readiness++;return {ready:true};};
 state.inspectHandler=async()=>++calls===1?{ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}}:{ok:true,result:readyInfo};
 const snapshots=state.snapshotCalls;
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>calls===2&&!documentMock.getElementById('download').disabled);
  assert.equal(scans,2);assert.equal(state.snapshotCalls,snapshots+2);assert.equal(calls,2);assert.equal(readiness,0,'non-Dailymotion sources retry directly against their selected identity');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;state.readinessHandler=null;}
});

test('a generic source that still rejects authorization is inspected only twice',async()=>{
 state.phase=3;let scans=0,calls=0;
 const selected={title:'Lesson',frameId:0,documentId:'same-doc',mediaKey:18,selectionIdentity:'same-player-video'};
 state.snapshotHandler=message=>{scans++;if(scans>1)assert.equal(message.expectedTarget.documentId,'same-doc');return {url:'https://player.example.test/lesson',documentId:'same-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}};};
 state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}};};
 try{
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Access denied. Refresh the page and retry.');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,2);assert.equal(calls,2);assert.equal(state.lastSnapshot.expectedTarget.mediaKey,18);
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('an authorization retry stops when the selected player identity changes',async()=>{
 state.phase=3;let scans=0,calls=0;
 const selected={title:'Lesson A',frameId:0,documentId:'same-doc',mediaKey:19,selectionIdentity:'video-A'};
 state.snapshotHandler=message=>{scans++;if(scans>1){assert.equal(message.expectedTarget.documentId,'same-doc');throw Object.assign(new Error('selected video changed'),{code:'SOURCE_CHANGED'});}return {url:'https://player.example.test/lesson-a',documentId:'same-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}};};
 state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}};};
 try{
  await documentMock.getElementById('refresh').click();await wait(()=>documentMock.getElementById('sourceLabel').textContent==='Video changed. Select it again.');
  assert.equal(scans,2);assert.equal(calls,1);assert.ok(state.lastSnapshot.expectedTarget,'retry stayed pinned to the original selected player');
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('HTTP_AUTH without an explicit frame and document identity does not guess a replacement',async()=>{
 state.phase=3;let scans=0,calls=0;
 state.snapshotHandler=()=>{scans++;return {url:'https://player.example.test/anonymous',platform:{site:'embedded'},mediaIndex:0,videos:[{title:'Unbound player',mediaKey:21}],tracks:[]};};
 state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}};};
 const snapshots=state.snapshotCalls;
 try{
  await documentMock.getElementById('refresh').click();await waitForSourceFailure('Access denied. Refresh the page and retry.');
  assert.equal(scans,1);assert.equal(state.snapshotCalls,snapshots+1);assert.equal(calls,1);
 }finally{state.snapshotHandler=null;state.inspectHandler=null;}
});

test('closing the popup cancels a pending authorization retry snapshot',async()=>{
 state.phase=3;let scans=0,calls=0,releaseSnapshot;
 const selected={title:'Lesson',frameId:0,documentId:'close-doc',mediaKey:20,selectionIdentity:'close-video'};
 const cancellations=state.cancelled.length;
 state.snapshotHandler=message=>{scans++;if(scans>1)return new Promise(resolve=>{releaseSnapshot=resolve;});return {url:'https://player.example.test/close',documentId:'close-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}};};
 state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403}};};
 let operation;
 try{
  operation=documentMock.getElementById('refresh').click();await wait(()=>scans===2&&!!releaseSnapshot);
  dispatchGlobalEvent('pagehide');releaseSnapshot({url:'https://player.example.test/close',documentId:'close-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}});
  await operation;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,2);assert.equal(calls,1,'closing the popup does not launch another inspect');assert.equal(state.cancelled.length,cancellations+1,'the in-flight inspection is cancelled on close');
 }finally{releaseSnapshot?.({url:'https://player.example.test/close',documentId:'close-doc',mediaIndex:0,videos:[selected],tracks:[],platform:{site:'embedded'}});state.snapshotHandler=null;state.inspectHandler=null;}
});
