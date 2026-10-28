import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createYoutubeCaptionReader,youtubeCaptionAssist} from '../extension/youtube-caption-assist.js';

const ID='abcdefghijk',body=text=>JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:text}]}]}),failure=()=>Object.assign(new Error('empty'),{code:'YT_FILE_EMPTY'});
const track=(id,languageCode,extra={})=>({vssId:id,languageCode,name:{simpleText:id},baseUrl:`https://www.youtube.com/api/timedtext?v=${ID}&lang=${languageCode}`,...extra});
const en=track('en-main','en'),zh=track('zh-main','zh-TW');
const selector={pageSource:'youtube-page',videoId:ID,pageTrackId:zh.vssId,captionName:'',mediaKey:7,mediaUrl:'blob:movie'};
const input={tabId:10,documentId:'doc-one',language:'zh-TW',automatic:false,selector};

function world({enabled=false,active=en,tracks=[en,zh],nativeBody=body('中文'),nativeStatus=200,apply=true,xhr=false,makeResponse,remembered=en,revealTrack=true}={}){
 const calls=[],errors=[],listeners=new Map(),timers=new Map(),clockStart=Date.now();let nextTimer=0,currentId=ID;
 const video={currentSrc:'blob:movie'},state={enabled,active:structuredClone(active),remembered:structuredClone(active.languageCode?active:remembered)};
 const context={URL,URLSearchParams,Symbol,Reflect,WeakMap,Map,TextDecoder,Response,structuredClone,Promise,console:{...console,error:message=>errors.push(String(message))},Date:{now:()=>clockStart+(Date.now()-clockStart)*10},
  location:{href:`https://www.youtube.com/watch?v=${ID}`},
  setTimeout(fn,ms){const id=++nextTimer,entry={fn,ms};if(ms<15000)entry.handle=setTimeout(()=>{timers.delete(id);fn();},Math.max(1,ms/10));timers.set(id,entry);return id;},clearTimeout(id){clearTimeout(timers.get(id)?.handle);timers.delete(id);},
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}
 };
 context.window=context;context.fetch=async url=>{calls.push(['fetch',String(url)]);return makeResponse?makeResponse():new Response(nativeBody,{status:nativeStatus});};
 class Xhr{
  constructor(){this.events=new Map();this.responseType='';this.status=nativeStatus;}
  open(_method,url){this.responseURL=url;}
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}
  send(){this.responseText=nativeBody;this.events.get('loadend')?.();}
 }
 if(xhr)context.XMLHttpRequest=Xhr;
 const player={
  querySelector:sel=>sel==='video'?video:null,
  getPlayerResponse:()=>({videoDetails:{videoId:currentId},captions:{playerCaptionsTracklistRenderer:{captionTracks:tracks}}}),
  getOption:()=>state.active,isSubtitlesOn:()=>state.enabled,
  loadModule(){calls.push(['load']);state.enabled=true;if(!state.active.languageCode&&revealTrack)state.active=structuredClone(state.remembered);},
  unloadModule(){calls.push(['unload']);state.enabled=false;},
  setOption(_module,option,value){
   calls.push([option,value]);if(option==='track'&&apply){state.active=structuredClone(value);state.remembered=structuredClone(value);}
   if((option==='track'||option==='reload')&&apply){const url=option==='track'?value.baseUrl:state.active.baseUrl;if(xhr){const req=new context.XMLHttpRequest();req.open('GET',url);req.send();}else void context.fetch(url);}
  }
 };
 context.document={querySelector:()=>player};context[Symbol.for('video-pocket.identities')]={keys:new Map([[video,7]])};
 const realm=vm.createContext(context),run=options=>vm.runInContext(`(${youtubeCaptionAssist.toString()})(options)`,Object.assign(realm,{options}));
 const originalFetch=context.fetch,originalOpen=Xhr.prototype.open,originalSend=Xhr.prototype.send;
 return {run,state,calls,errors,context,timers,player,video,originalFetch,originalOpen,originalSend,
  assist:()=>vm.runInContext("window[Symbol.for('video-pocket.youtube-caption-assist')]",realm),
  changeVideo(id){currentId=id;context.location.href=`https://www.youtube.com/watch?v=${id}`;},
  input(event){for(const fn of listeners.get(event.type) || [])fn(event);},
  async flush(){for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));}
 };
}
const start=w=>w.run({action:'start',token:'one',language:'zh-TW',automatic:false,selector});
function menuChoice(label,title='Subtitles/CC'){
 const menu={querySelector:()=>({textContent:title})},item={textContent:label,querySelector:()=>({textContent:label}),closest:()=>menu};
 return {type:'pointerdown',isTrusted:true,target:{closest:selector=>selector==='.ytp-settings-menu'?menu:selector==='.ytp-menuitem'?item:null}};
}

test('closed captions are enabled only for recovery; selected native body is read and original settings restored',async()=>{
 const w=world();assert.equal((await start(w)).started,true);await w.flush();
 assert.equal(w.state.enabled,true);assert.equal(w.state.active.vssId,zh.vssId);
 assert.equal(JSON.parse((await w.run({action:'poll',token:'one'})).raw).events[0].segs[0].utf8,'中文');
 await w.run({action:'finish',token:'one'});
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.context.fetch,w.originalFetch);assert.equal(w.timers.size,0);
});

test('native observer distinguishes a received empty body from a timedtext HTTP failure',async()=>{
 const empty=world({nativeBody:''});assert.equal((await start(empty)).started,true);await empty.flush();
 const emptyResponse=await empty.run({action:'poll',token:'one'});assert.equal(emptyResponse.hasResponse,true);assert.equal(emptyResponse.raw,'');await empty.run({action:'finish',token:'one'});
 const refused=world({nativeStatus:503});assert.equal((await start(refused)).started,true);await refused.flush();
 const httpFailure=await refused.run({action:'poll',token:'one'});assert.equal(httpFailure.failure.code,'YT_FILE_HTTP');assert.equal(httpFailure.failure.status,503);await refused.run({action:'finish',token:'one'});
});

test('a loaded but disabled module uses the native caption toggle before choosing a language',async()=>{
 const w=world({active:{}});
 w.player.loadModule=()=>{w.calls.push(['load-only']);};
 w.player.toggleSubtitles=()=>{w.calls.push(['native-toggle']);w.state.enabled=!w.state.enabled;if(w.state.enabled)w.state.active=structuredClone(w.state.remembered);};
 assert.equal((await start(w)).started,true);await w.flush();
 assert.equal(w.calls.filter(c=>c[0]==='native-toggle').length,1);
 assert.ok(w.calls.findIndex(c=>c[0]==='native-toggle')<w.calls.findIndex(c=>c[0]==='track'));
 assert.ok((await w.run({action:'poll',token:'one'})).raw);
 assert.equal((await w.run({action:'finish',token:'one'})).restored,true);
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);
});

test('closed captions with a cached matching track request a native reload instead of waiting for a missing response',async()=>{
 const w=world({active:zh}),set=w.player.setOption;
 w.player.setOption=(module,option,value)=>{if(option==='track'&&value.vssId===zh.vssId){w.calls.push([option,value]);return;}return set(module,option,value);};
 assert.equal((await start(w)).started,true);await w.flush();
 assert.equal(w.calls.filter(c=>c[0]==='reload').length,1);
 assert.ok((await w.run({action:'poll',token:'one'})).raw);
 assert.equal((await w.run({action:'finish',token:'one'})).restored,true);assert.equal(w.state.enabled,false);
});

test('a cached different target is reloaded once if selecting it emits no response',async()=>{
 const w=world(),set=w.player.setOption;
 w.player.setOption=(module,option,value)=>{if(option==='track'){w.calls.push([option,value]);w.state.active=structuredClone(value);w.state.remembered=structuredClone(value);return;}return set(module,option,value);};
 const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:(_input,options)=>w.run(options),request:async()=>undefined,now:w.context.Date.now,sleep:ms=>new Promise(resolve=>w.context.setTimeout(resolve,ms)),waitMs:2000});
 assert.equal((await capture(input)).cues[0].text,'中文');
 assert.equal(w.calls.filter(c=>c[0]==='reload').length,1);
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);
});

test('a slow native response is not duplicated by the cache recovery reload',async()=>{
 let release;
 const w=world({makeResponse:()=>new Promise(resolve=>{release=()=>resolve(new Response(body('slow native')));})});
 assert.equal((await start(w)).started,true);await w.flush();
 await new Promise(resolve=>w.context.setTimeout(resolve,500));
 assert.equal((await w.run({action:'poll',token:'one'})).waiting,true);
 assert.equal(w.calls.filter(c=>c[0]==='reload').length,0);
 release();await w.flush();assert.ok((await w.run({action:'poll',token:'one'})).raw);
 await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('selecting the remembered track does not reload while its native request is still in flight',async()=>{
 const pending=[],w=world({active:zh,makeResponse:()=>new Promise(resolve=>pending.push(resolve))});
 try{
  assert.equal((await start(w)).started,true);
  assert.equal(pending.length,1);
  assert.equal(w.calls.filter(c=>c[0]==='reload').length,0);
  pending[0](new Response(body('native')));await w.flush();
  assert.equal(JSON.parse((await w.run({action:'poll',token:'one'})).raw).events[0].segs[0].utf8,'native');
 }finally{
  for(const resolve of pending)resolve(new Response(body('native')));
  await w.run({action:'finish',token:'one'});
 }
 assert.equal(w.state.enabled,false);assert.equal(w.context.fetch,w.originalFetch);
});

test('a later empty native response cannot overwrite a caption body waiting to be consumed',async()=>{
 const pending=[],w=world({makeResponse:()=>new Promise(resolve=>pending.push(resolve))});
 try{
  assert.equal((await start(w)).started,true);
  void w.context.fetch(zh.baseUrl);
  assert.equal(pending.length,2);
  pending[0](new Response(body('keep this caption')));await w.flush();
  pending[1](new Response(''));await w.flush();
  const state=await w.run({action:'poll',token:'one'});
  assert.equal(state.hasResponse,true);
  assert.equal(JSON.parse(state.raw).events[0].segs[0].utf8,'keep this caption');
 }finally{
  for(const resolve of pending)resolve(new Response(''));
  await w.run({action:'finish',token:'one'});
 }
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);
});

test('an empty recovery poll still accepts a later non-empty native response',async()=>{
 let tick=0,polls=0;
 const capture=createYoutubeCaptionReader({
  read:async()=>{throw failure();},
  command:async(_request,options)=>options.action==='start'?{started:true}:options.action==='finish'?{restored:true}:++polls===1?{hasResponse:true,raw:''}:{hasResponse:true,raw:body('later')},
  request:async()=>undefined,now:()=>tick,sleep:async ms=>{tick+=ms;},waitMs:200
 });
 assert.equal((await capture(input)).cues[0].text,'later');assert.equal(polls,2);
});

test('restoration also confirms captions are off when unloading alone leaves the native toggle on',async()=>{
 const w=world();await start(w);
 w.player.unloadModule=()=>{w.calls.push(['unload-only']);};
 w.player.toggleSubtitles=()=>{w.calls.push(['native-toggle']);w.state.enabled=!w.state.enabled;};
 assert.equal((await w.run({action:'finish',token:'one'})).restored,true);
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.timers.size,0);
});

test('caption selector ownership loss is reported as a changed source through the reader',async()=>{
 const w=world(),capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:(_input,options)=>w.run(options)});
 await assert.rejects(capture({...input,selector:{...selector,mediaKey:99}}),{code:'SOURCE_CHANGED'});
 assert.equal(w.calls.length,0);assert.equal(w.context.fetch,w.originalFetch);
});

test('caption source elements use the same URL fallback as the page snapshot',async()=>{
 const w=world();w.video.currentSrc='';w.video.querySelector=()=>({src:'blob:movie'});
 assert.equal((await start(w)).started,true);await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('an enabled different language and automatic translation are restored after capture',async()=>{
 const previous={...en,translationLanguage:{languageCode:'fr'}};
 const w=world({enabled:true,active:previous});assert.equal((await start(w)).started,true);await w.flush();
 assert.ok((await w.run({action:'poll',token:'one'})).raw);await w.run({action:'finish',token:'one'});
 assert.deepEqual(w.state.active,previous);assert.equal(w.state.enabled,true);assert.equal(w.calls.some(c=>c[0]==='unload'),false);
});

test('native XHR captions work and temporary XHR methods are fully restored',async()=>{
 const w=world({xhr:true});assert.equal((await start(w)).started,true);
 assert.ok((await w.run({action:'poll',token:'one'})).raw);await w.run({action:'finish',token:'one'});
 assert.equal(w.context.XMLHttpRequest.prototype.open,w.originalOpen);assert.equal(w.context.XMLHttpRequest.prototype.send,w.originalSend);
});

test('unrelated languages, translated responses and other videos are not captured',async()=>{
 const w=world({nativeBody:''});assert.equal((await start(w)).started,true);await w.flush();
 await w.context.fetch(en.baseUrl);await w.context.fetch(zh.baseUrl+'&tlang=en');await w.context.fetch(zh.baseUrl.replace(ID,'zyxwvutsrqp'));await w.flush();
 const result=await w.run({action:'poll',token:'one'});assert.equal(result.hasResponse,true);assert.equal(result.raw,'');await w.run({action:'finish',token:'one'});
});

test('same-language author variants require exact vssId and caption name',async()=>{
 const a=track('a','zh-TW',{baseUrl:zh.baseUrl+'&name=A'}),b=track('b','zh-TW',{baseUrl:zh.baseUrl+'&name=B'});
 const w=world({tracks:[a,b],active:a});const selected={...selector,pageTrackId:'b',captionName:'B'};
 assert.equal((await w.run({action:'start',token:'one',language:'zh-TW',automatic:false,selector:selected})).started,true);await w.flush();
 assert.ok((await w.run({action:'poll',token:'one'})).raw);assert.equal(w.state.active.vssId,'b');await w.run({action:'finish',token:'one'});
});

test('manual caption interaction is preserved and pending capture is cancelled',async()=>{
 const w=world({nativeBody:''});await start(w);
 w.input({type:'pointerdown',isTrusted:true,target:{closest:selector=>selector.includes('.ytp-subtitles-button')?{}:null}});w.state.active=en;w.state.enabled=false;
 const cancelled=await w.run({action:'poll',token:'one'});assert.equal(cancelled.cancelled,true);assert.equal(cancelled.manual,true);await w.run({action:'finish',token:'one'});
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.context.fetch,w.originalFetch);
});

test('navigation never restores old subtitle settings onto the next video',async()=>{
 const w=world({enabled:true});await start(w);w.changeVideo('zyxwvutsrqp');
 assert.equal((await w.run({action:'poll',token:'one'})).changed,true);assert.equal(w.calls.filter(c=>c[0]==='track').length,1);assert.equal(w.context.fetch,w.originalFetch);
});

test('watchdog restores settings if the background stops before finish',async()=>{
 const w=world();await start(w);const watchdog=[...w.timers.values()].find(t=>t.ms===15000);assert.ok(watchdog);await watchdog.fn();
 assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.context.fetch,w.originalFetch);
});

test('cleanup does not replace a fetch hook installed later by the site',async()=>{
 const w=world();await start(w);const later=()=>Promise.resolve(new Response('later'));w.context.fetch=later;await w.run({action:'finish',token:'one'});assert.equal(w.context.fetch,later);
});

test('stale selectors and missing targets do not change caption state',async()=>{
 for(const patch of [{videoId:'zyxwvutsrqp'},{pageTrackId:'missing'},{captionName:'other'},{mediaKey:99}]){
  const w=world();assert.equal((await w.run({action:'start',token:'one',language:'zh-TW',automatic:false,selector:{...selector,...patch}})).started,false);assert.equal(w.calls.length,0);assert.equal(w.context.fetch,w.originalFetch);
 }
});

test('successful direct reads never activate caption controls or wait',async()=>{
 const expected={cues:[{start:0,end:1,text:'direct'}]};
 const capture=createYoutubeCaptionReader({read:async()=>expected,command:()=>assert.fail('no player control'),request:()=>assert.fail('no extra request')});
 assert.equal(await capture(input),expected);
});

test('recovery consumes native captions and always finishes without replaying the file',async()=>{
 const actions=[];let reads=0;
 const capture=createYoutubeCaptionReader({read:async()=>{reads++;throw failure();},command:async(_r,o)=>{actions.push(o.action);return o.action==='start'?{started:true}:o.action==='poll'?{raw:body('native')}:{finished:true,restored:true};},request:()=>assert.fail('native body was sufficient')});
 const result=await capture(input);assert.equal(result.cues[0].text,'native');assert.equal(result.warningCode,undefined);assert.equal(reads,1);assert.deepEqual(actions,['start','poll','finish']);
});

test('recovery replays only a fresh signed request once, then restores state',async()=>{
 const actions=[],urls=[],signed=zh.baseUrl+'&pot=fresh';let tick=1000,reads=0;
 const capture=createYoutubeCaptionReader({now:()=>tick,sleep:async ms=>{tick+=ms;},read:async request=>{reads++;if(reads===1)throw failure();assert.equal(request.selector.captionUrl,signed);return {cues:[{start:0,end:1,text:'fresh'}]};},command:async(_r,o)=>{actions.push(o.action);return o.action==='start'?{started:true}:{restored:true};},request:async(_r,since)=>{urls.push(since);return signed;},waitMs:1000});
 assert.equal((await capture(input)).cues[0].text,'fresh');assert.equal(reads,2);assert.ok(urls.every(t=>t===1000));assert.equal(actions.at(-1),'finish');
});

test('started recovery distinguishes timeout, empty responses and invalid content',async()=>{
 const cases=[[{waiting:true},'YT_TIMEOUT'],[{raw:''},'YT_FILE_EMPTY'],[{raw:JSON.stringify({events:[]})},'YT_FILE_EMPTY']];
 for(const [pollState,code] of cases){
  let tick=0;const actions=[];
  const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>{actions.push(o.action);return o.action==='start'?{started:true}:o.action==='finish'?{restored:true}:pollState;},request:async()=>undefined,now:()=>tick,sleep:async ms=>{tick+=ms;},waitMs:200});
  await assert.rejects(capture(input),{code});assert.equal(actions.filter(a=>a==='finish').length,1);
 }
 for(const raw of ['{"events":','bad data','<html><body>no captions</body></html>']){
  let tick=0;
  const malformed=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='finish'?{restored:true}:{raw},request:async()=>undefined,now:()=>tick,sleep:async ms=>{tick+=ms;},waitMs:100});
  await assert.rejects(malformed(input),{code:'YT_FILE_INVALID'});
 }
});

test('fresh replay that has a valid empty response reports YT03; native HTTP errors keep their status',async()=>{
 let tick=0,reads=0;const signed=zh.baseUrl+'&pot=fresh';
 const replay=createYoutubeCaptionReader({read:async request=>{if(++reads===1)throw failure();assert.equal(request.selector.captionUrl,signed);return {cues:[]};},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='finish'?{restored:true}:{waiting:true},request:async()=>signed,now:()=>tick,sleep:async ms=>{tick+=ms;},waitMs:100});
 await assert.rejects(replay(input),{code:'YT_FILE_EMPTY'});
 let now=0;
 const refused=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='finish'?{restored:true}:{failure:{code:'YT_FILE_HTTP',status:503}},request:()=>undefined,now:()=>now,sleep:async ms=>{now+=ms;},waitMs:100});
 await assert.rejects(refused(input),error=>error.code==='YT_FILE_HTTP'&&error.status===503);
});

test('unavailable recovery has an explicit code, while started recovery keeps transport failures',async()=>{
 const refused=Object.assign(new Error('HTTP 403'),{code:'YT_FILE_HTTP',status:403});
 for(const initial of [failure(),refused,{code:'YT_FILE_NETWORK'},{code:'YT_FILE_INVALID'},{code:'YT_TIMEOUT'}]){
  const unavailable=createYoutubeCaptionReader({read:async()=>{throw initial;},command:async(_r,o)=>o.action==='start'?{started:false}:{cancelled:true},request:()=>undefined});
  await assert.rejects(unavailable(input),{code:'YT_RECOVERY_UNAVAILABLE'});
 }
 for(const error of [{code:'YT_FILE_HTTP',status:403},{code:'YT_FILE_NETWORK'},{code:'YT_FILE_INVALID'},{code:'YT_TIMEOUT'}]){
  const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='finish'?{restored:true}:Promise.reject(error),request:()=>undefined});
  await assert.rejects(capture(input),value=>value===error);
 }
});

test('captured subtitles survive an unconfirmed or failed restore and carry an allowlisted warning',async()=>{
 for(const finish of [async()=>({restored:false}),async()=>{throw Error('finish RPC lost');}]){
  const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='poll'?{raw:body('keep me')}:finish(),request:()=>undefined});
  const result=await capture(input);assert.equal(result.cues[0].text,'keep me');assert.equal(result.warningCode,'YT_RESTORE_UNCONFIRMED');
 }
 const manuallySettled=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>o.action==='start'?{started:true}:o.action==='poll'?{raw:body('manual choice')}:({restored:false,cancelled:true}),request:()=>undefined});
 const result=await manuallySettled(input);assert.equal(result.cues[0].text,'manual choice');assert.equal(result.warningCode,undefined);
});

test('manual cancellation takes precedence over an empty-read failure',async()=>{
 const actions=[];const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>{actions.push(o.action);return o.action==='start'?{started:true}:o.action==='poll'?{cancelled:true,manual:true}:{restored:false,cancelled:true};},request:()=>undefined});
 await assert.rejects(capture(input),{code:'CANCELLED'});assert.deepEqual(actions,['start','poll','finish']);
});

test('source changes during recovery are reported immediately and cleaned up',async()=>{
 const actions=[];const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_r,o)=>{actions.push(o.action);return o.action==='start'?{started:true}:{changed:true};},request:()=>assert.fail('changed source')});
 await assert.rejects(capture(input),{code:'SOURCE_CHANGED'});assert.deepEqual(actions,['start','poll','finish']);
});

test('rate limits, server errors and other platforms do not trigger player recovery',async()=>{
 for(const [request,error] of [[input,{code:'YT_FILE_HTTP',status:429}],[input,{code:'YT_FILE_HTTP',status:503}],[input,{code:'SOURCE_CHANGED'}],[{...input,selector:{pageSource:'bilibili-api'}},{code:'YT_FILE_EMPTY'}]]){
  const capture=createYoutubeCaptionReader({read:async()=>{throw error;},command:()=>assert.fail('must not control player')});await assert.rejects(capture(request),value=>value===error);
 }
});

test('different-language recoveries in one tab are serialized; other tabs remain independent',async()=>{
 const active=new Set(),events=[];let release;const hold=new Promise(resolve=>{release=resolve;});
 const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(r,o)=>{
  if(o.action==='start'){assert.equal(active.has(r.tabId),false);active.add(r.tabId);events.push('start'+r.language);return {started:true};}
  if(o.action==='poll'){if(r.language==='zh-TW')await hold;return {raw:body(r.language)};}
  if(o.action==='finish'){active.delete(r.tabId);events.push('finish'+r.language);return {};}
 },request:async()=>undefined});
 const first=capture(input),second=capture({...input,language:'en'}),other=capture({...input,tabId:11,language:'ja'});
 assert.equal((await other).language,'ja');release();await Promise.all([first,second]);
 assert.ok(events.indexOf('finishzh-TW')<events.indexOf('starten'));assert.equal(active.size,0);
});

test('a partially failing caption activation still closes the module loaded by recovery',async()=>{
 const w=world(),load=w.player.loadModule;w.player.loadModule=()=>{load();throw Error('partially activated');};
 assert.equal((await start(w)).started,false);assert.equal(w.state.enabled,false);assert.equal(w.context.fetch,w.originalFetch);assert.equal(w.timers.size,0);
});

test('failure to restore the old track cannot prevent closing originally disabled captions',async()=>{
 const w=world();await start(w);const set=w.player.setOption;w.player.setOption=(m,k,v)=>{if(k==='track'&&v.vssId===en.vssId)throw Error('old track no longer accepted');return set(m,k,v);};
 const result=await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);assert.equal(w.context.fetch,w.originalFetch);assert.equal(result.restored,false);assert.equal(w.errors.length,1);
});

test('pagehide restores the same video before a possible BFCache return',async()=>{
 const w=world();await start(w);w.input({type:'pagehide'});await w.flush();assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.context.fetch,w.originalFetch);
});

test('the installed XHR prototype is cleaned even when the page replaces its constructor',async()=>{
 const w=world({xhr:true});await start(w);const oldPrototype=w.context.XMLHttpRequest.prototype;
 w.context.XMLHttpRequest=class Replacement{};await w.run({action:'finish',token:'one'});assert.equal(oldPrototype.open,w.originalOpen);assert.equal(oldPrototype.send,w.originalSend);
});

test('unfinished caption response readers are cancelled during cleanup',async()=>{
 let cancelCount=0,finishRead;
 const reader={read:()=>new Promise(resolve=>{finishRead=resolve;}),cancel:async()=>{cancelCount++;finishRead?.({done:true});}};
 const w=world({makeResponse:()=>({ok:true,headers:{get:()=>null},clone:()=>({body:{getReader:()=>reader}})})});
 await start(w);await w.flush();await w.run({action:'finish',token:'one'});assert.ok(cancelCount>0);assert.equal(w.context.fetch,w.originalFetch);
});

test('automatic and manual captions are not confused during recovery',async()=>{
 const automatic=track('a.en','en',{kind:'asr',baseUrl:en.baseUrl+'&kind=asr'}),w=world({tracks:[en,automatic]});
 const result=await w.run({action:'start',token:'one',language:'en',automatic:true,selector:{...selector,pageTrackId:'a.en'}});assert.equal(result.started,true);await w.flush();assert.ok((await w.run({action:'poll',token:'one'})).raw);assert.equal(w.state.active.kind,'asr');await w.run({action:'finish',token:'one'});
});

test('signed request lookup requires the current document and a fresh matching caption request',async()=>{
 const previous=globalThis.chrome;let listener;const now=Date.now(),values={youtubeCaptionRequests:[{tabId:10,documentId:'doc-one',videoId:ID,language:'zh-tw',automatic:false,captionName:'',time:now-1000,url:'https://www.youtube.com/api/timedtext?old'}]};
 const onBeforeRequest={addListener:fn=>{listener=fn;},removeListener:fn=>{if(listener===fn)listener=undefined;}};
 globalThis.chrome={webRequest:{onBeforeRequest},storage:{session:{get:async()=>structuredClone(values),set:async v=>Object.assign(values,v)}}};
 try{
  const {beginYoutubeCaptionObservation,endYoutubeCaptionObservation,youtubeCaptionRequest}=await import('../extension/youtube-captions.js?assist-test');assert.equal(listener,undefined);
  const observation=beginYoutubeCaptionObservation(10),selected={...selector,documentId:'doc-one'};assert.equal(typeof listener,'function');
  assert.equal(await youtubeCaptionRequest(10,selected,'zh-TW',false,now),undefined);
  const url=`https://www.youtube.com/api/timedtext?v=${ID}&lang=zh-TW&pot=fresh`;
  listener({tabId:10,documentId:'doc-one',frameId:0,url,method:'GET'});
  assert.equal(await youtubeCaptionRequest(10,selected,'zh-TW',false,now),url);
  assert.equal(await youtubeCaptionRequest(10,{...selected,documentId:'other'},'zh-TW',false,now),undefined);
  assert.equal(await youtubeCaptionRequest(10,selected,'en',false,now),undefined);
  await endYoutubeCaptionObservation(10,observation);assert.equal(listener,undefined);
 }finally{globalThis.chrome=previous;}
});

test('a late native activation after the first close is compensated before finishing',async()=>{
 const w=world(),set=w.player.setOption;let delayed=false;
 w.player.setOption=(module,option,value)=>{
  const result=set(module,option,value);
  if(option==='track'&&value.vssId===zh.vssId&&!delayed){delayed=true;w.context.setTimeout(()=>{w.state.enabled=true;w.state.active=structuredClone(zh);},350);}
  return result;
 };
 await start(w);await w.run({action:'finish',token:'one'});
 await new Promise(resolve=>w.context.setTimeout(resolve,500));
 assert.equal(w.state.enabled,false,'late activation must not leave originally closed captions enabled');
});

test('Promise-based module activation settles before setting the selected caption',async()=>{
 const w=world(),load=w.player.loadModule;let release;
 w.player.loadModule=()=>new Promise(resolve=>{release=()=>{load();resolve();};});
 const starting=start(w);await w.flush();assert.equal(w.calls.some(c=>c[0]==='track'),false);
 release();assert.equal((await starting).started,true);await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('a timed-out void activation that arrives while restoring is still turned back off',async()=>{
 const w=world({apply:false}),load=w.player.loadModule;
 w.player.loadModule=()=>{w.context.setTimeout(load,1700);};
 assert.equal((await start(w)).started,false);await new Promise(resolve=>w.context.setTimeout(resolve,500));
 assert.equal(w.state.enabled,false);assert.equal(w.assist(),undefined);
});

test('a transient empty active track does not discard the original closed-state restoration',async()=>{
 const w=world({nativeBody:''});await start(w);w.state.active={};
 assert.equal((await w.run({action:'poll',token:'one'})).cancelled,undefined);await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('duplicate finish calls share restoration and new capture cannot enter until it finishes',async()=>{
 const w=world({enabled:true}),set=w.player.setOption;await start(w);let release;
 w.player.setOption=(module,option,value)=>option==='track'&&value.vssId===en.vssId?new Promise(resolve=>{release=()=>{set(module,option,value);resolve();};}):set(module,option,value);
 const first=w.run({action:'finish',token:'one'});await w.flush();
 const state=w.assist(),promise=state.finishPromise;
 assert.equal(state.phase,'restoring');const second=w.run({action:'finish',token:'one'});await w.flush();assert.equal(state.finishPromise,promise);
 assert.equal((await w.run({action:'start',token:'two',language:'zh-TW',automatic:false,selector})).started,false);
 release();await Promise.all([first,second]);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.state.enabled,true);assert.equal(w.assist(),undefined);
});

test('a delayed void restoration restores the original language and translation',async()=>{
 const previous={...en,translationLanguage:{languageCode:'fr'}},w=world({enabled:true,active:previous}),set=w.player.setOption;await start(w);
 w.player.setOption=(module,option,value)=>{if(option==='track'&&value.vssId===en.vssId){w.context.setTimeout(()=>set(module,option,value),400);return;}return set(module,option,value);};
 await w.run({action:'finish',token:'one'});assert.deepEqual(w.state.active,previous);assert.equal(w.state.enabled,true);
});

test('manual caption choice during the restoration guard remains authoritative',async()=>{
 const japanese=track('ja','ja'),w=world({tracks:[en,zh,japanese]});await start(w);const finishing=w.run({action:'finish',token:'one'});await w.flush();
 assert.equal(w.assist().phase,'restoring');
 w.input(menuChoice('ja'));w.state.enabled=true;w.state.active=japanese;
 await finishing;await new Promise(resolve=>w.context.setTimeout(resolve,500));assert.equal(w.state.enabled,true);assert.equal(w.state.active.languageCode,'ja');
});

test('opening settings alone restores instead of leaving temporary captions open',async()=>{
 const w=world();await start(w);
 w.input({type:'pointerdown',isTrusted:true,target:{closest:selector=>selector==='.ytp-settings-button'?{}:null}});
 await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('copy shortcuts are not mistaken for the YouTube caption toggle',async()=>{
 const w=world();await start(w);w.input({type:'keydown',key:'c',ctrlKey:true,isTrusted:true,target:{closest:()=>null}});
 assert.equal(w.assist().phase,'capturing');await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);
});

test('a lost start response still attempts cleanup using the same token',async()=>{
 const actions=[];let token;
 const capture=createYoutubeCaptionReader({read:async()=>{throw failure();},command:async(_input,options)=>{actions.push(options.action);if(options.action==='start'){token=options.token;throw Error('response lost');}assert.equal(options.token,token);return {finished:true};},request:async()=>undefined});
 await assert.rejects(capture(input),{code:'YT_RECOVERY_UNAVAILABLE'});assert.deepEqual(actions,['start','finish']);
});

test('an older pending restoration cannot override a later manual language choice',async()=>{
 const japanese=track('ja','ja'),w=world({enabled:true,tracks:[en,zh,japanese]}),set=w.player.setOption;await start(w);let release;
 w.player.setOption=(module,option,value)=>option==='track'&&value.vssId===en.vssId?new Promise(resolve=>{release=()=>{set(module,option,value);resolve();};}):set(module,option,value);
 const finishing=w.run({action:'finish',token:'one'});await w.flush();assert.equal(typeof release,'function');
 w.input(menuChoice('ja'));w.state.enabled=true;w.state.active=japanese;release();
 await finishing;assert.equal(w.state.enabled,true);assert.equal(w.state.active.vssId,'ja');assert.equal(w.errors.length,0);
});

test('a manual toggle is preserved when an in-flight activation resolves later',async()=>{
 const w=world(),set=w.player.setOption;let release;
 w.player.setOption=(module,option,value)=>option==='track'&&value.vssId===zh.vssId?new Promise(resolve=>{release=()=>{w.state.enabled=true;set(module,option,value);resolve();};}):set(module,option,value);
 const starting=start(w);await w.flush();assert.equal(w.state.enabled,true);
 w.input({type:'pointerdown',isTrusted:true,target:{closest:selector=>selector.includes('.ytp-subtitles-button')?{}:null}});w.state.enabled=false;release();
 assert.equal((await starting).started,false);await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);assert.equal(w.errors.length,0);
});

test('originally closed captions also restore a known language when track writes are delayed',async()=>{
 const w=world(),set=w.player.setOption,unload=w.player.unloadModule;await start(w);
 w.player.unloadModule=()=>{unload();w.state.active={};};
 w.player.setOption=(module,option,value)=>{if(option==='track'&&value.vssId===en.vssId){w.context.setTimeout(()=>set(module,option,value),400);return;}return set(module,option,value);};
 const result=await w.run({action:'finish',token:'one'});assert.equal(result.restored,true);assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.errors.length,0);
});

test('an audio-language menu is not mistaken for a caption-language choice',async()=>{
 const w=world();await start(w);w.input(menuChoice('en-main','Audio track'));
 await w.run({action:'finish',token:'one'});assert.equal(w.state.enabled,false);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.errors.length,0);
});

test('a manual toggle with no original track keeps the language chosen by the native player',async()=>{
 const w=world({active:{}}),unload=w.player.unloadModule;await start(w);
 w.player.unloadModule=()=>{unload();w.state.active={};};const finishing=w.run({action:'finish',token:'one'});await w.flush();assert.equal(w.state.enabled,false);
 w.input({type:'pointerdown',isTrusted:true,target:{closest:selector=>selector.includes('.ytp-subtitles-button')?{}:null}});w.state.enabled=true;w.state.active=en;
 const result=await finishing;assert.equal(result.restored,true);assert.equal(w.state.enabled,true);assert.equal(w.state.active.vssId,en.vssId);assert.equal(w.errors.length,0);
});

test('a closed module reveals and preserves the language that will be used on reopening',async()=>{
 const french=track('fr','fr'),w=world({active:{},remembered:french,tracks:[en,zh,french]}),unload=w.player.unloadModule;
 w.player.unloadModule=()=>{unload();w.state.active={};};
 assert.equal((await start(w)).started,true);assert.equal(w.state.active.languageCode,'zh-TW');
 assert.equal((await w.run({action:'finish',token:'one'})).restored,true);assert.equal(w.state.enabled,false);
 w.player.loadModule('captions');assert.equal(w.state.active.languageCode,'fr');assert.equal(w.state.remembered.languageCode,'fr');
});

test('an unidentifiable remembered language aborts without choosing a different track',async()=>{
 const w=world({active:{},revealTrack:false});assert.equal((await start(w)).started,false);
 assert.equal(w.calls.some(call=>call[0]==='track'),false);assert.equal(w.state.enabled,false);assert.equal(w.errors.length,0);
});

test('a remembered automatic translation is preserved after reopening originally closed captions',async()=>{
 const translated={...en,translationLanguage:{languageCode:'ja'}},w=world({active:{},remembered:translated}),unload=w.player.unloadModule;
 w.player.unloadModule=()=>{unload();w.state.active={};};await start(w);await w.run({action:'finish',token:'one'});w.player.loadModule('captions');
 assert.equal(w.state.active.languageCode,'en');assert.equal(w.state.active.translationLanguage.languageCode,'ja');
});
