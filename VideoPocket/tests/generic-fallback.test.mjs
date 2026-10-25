import test from 'node:test';
import assert from 'node:assert/strict';
import {genericFallbackEligible,genericEmbedPlatform,createGenericFallback,earlyPlayerPlatform} from '../extension/generic-fallback.js';
import {classifyFailure} from '../extension/diagnostics.js';
import {stableHash} from '../extension/download-identity.js';

const descriptor={tabId:1,frameId:0,documentId:'doc',mediaKey:7,referer:'https://unknown.example/watch',title:'影片 1'};
const noSource=()=>Object.assign(new Error('no source'),{code:'SOURCE_UNAVAILABLE'});
const proposal=()=>({binding:{mediaKey:7,source:'blob:a',pageUrl:descriptor.referer,fingerprint:'jw:one'},duration:60,candidates:[{url:'https://cdn.test/master.m3u8',kind:'hls'},{url:'https://cdn.test/v.mp4',kind:'progressive'}]});
function make(options={}){
 const calls={primary:[],collect:0,validate:0,forget:[],cancel:[]};const firstError=options.firstError || noSource(),result=options.result || {id:'recovered',title:'影片 1'};
 const instance=createGenericFallback({
  primary:async(d,id)=>{calls.primary.push({d,id});if(calls.primary.length===1&&!options.success)throw firstError;return options.pending?options.pending:result;},
  collect:async(...args)=>{calls.collect++;return options.collect?options.collect(...args):proposal();},
  validate:async(...args)=>{calls.validate++;return options.validate?options.validate(calls.validate,...args):true;},
  forget:async id=>calls.forget.push(id),cancelPrimary:async id=>calls.cancel.push(id),
  hash:stableHash,classify:e=>classifyFailure(e,'inspect'),timeoutMs:options.timeoutMs || 1000,
 });
 return {instance,calls,firstError,result};
}

test('old successes return the identical object with zero new discovery, validation, hashing or probing',async()=>{
 for(const referer of [descriptor.referer,'https://x.com/a/status/1','https://www.youtube.com/watch?v=one']){
  const result=Object.freeze({id:'old',title:'real title',choices:{video:{heights:[1080]}}}),rt=make({success:true,result});
  const resolved=await rt.instance.inspect({...descriptor,referer},'old');
  assert.equal(resolved.result,result);assert.equal(rt.calls.primary.length,1);assert.equal(rt.calls.collect,0);assert.equal(rt.calls.validate,0);assert.deepEqual(rt.calls.cancel,[]);
 }
});

test('all protected platform failures stay on the existing route',async()=>{
 for(const host of ['youtube.com','m.youtube.com','youtu.be','youtube-nocookie.com','bilibili.com','b23.tv','x.com','twitter.com','facebook.com','fb.watch','instagram.com','threads.net','threads.com','tiktok.com','twitch.tv','clips.twitch.tv','reddit.com','redd.it','dailymotion.com','vimeo.com','anime1.me','ani.gamer.com.tw']){
  const rt=make();await assert.rejects(rt.instance.inspect({...descriptor,referer:'https://'+host+'/watch'},host),e=>e===rt.firstError);
  assert.equal(rt.calls.collect,0,host);assert.equal(rt.calls.primary.length,1);
 }
 for(const site of ['youtube','bilibili','x','twitch-clip','facebook','instagram','tiktok','dailymotion'])assert.equal(genericFallbackEligible({...descriptor,platform:{site}}),false);
});

test('only exact scoped HTTP player descriptors are eligible',()=>{
 assert.equal(genericFallbackEligible(descriptor),true);
 for(const patch of [{tabId:null},{frameId:null},{documentId:''},{mediaKey:null},{referer:'file:///clip'},{referer:'https://u:p@unknown.test'},{drm:true}])assert.equal(genericFallbackEligible({...descriptor,...patch}),false);
 assert.equal(genericFallbackEligible({...descriptor,referer:'https://youtube.com.evil.example/'}),true);
});

test('auth, DRM, cancellation, changes and transport errors are never rescued',async()=>{
 for(const code of ['HTTP_AUTH','DRM_UNSUPPORTED','CANCELLED','SOURCE_CHANGED','NETWORK_TIMEOUT','HTTP_RATE_LIMIT','HTTP_NOT_FOUND','INTERNAL_ERROR']){
  const rt=make({firstError:Object.assign(new Error(code),{code})});
  await assert.rejects(rt.instance.inspect(descriptor,code),e=>e===rt.firstError);assert.equal(rt.calls.collect,0);
 }
 const rt=make({firstError:Object.assign(noSource(),{httpStatus:403})});await assert.rejects(rt.instance.inspect(descriptor,'auth'),e=>e===rt.firstError);assert.equal(rt.calls.collect,0);
});

test('owned alternatives reuse existing media probing with one scoped player group',async()=>{
 const original=structuredClone(descriptor),p=proposal(),rt=make({collect:()=>p});
 const recovered=await rt.instance.inspect(descriptor,'new');
 assert.equal(recovered.result,rt.result);assert.equal(rt.calls.primary.length,2);assert.equal(rt.calls.validate,2);
 const d=rt.calls.primary[1].d;assert.equal(d.title,descriptor.title);assert.equal(d.mediaKey,7);assert.equal(d.platform.site,'network-media');assert.equal(d.platform.expectedDuration,60);
 assert.equal(d.platform.versions[0].candidateGroup,d.platform.versions[1].candidateGroup);
 assert.deepEqual(d.platform.versions[0].candidateGroup.scope,{tabId:1,frameId:0,documentId:'doc'});
 assert.deepEqual(descriptor,original);assert.equal(p.candidates[0].candidateGroup,undefined);
});

test('an empty or incomplete fallback preserves the exact original failure',async()=>{
 for(const collect of [()=>({valid:false}),()=>({...proposal(),duration:0}),()=>({...proposal(),candidates:[]}),()=>{throw new Error('not a source');}]){
  const rt=make({collect});await assert.rejects(rt.instance.inspect(descriptor,'empty'),e=>e===rt.firstError);assert.equal(rt.calls.primary.length,1);
 }
});

test('replacement before probing and while probing never returns the recovered source',async()=>{
 const before=make({validate:()=>false});await assert.rejects(before.instance.inspect(descriptor,'before'),{code:'SOURCE_CHANGED'});assert.equal(before.calls.primary.length,1);
 const after=make({validate:n=>n!==2});await assert.rejects(after.instance.inspect(descriptor,'after'),{code:'SOURCE_CHANGED'});assert.deepEqual(after.calls.forget,['recovered']);
});

test('fallback has an independent timeout even if collection never resolves',async()=>{
 const rt=make({timeoutMs:15,collect:()=>new Promise(()=>{})}),start=performance.now();
 await assert.rejects(rt.instance.inspect(descriptor,'timeout'),e=>e===rt.firstError);
 assert.ok(performance.now()-start<500);assert.deepEqual(rt.calls.cancel,['timeout']);
});

test('cancel before and during fallback stops further probes',async()=>{
 const rt=make();rt.instance.cancel('early');await assert.rejects(rt.instance.inspect(descriptor,'early'),{code:'CANCELLED'});assert.equal(rt.calls.collect,0);
 const active=make({collect:()=>new Promise(()=>{})}),pending=active.instance.inspect(descriptor,'active');
 await new Promise(r=>setImmediate(r));active.instance.cancel('active');await assert.rejects(pending,{code:'CANCELLED'});assert.equal(active.calls.primary.length,1);
});

test('a probe result arriving after timeout is forgotten',async()=>{
 let complete;const pending=new Promise(resolve=>{complete=resolve;}),rt=make({pending,timeoutMs:15});
 await assert.rejects(rt.instance.inspect(descriptor,'late'),e=>e===rt.firstError);
 complete({id:'late-source'});await new Promise(r=>setImmediate(r));assert.deepEqual(rt.calls.forget,['late-source']);
});

test('embed delegation recognizes only exact supported player URLs',()=>{
 assert.deepEqual(genericEmbedPlatform('https://clips.twitch.tv/embed?clip=OwnedClip'),{site:'twitch-clip',slug:'OwnedClip'});
 assert.deepEqual(genericEmbedPlatform('https://player.twitch.tv/?video=v12345'),{site:'twitch',id:'12345'});
 assert.deepEqual(genericEmbedPlatform('https://www.dailymotion.com/embed/video/x12345'),{site:'dailymotion',id:'x12345'});
 for(const url of ['https://clips.twitch.tv.evil.test/OwnedClip','http://clips.twitch.tv/OwnedClip','https://u:p@clips.twitch.tv/OwnedClip','https://youtube.com/watch?v=one','https://unknown.test/embed/one'])assert.equal(genericEmbedPlatform(url),null);
});

test('a uniquely owned embed is passed to the existing adapter',async()=>{
 const rt=make({collect:()=>({...proposal(),candidates:[{embedUrl:'https://player.twitch.tv/?video=v123'}]})});
 await rt.instance.inspect(descriptor,'embed');assert.deepEqual(rt.calls.primary[1].d.platform,{site:'twitch',id:'123'});
 const ambiguous=make({collect:()=>({...proposal(),candidates:[{embedUrl:'https://player.twitch.tv/?video=v123'},{embedUrl:'https://player.twitch.tv/?video=v456'}]})});
 await assert.rejects(ambiguous.instance.inspect(descriptor,'ambiguous'),e=>e===ambiguous.firstError);assert.equal(ambiguous.calls.primary.length,1);
});

test('early routing admits only one owned JW/JSON-LD source and leaves existing platforms and multi-version players alone',()=>{
 const base=proposal(),p={...base,valid:true,parser:'jwplayer',candidates:base.candidates.slice(0,1)};
 const platform=earlyPlayerPlatform(descriptor,p,stableHash);
 assert.equal(platform.binding,'generic-early');assert.equal(platform.versions.length,1);assert.equal(platform.earlyPlan.descriptor.mediaKey,7);
 for(const patch of [{parser:'videojs'},{parser:'data-setup'},{valid:false},{duration:Infinity},{candidates:base.candidates},{binding:{...p.binding,mediaKey:8}},{binding:{...p.binding,source:'https://cdn.test/live.mp4'}}])assert.equal(earlyPlayerPlatform(descriptor,{...p,...patch},stableHash),null);
 assert.equal(earlyPlayerPlatform({...descriptor,platform:{site:'embedded'}},p,stableHash),null);
 assert.equal(earlyPlayerPlatform({...descriptor,referer:'https://x.com/a/status/1'},p,stableHash),null);
});

test('prepared early sources skip primary discovery but are revalidated before and after the media probe',async()=>{
 const p={...proposal(),valid:true,parser:'jwplayer',candidates:proposal().candidates.slice(0,1)},platform=earlyPlayerPlatform(descriptor,p,stableHash),rt=make({success:true});
 const value=await rt.instance.inspect({...descriptor,platform},'prepared');
 assert.equal(rt.calls.primary.length,1);assert.equal(rt.calls.collect,0);assert.equal(rt.calls.validate,2);assert.equal(value.genericPlan.mode,'early');assert.equal(value.result,rt.result);
 const replaced=make({success:true,validate:()=>false});await assert.rejects(replaced.instance.inspect({...descriptor,platform},'changed'),{code:'SOURCE_CHANGED'});assert.equal(replaced.calls.primary.length,0);
});

test('a failed early probe does not expand into six candidates and fallback can explicitly avoid another generic retry',async()=>{
 const p={...proposal(),valid:true,parser:'jwplayer',candidates:proposal().candidates.slice(0,1)},platform=earlyPlayerPlatform(descriptor,p,stableHash),rt=make();
 await assert.rejects(rt.instance.inspect({...descriptor,platform},'early-failure'),{code:'SOURCE_UNAVAILABLE'});assert.equal(rt.calls.primary.length,1);assert.equal(rt.calls.collect,0);
 const fallback=make();await assert.rejects(fallback.instance.inspect(descriptor,'full-failure',{skipFallback:true}),e=>e===fallback.firstError);assert.equal(fallback.calls.collect,0);
});
