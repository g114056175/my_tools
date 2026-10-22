import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { mediaSchemaFixtures } from "./fixtures/media-schema-contract.mjs";
import { extractMediaModels } from "../extension/media-models.js";
import { installMediaObserver } from "../extension/media-observer-source.js";

const partsOf = fixture => fixture.parts || [{value: fixture.value, baseUrl: "https://social.example.test/video/contract"}];
const pageFor = fixture => fixture.name.startsWith("X ") ? "https://x.com/example/status/contract" : fixture.name.startsWith("Facebook") ? "https://www.facebook.com/reel/contract" : fixture.name.startsWith("TikTok") ? "https://www.tiktok.com/@example/video/contract" : fixture.name.startsWith("Instagram") ? "https://www.instagram.com/reel/contract" : "https://social.example.test/video/contract";
const baseline = fixture => partsOf(fixture).flatMap(part => extractMediaModels(part.value, {baseUrl: part.baseUrl}));
function selectedIdentity(fixture) { if (fixture.name === "X quoted video_info") return "x-quoted-media"; const model = baseline(fixture).find(item => item.versions?.length || item.manifestUrl); return model?.id || model?.aliases?.[0]; }
function expectedModel(fixture) { const id = selectedIdentity(fixture); return baseline(fixture).find(model => model.aliases.includes(id)) || baseline(fixture).find(model => model.versions?.length || model.manifestUrl); }

function targetFor(fixture) {
  class FakeResponse { constructor(url, value, type = "application/json") { this.url=url; this.value=value; this.status=200; this.ok=true; this.headers={get:key=>key.toLowerCase()==="content-type"?type:""}; } json(){return Promise.resolve(typeof this.value === "string" ? JSON.parse(this.value) : this.value);} text(){return Promise.resolve(typeof this.value === "string" ? this.value : JSON.stringify(this.value));} }
  class FakeXHR { constructor(){this.listeners={};this.status=200;this.responseType="text";} addEventListener(type,fn){this.listeners[type]=fn;} open(_method,url){this.url=this.responseURL=url;} send(){this.responseText=this.payload;this.response=this.payload;this.getResponseHeader=name=>name.toLowerCase()==="content-type"?"application/json":"";this.listeners.load?.();} }
  class WorkerMock { constructor(){this.listeners={};} addEventListener(type,fn){this.listeners[type]=fn;} removeEventListener(type,fn){if(this.listeners[type]===fn)delete this.listeners[type];} receive(value){this.listeners.message?.({data:value});} }
  return {JSON:{parse:JSON.parse,stringify:JSON.stringify},Response:FakeResponse,XMLHttpRequest:FakeXHR,Worker:WorkerMock,location:{href:pageFor(fixture)},document:{documentElement:null,querySelectorAll:()=>[]},setTimeout,clearTimeout,URL,TextEncoder,TextDecoder};
}

function videoFor(fixture) { const id=selectedIdentity(fixture); const video={currentSrc:"blob:contract",src:"",nodeType:1,getAttribute:()=>"",closest:()=>null,__reactProps$test:{videoId:id,videoID:id}}; video.ownerDocument={querySelectorAll:selector=>selector==="video"?[video]:[]}; return video; }
function assertSelected(fixture,observer,video) {
  const expected=expectedModel(fixture),id=selectedIdentity(fixture),model=observer.modelFor(video,{drain:false});
  assert.ok(model,`${fixture.name}: modelFor did not resolve ${id}`); assert.ok(model.aliases.includes(id),`${fixture.name}: identity was lost`);
  for(const item of expected?.versions||[])assert.ok(model.versions.some(version=>version.url===item.url),`${fixture.name}: source URL lost: ${item.url}`);
  if(expected?.manifestUrl)assert.equal(model.manifestUrl,expected.manifestUrl,`${fixture.name}: manifest URL`); if(expected?.duration!==undefined)assert.equal(model.duration,expected.duration,`${fixture.name}: duration`); if(expected?.height!==undefined)assert.equal(model.height,expected.height,`${fixture.name}: height`); if(expected?.title)assert.equal(model.title,expected.title,`${fixture.name}: title`);
  const allowed=new Set((fixture.name === "X broadcast metadata and playback" ? baseline(fixture) : [expected]).flatMap(item=>[...(item?.versions||[]).map(version=>version.url),...(item?.manifestUrl ? [item.manifestUrl] : [])]));for(const candidate of observer.sourcesFor(video).candidates)assert.ok(allowed.has(candidate.url),`${fixture.name}: borrowed ${candidate.url}`);
  if(fixture.name==="X quoted video_info")assert.ok(model.aliases.includes("x-quoted-media")&&!model.aliases.includes("x-outer-media"),"quoted model borrowed outer identity");
}
async function analyticsAfter(target){for(let i=0;i<80;i++){await new target.Response(`${target.location.href}/analytics/${i}`,{event:{kind:"view",counter:i}}).json();await new target.Response(`${target.location.href}/analytics-text/${i}`,JSON.stringify({event:{kind:"view",counter:i}})).text();}}
async function runEntry(fixture,entry){const target=targetFor(fixture);target.JSON={parse:JSON.parse};const observer=installMediaObserver(target),video=videoFor(fixture),part=partsOf(fixture)[0];try{const url=part.baseUrl||target.location.href;if(entry==="json-small")target.JSON.parse(JSON.stringify(part.value));if(entry==="json-large")target.JSON.parse(JSON.stringify({envelope:part.value,noise:"x".repeat(270*1024)}));if(entry==="response-json")await new target.Response(url,JSON.stringify(part.value)).json();if(entry==="response-text")await new target.Response(url,JSON.stringify(part.value)).text();if(entry==="xhr"){const xhr=new target.XMLHttpRequest();xhr.payload=JSON.stringify(part.value);xhr.responseType="text";xhr.open("GET",url);xhr.send();}if(entry==="worker")new target.Worker("worker.js").receive(part.value);await analyticsAfter(target);observer.drainMetadata(16,undefined,video);assertSelected(fixture,observer,video);}finally{observer.dispose();}}

for(const fixture of mediaSchemaFixtures)for(const entry of ["json-small","json-large","response-json","response-text","xhr",...(fixture.worker===false?[]:["worker"])]){if(fixture.parts)continue;test(`media pipeline contract: ${fixture.name} via ${entry}`,async()=>runEntry(fixture,entry));}
test("media pipeline contract: broadcast Response keeps mapping and playback base URLs",async()=>{const fixture=mediaSchemaFixtures.find(item=>item.name==="X broadcast metadata and playback"),target=targetFor(fixture);target.JSON={parse:JSON.parse};const observer=installMediaObserver(target),video=videoFor(fixture);try{for(const part of fixture.parts)await new target.Response(part.baseUrl,JSON.stringify(part.value)).json();await analyticsAfter(target);observer.drainMetadata(16,undefined,video);assertSelected(fixture,observer,video);}finally{observer.dispose();}});
const bundle = await fs.readFile(new URL("../extension/media-observer.js",import.meta.url),"utf8");
function bundleContext(href) {
  const context = vm.createContext({URL,TextEncoder,TextDecoder,WeakRef,setTimeout,clearTimeout});
  context.href=href;
  vm.runInContext(`
    globalThis.location={href,hostname:new URL(href).hostname};
    globalThis.Response=class Response {
      constructor(url,body){this.url=url;this.bodyText=body;this.ok=true;this.status=200;this.headers={get:()=>"application/json"};}
      json(){return Promise.resolve(JSON.parse(this.bodyText));}
    };
  `,context);
  vm.runInContext(bundle,context);
  return context;
}
function bundledResult(context,id) {
  context.selectedId=id;
  return vm.runInContext(`
    const video={currentSrc:'blob:bundle',src:'',nodeType:1,getAttribute:()=>'',closest:()=>null,__reactProps$test:{videoId:selectedId}};
    video.ownerDocument={querySelectorAll:s=>s==='video'?[video]:[]};
    const observer=globalThis[Symbol.for('video-pocket.mediaObserver')];
    observer.drainMetadata(16,undefined,video);
    const result=observer.modelFor(video,{drain:false});
    observer.dispose();
    JSON.stringify(result);
  `,context);
}

for(const name of ["Facebook response delivery","TikTok PlayAddrStruct and bitrateInfo","Instagram video_versions","Threads video_versions","X ordinary video_info","X quoted video_info"]){
  test(`media pipeline contract: shipped bundle large JSON ${name}`,()=>{
    const fixture=mediaSchemaFixtures.find(item=>item.name===name),context=bundleContext(pageFor(fixture));
    // Only the targeted-copy entry is supplied. No small JSON or Response leg
    // may rescue a broken large-copy filter. Objects use the VM's own realm.
    context.payload=JSON.stringify({envelope:fixture.value,noise:'x'.repeat(270*1024)});
    vm.runInContext(`JSON.parse(payload);for(let i=0;i<80;i++)JSON.parse(JSON.stringify({event:{counter:i,duration:3,url:'https://metrics.example/pixel'}}));`,context);
    const model=JSON.parse(bundledResult(context,selectedIdentity(fixture)));
    const expected=expectedModel(fixture);
    assert.ok(model,`${name}: bundle lost selected model`);
    assert.ok(model.aliases.includes(selectedIdentity(fixture)));
    assert.deepEqual(model.versions.map(v=>v.url),expected.versions.map(v=>v.url));
    assert.equal(model.manifestUrl,expected.manifestUrl);
    if(expected.duration!==undefined)assert.equal(model.duration,expected.duration);
    if(expected.title)assert.equal(model.title,expected.title);
  });
}
test("media pipeline contract: shipped bundle split broadcast responses",async()=>{
  const fixture=mediaSchemaFixtures.find(item=>item.name==='X broadcast metadata and playback');
  const context=bundleContext(pageFor(fixture));
  for(const part of fixture.parts){
    context.responseUrl=part.baseUrl;context.responseBody=JSON.stringify(part.value);
    await vm.runInContext('new Response(responseUrl,responseBody).json()',context);
  }
  await vm.runInContext(`(async()=>{for(let i=0;i<80;i++)await new Response(location.href+'/analytics',JSON.stringify({event:{counter:i}})).json();})()`,context);
  const model=JSON.parse(bundledResult(context,'28_contract'));
  assert.equal(model?.manifestUrl,'https://cdn.example.test/broadcast-contract.m3u8');
  assert.ok(model.aliases.includes('broadcast-contract'));
});
