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
  constructor() { this.nodes = new Map(); for (const id of ['sourceLabel','pageTitle','mediaSelect','pickMedia','refresh','downloadSection','subtitleSection','videoTab','audioTab','subtitleTab','videoSettings','audioSettings','videoFormat','videoFormatValue','audioFormat','audioFormatValue','height','heightValue','audioQuality','audioQualityValue','download','language','subtitleFormat','subtitleFormatValue','loadSubtitle','subtitleContent','preview','copy','saveSubtitle','job','notice','diagnosticRow','diagnosticText','dismissError','rangeSettings','rangeSliders','rangeStart','rangeEnd','rangeStartSlider','rangeEndSlider']) this.nodes.set(id, new Element(id.includes('Select') || ['mediaSelect','videoFormat','audioFormat','height','audioQuality','language','subtitleFormat'].includes(id) ? 'select' : 'div'));for(const [id,value] of [['videoFormat','auto'],['audioFormat','original'],['subtitleFormat','txt']]){this.nodes.get(id).add({value,textContent:value,disabled:false});this.nodes.get(id).value=value;}this.nodes.get('job').hidden=true;this.nodes.get('downloadSection').hidden=true; }
  getElementById(id) { return this.nodes.get(id); }
  createElement(tag) { return new Element(tag); }
}

const documentMock = new DocumentMock();
globalThis.document = documentMock;
globalThis.Option = class Option { constructor(text, value = '') { this.textContent = text; this.value = value; this.disabled = false; this.title = ''; } };
Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{clipboard:{writeText:async text=>{state.clipboard=text;}}}});
globalThis.indexedDB = {open() { const request = {}; setTimeout(() => { request.result = {createObjectStore(){}, transaction(){ return {objectStore(){return {put(){},delete(){}}}, commit(){}}; }}; request.onsuccess?.(); }, 0); return request; }};

const state = {phase:0, snapshotCalls:0, inspectCalls:0, inspectFailure:'NETWORK_FAILURE',inspectEmpty:false,fastTimeout:false,snapshotHandler:null,inspectHandler:null,cacheHandler:null,cancelled:[]};let disconnectPopup,storageChanged;
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,state.fastTimeout&&ms===30000?25:ms,...args);
test.after(()=>{disconnectPopup?.();globalThis.setTimeout=nativeTimeout;});
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
    if (message.action === 'cancelInspect'){state.cancelled.push(message.inspectionId);return {ok:true,result:{}};}
    if (message.action === 'waitMediaSource'){state.lastReadiness=message;return {ok:true,result:state.readinessHandler?await state.readinessHandler(message):{ready:false}};}
    if (message.action === 'inspect'&&state.inspectHandler){state.inspectCalls++;return state.inspectHandler(message);}
    if (message.action === 'inspect') { state.inspectCalls++; if(state.inspectEmpty)return {ok:true,result:{title:'player detected',downloadKey:'k',choices:{video:{auto:{enabled:false,heights:[],extensions:{},sizes:{}}},audio:{original:{enabled:false,qualities:[],extensions:{},sizes:{}}}},tracks:[]}}; if (state.phase < 3) return {ok:false,error:'inspect failed',failure:state.inspectFailure==='HTTP_AUTH'?{code:'HTTP_AUTH',httpStatus:403,requestMethod:'GET RANGE',requestHost:'v16m.tiktokcdn.com'}:{code:state.inspectFailure}}; return {ok:true,result:{title:'usable',downloadKey:'k',choices:{video:{auto:{enabled:true,heights:[360],extensions:{360:'mp4'},sizes:{360:{bytes:1}}}},audio:{original:{enabled:false}}},tracks:[]}}; }
    if(message.action==='mediaTime'){state.lastMediaTime=message;return {ok:true,result:{time:message.time??12.5,duration:60}};}
    if(message.action==='download'){state.lastDownload=message;return {ok:true,result:{id:'range-job'}};}
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

test('popup integration hides unusable media UI, preserves subtitle-only UI, and recovers after media switch', async () => {
  await wait(() => state.snapshotCalls >= 1 && documentMock.getElementById('job').children.length===1);
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('job').children.length, 1);

  state.phase = 1; await documentMock.getElementById('refresh').click();
  assert.equal(state.lastSnapshot.preferPicked,false,'explicit refresh clears the previous picker choice instead of preserving stale selection');
  await wait(() => state.snapshotCalls >= 2 && documentMock.getElementById('sourceLabel').textContent === '來源讀取失敗');
  assert.equal(documentMock.getElementById('downloadSection').hidden, true);
  assert.equal(documentMock.getElementById('mediaSelect').hidden, true);
  assert.equal(documentMock.getElementById('notice').hidden,true);assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);

  state.inspectFailure='SOURCE_UNAVAILABLE';await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 3 && documentMock.getElementById('sourceLabel').textContent === '找到影片，但無下載來源');
  assert.match(documentMock.getElementById('sourceLabel').title,/SOURCE_UNAVAILABLE/);
  assert.match(documentMock.getElementById('sourceLabel').title,/尚未找到與播放器配對/);
  assert.match(documentMock.getElementById('sourceLabel').title,/JSON 3 · 模型 2 · 配對 0 · identity-unmatched/);

  state.inspectEmpty=true;await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 4 && documentMock.getElementById('sourceLabel').textContent === '找到影片，但無下載來源');
  assert.equal(documentMock.getElementById('downloadSection').hidden,true);
  assert.match(documentMock.getElementById('sourceLabel').title,/^來源未提供可用影音格式/);
  state.inspectEmpty=false;state.inspectFailure='HTTP_AUTH';await documentMock.getElementById('refresh').click();
  await wait(() => state.snapshotCalls >= 5 && documentMock.getElementById('sourceLabel').textContent === '來源拒絕下載');
  assert.match(documentMock.getElementById('sourceLabel').title,/HTTP 403 · GET RANGE · v16m\.tiktokcdn\.com/);
  assert.doesNotMatch(documentMock.getElementById('sourceLabel').title,/尚未找到與播放器配對/);

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
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'解析影片中…');
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);
 release({ok:true,result:readyInfo});
 await wait(()=>!documentMock.getElementById('downloadSection').hidden&&!documentMock.getElementById('download').disabled);
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'影片：');
 assert.equal(documentMock.getElementById('videoFormat').hidden,true);
 assert.equal(documentMock.getElementById('videoFormatValue').hidden,false);
 assert.equal(documentMock.getElementById('height').hidden,true);
 assert.equal(documentMock.getElementById('heightValue').textContent,'360p');state.inspectHandler=null;
});

test('an incomplete success payload renders an explicit failure that job updates cannot clear',async()=>{
 state.inspectHandler=async()=>({ok:true,result:{title:'detected element'}});
 await documentMock.getElementById('refresh').click();
 await wait(()=>documentMock.getElementById('sourceLabel').classList.contains('error'));
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'找到影片，但無下載來源');
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);
 storageChanged({jobs:{newValue:jobs}},'session');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'找到影片，但無下載來源');state.inspectHandler=null;
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
 await wait(()=>documentMock.getElementById('sourceLabel').textContent==='來源讀取逾時');state.fastTimeout=false;
 assert.equal(documentMock.getElementById('downloadSection').hidden,true);assert.ok(state.cancelled.includes(id));
 release({ok:true,result:readyInfo});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(documentMock.getElementById('sourceLabel').textContent,'來源讀取逾時');
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

test('an unavailable permalink keeps the short error and exposes its precise stage only in the tooltip',async()=>{
 state.snapshotHandler=()=>({url:'https://www.facebook.com/feed',title:'Feed',videos:[{title:'post',mediaKey:1,linkedMedia:{url:'https://www.facebook.com/reel/123/',id:'123'}}],tracks:[]});
 state.inspectHandler=async()=>({ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model'}});
 try{await documentMock.getElementById('refresh').click();await wait(()=>documentMock.getElementById('sourceLabel').classList.contains('error'));assert.equal(documentMock.getElementById('sourceLabel').textContent,'找到影片，但無下載來源');assert.ok(documentMock.getElementById('sourceLabel').title.includes('獨立影片頁未回傳相符的播放資料'));assert.equal(documentMock.getElementById('downloadSection').hidden,true);}
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

test('clicking the red source label copies bounded diagnostics without media titles',async()=>{
 state.snapshotHandler=()=>({url:'https://www.facebook.com/feed',title:'PRIVATE',videos:[{title:'PRIVATE',linkedMedia:{url:'https://www.facebook.com/reel/123/',id:'123'}}],media:{discoveryDiagnostics:{models:2,matches:0}},tracks:[]});
 state.inspectHandler=async()=>({ok:false,error:'source unavailable',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model'}});
 try{await documentMock.getElementById('refresh').click();await wait(()=>documentMock.getElementById('sourceLabel').classList.contains('error'));await documentMock.getElementById('sourceLabel').click();const copied=JSON.parse(state.clipboard);assert.equal(copied.failure.stage,'linked-no-model');assert.equal(copied.discovery.models,2);assert.ok(!state.clipboard.includes('PRIVATE'));assert.ok(!state.clipboard.includes('facebook.com'));}
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

test('a transient Dailymotion refusal performs only one delayed snapshot retry',async()=>{
 let calls=0;const selected={title:'Episode',documentId:'dm-doc',frameId:0,mediaKey:1,mediaContentId:'episode',dailymotionMain:true};
 state.snapshotHandler=()=>({url:'https://www.dailymotion.com/video/episode',title:'Episode',documentId:'dm-doc',videos:[selected],platform:{site:'dailymotion',id:'episode'},tracks:[]});
 state.readinessHandler=async()=>({ready:true});state.inspectHandler=async()=>{calls++;return {ok:false,error:'refused',failure:{code:'HTTP_AUTH',httpStatus:403,sourceStage:'stream-manifest',requestMethod:'GET',requestHost:'vod.dmcdn.net'}};};
 try{await documentMock.getElementById('refresh').click();await wait(()=>calls===2&&documentMock.getElementById('sourceLabel').textContent==='來源拒絕下載');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);await documentMock.getElementById('sourceLabel').click();const diagnostic=JSON.parse(state.clipboard);assert.equal(diagnostic.failure.stage,'stream-manifest');assert.equal(diagnostic.failure.host,'vod.dmcdn.net');}
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
  assert.match(documentMock.getElementById('download').textContent,/下載片段/);
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
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);assert.equal(documentMock.getElementById('height').hidden,false);assert.equal(documentMock.getElementById('heightValue').hidden,true);const height=documentMock.getElementById('height');height.value='720';await height.dispatch('change');assert.equal(documentMock.getElementById('videoFormatValue').textContent,'MP4');}
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

test('a download failure remains visible while media inspection refreshes and can be copied',async()=>{
 state.phase=3;state.lastError={id:'failed-job',time:Date.now()-15000,code:'HTTP_AUTH',stage:'download',httpStatus:403,requestMethod:'GET RANGE',requestHost:'cdn.example'};
 try{
  storageChanged({lastError:{newValue:state.lastError}},'session');await wait(()=>!documentMock.getElementById('diagnosticRow').hidden);
  await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('download').disabled);
  assert.equal(documentMock.getElementById('diagnosticRow').hidden,false);
  await documentMock.getElementById('diagnosticText').click();const copied=JSON.parse(state.clipboard);assert.equal(copied.operation,'download');assert.equal(copied.failure.code,'HTTP_AUTH');assert.equal(copied.failure.httpStatus,403);
  await documentMock.getElementById('dismissError').click();assert.equal(state.dismissedError,'failed-job');assert.equal(documentMock.getElementById('diagnosticRow').hidden,true);
 }finally{state.lastError=null;await documentMock.getElementById('dismissError').click();}
});

test('sub-second range duration remains visible on the download button without a middle duration field',async()=>{
 state.phase=3;state.inspectHandler=async()=>({ok:true,result:{...readyInfo,duration:60,range:{supported:true,duration:60,plans:{video:{0:true,360:true},audio:{}}}}});
 try{await documentMock.getElementById('refresh').click();await wait(()=>!documentMock.getElementById('rangeStart').disabled);const details=documentMock.getElementById('rangeSettings');details.open=true;await details.dispatch('toggle');const start=documentMock.getElementById('rangeStart'),end=documentMock.getElementById('rangeEnd');start.value='00:00:10';await start.dispatch('change');end.value='00:00:10.1';await end.dispatch('change');assert.match(documentMock.getElementById('download').textContent,/00:00\.1/);}finally{state.inspectHandler=null;}
});
