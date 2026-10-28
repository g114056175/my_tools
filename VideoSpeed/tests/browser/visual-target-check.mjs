import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {access,mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),extension=path.join(root,'extension');
const stage=process.env.VIDEOSPEED_VISUAL_STAGE||'candidate';
assert.ok(['baseline','candidate','candidate-brave'].includes(stage),'VISUAL_TARGET_STAGE must be baseline, candidate or candidate-brave');
const output=path.join(root,'work/qa-080-visual',stage);await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
const expectedVersion=stage==='baseline'?'0.6.17':manifest.version;
assert.equal(manifest.version,expectedVersion,`${stage} run requires extension ${expectedVersion}`);
const media=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
const allowedHosts=new Set(['media.example.test','embed.example.test','www.facebook.com','www.youtube.com','www.bilibili.com']);

async function runtimeHash(){
 const files=[];
 async function visit(folder){for(const item of await readdir(folder,{withFileTypes:true})){const name=path.join(folder,item.name);if(item.isDirectory())await visit(name);else files.push(path.relative(extension,name).replaceAll('\\','/'));}}
 await visit(extension);const hash=createHash('sha256');
 for(const name of files.sort()){hash.update(name);hash.update('\0');hash.update(await readFile(path.join(extension,name)));hash.update('\0');}
 return hash.digest('hex');
}

function childFixture(){
 return `<!doctype html><meta charset="utf-8"><title>Nested frame media</title>
 <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}video{display:block;width:900px;height:500px}</style>
 <video id="frame-video" data-start="playing" muted loop playsinline preload="auto"></video>
 <script>(()=>{window.qa={io:null,ready:false};const v=document.querySelector('video');v.muted=true;v.loop=true;v.playsInline=true;v.src='/tiny.webm?frame=child';const io=new IntersectionObserver(entries=>{window.qa.io={ratio:entries[0].intersectionRatio,area:entries[0].intersectionRect.width*entries[0].intersectionRect.height};});io.observe(v);v.play().catch(()=>{});window.qa.ready=true;})();</script>`;
}

function fixture(url){
 const kind=url.searchParams.get('case')||'priority';let markup='',css='',bodyClass='';
 const video=(id,start='paused')=>`<video id="${id}" data-start="${start}" muted loop playsinline preload="auto"></video>`;
 if(kind==='known-yt'){
  markup=`<div id="movie_player" class="html5-video-player">${video('main')}</div><div id="preview-card"><ytd-video-preview>${video('preview','playing')}</ytd-video-preview></div>`;
  css='#movie_player{position:fixed;left:50%;top:100px;transform:translateX(-50%)}#movie_player video{width:900px;height:506px}#preview-card{position:fixed;right:20px;bottom:20px;width:180px;height:100px}#preview-card video{width:180px;height:100px}';
 }else if(kind==='known-bili'){
  markup=`<div id="bilibili-player" class="bpx-player-container">${video('main')}</div><div class="bili-video-card">${video('preview','playing')}</div>`;
  css='#bilibili-player{position:fixed;left:50%;top:100px;transform:translateX(-50%)}#bilibili-player video{width:900px;height:506px}.bili-video-card{position:fixed;right:20px;bottom:20px;width:180px;height:100px}.bili-video-card video{width:180px;height:100px}';
 }else if(kind==='scroll'){
  markup=`<div id="feed-spacer"></div><article id="post-a">${video('post-a-video','playing')}</article><article id="post-b">${video('post-b-video')}</article>`;
  css='body{height:2000px}#feed-spacer{height:1px}article{position:absolute;left:50%;transform:translateX(-50%)}#post-a{top:80px}#post-b{top:1120px}article video{width:640px;height:360px}';
 }else if(kind==='manual'){
  markup=`<div id="main-card">${video('main')}</div><div id="small-card">${video('small')}</div>`;
  css='#main-card{position:fixed;left:50%;top:100px;transform:translateX(-50%)}#main-card video{width:900px;height:506px}#small-card{position:fixed;right:20px;bottom:20px;width:180px;height:100px}#small-card video{width:180px;height:100px}';
 }else if(kind==='clip'){
  markup=`<div id="main-card">${video('main')}</div><div id="clip-box">${video('edge','playing')}</div>`;
  css='#main-card{position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:1}#main-card video{width:640px;height:360px}#clip-box{position:fixed;left:0;top:100px;width:6px;height:540px;overflow:hidden;z-index:2}#clip-box video{width:960px;height:540px}';
 }else if(kind==='frame'||kind==='cross-origin-frame'){
  const frameSrc=kind==='cross-origin-frame'?'http://embed.example.test/frame-child':'/frame-child';
  markup=`<div id="main-card">${video('main')}</div><iframe id="offscreen-frame" src="${frameSrc}" title="Offscreen media" scrolling="no"></iframe>`;
  css='body{height:2400px}#main-card{position:absolute;left:50%;top:100px;transform:translateX(-50%)}#main-card video{width:640px;height:360px}#offscreen-frame{position:absolute;left:100px;top:1300px;width:1000px;height:620px;border:0}';
 }else if(kind==='stability'){
  markup=`<div id="candidate-a">${video('candidate-a-video')}</div><div id="candidate-b">${video('candidate-b-video')}</div>`;
  css='#candidate-a,#candidate-b{position:fixed;left:50%;top:120px;transform:translateX(-50%)}#candidate-a{z-index:1}#candidate-b{z-index:2}#candidate-a video{width:640px;height:360px}#candidate-b video{width:620px;height:350px}';
 }else{
  markup=`<div id="main-card">${video('main')}</div><div id="small-card">${video('small','playing')}</div><div id="next-main-card">${video('next-main')}</div>`;
  css='body{height:2200px}#main-card{position:absolute;left:50%;top:100px;transform:translateX(-50%)}#main-card video,#next-main-card video{width:900px;height:506px}#next-main-card{position:absolute;left:50%;top:1120px;transform:translateX(-50%)}#small-card{position:fixed;right:20px;bottom:20px;width:180px;height:100px}#small-card video{width:180px;height:100px}';
 }
 return `<!doctype html><meta charset="utf-8"><title>VideoSpeed visual target fixture: ${kind}</title>
 <style>html,body{margin:0;min-height:100%;font:16px system-ui;scroll-behavior:auto}video{display:block;object-fit:contain;background:#25364a}${css}</style>
 <body>${markup}<script>(()=>{
  window.qa={kind:${JSON.stringify(kind)},ready:false,io:{},frameRatio:null,frameLoaded:false};
  const videos=[...document.querySelectorAll('video')];
  const io=new IntersectionObserver(entries=>{for(const e of entries)window.qa.io[e.target.id]={ratio:e.intersectionRatio,area:e.intersectionRect.width*e.intersectionRect.height,rect:{x:e.boundingClientRect.x,y:e.boundingClientRect.y,width:e.boundingClientRect.width,height:e.boundingClientRect.height}};},{threshold:[0,.005,.01,.05,.1,.25,.5,.75,1]});
  for(const v of videos){io.observe(v);v.muted=true;v.loop=true;v.playsInline=true;v.src='/tiny.webm?video='+encodeURIComponent(v.id)+'&run='+Date.now();if(v.dataset.start==='playing')v.play().catch(()=>{});}
  const frame=document.querySelector('#offscreen-frame');if(frame){frame.addEventListener('load',()=>{window.qa.frameLoaded=true;});const fio=new IntersectionObserver(entries=>window.qa.frameRatio=entries[0].intersectionRatio,{threshold:[0,.01,.1,.5,1]});fio.observe(frame);}
  window.qa.ready=true;
 })();</script></body>`;
}

const runtimeSha256Before=await runtimeHash();
const report={stage,version:manifest.version,runtimeSha256:runtimeSha256Before,runtimeSha256Before,runtimeSha256After:null,browser:{name:stage==='candidate-brave'?'Brave':'Chromium'},checks:[],errors:[],error:null,cleanup:false,
 scope:'Isolated Playwright profile; all web hosts route to local HTML and tiny.webm only.'};
const profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-visual-'));let context,page,serviceWorker;
const rate=1.25;
function close(actual,wanted){return Math.abs(Number(actual)-wanted)<1e-5;}
async function framesSnapshot(){
 const all=[];
 for(const frame of page.frames())try{all.push(...await frame.evaluate(()=>[...document.querySelectorAll('video')].map(v=>({id:v.id,rate:v.playbackRate,paused:v.paused,connected:v.isConnected,registryId:v.getAttribute('data-video-control-id'),rect:(()=>{const r=v.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()}))));}catch{}
 return all;
}
async function screenshot(name){
 const file=path.join(output,name+'.png');try{await page.screenshot({path:file,fullPage:true,timeout:5000});return path.relative(root,file).replaceAll('\\','/');}catch{return null;}
}
async function checkTarget(name,targetIds,untouchedIds=[],extra={}){
 let keyRequestedAt=null,keyCompletedAt=null;
 if(extra.scrollBefore)keyRequestedAt=await page.evaluate(()=>{window.qa.keyRequestedAt=performance.now();return window.qa.keyRequestedAt;});
 await page.keyboard.press('Shift+Period').catch(error=>{extra.keyError=String(error);});
 if(extra.scrollBefore){keyCompletedAt=await page.evaluate(()=>performance.now());extra.scrollHotkeyTiming={scrollToKeyRequestMs:keyRequestedAt-extra.scrollBefore.at,scrollToKeyCompletedMs:keyCompletedAt-extra.scrollBefore.at,scrollToKeyRequestAt:keyRequestedAt,scrollToKeyCompletedAt:keyCompletedAt};}
 await page.waitForTimeout(300);
 const videos=await framesSnapshot();
 const changed=videos.filter(v=>v.rate>1.00001).map(v=>v.id).sort();
 const expectedTargetRate=extra.expectedTargetRate??rate,expectedUnchangedRate=extra.expectedUnchangedRate??1;
 const targeted=targetIds.every(id=>videos.some(v=>v.id===id&&close(v.rate,expectedTargetRate)));
 const untouched=untouchedIds.every(id=>videos.some(v=>v.id===id&&close(v.rate,extra.expectedUnchangedRates?.[id]??expectedUnchangedRate)));
 const pass=targeted&&untouched;
 const item={name,pass,expectedChanged:targetIds,expectedUnchanged:untouchedIds,changed,rateEvidence:videos,extra};
 if(!pass)item.screenshot=await screenshot(name.replaceAll(/[^a-z0-9-]/gi,'-'));
 report.checks.push(item);return item;
}
async function activeTabId(){
 const worker=context.serviceWorkers()[0]||serviceWorker;
 return worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('No active fixture tab');return tab.id;});
}
async function domWalkCounter(tabId,operation){
 const worker=context.serviceWorkers()[0]||serviceWorker;
 const results=await worker.evaluate(async({tabId,operation})=>{
  const instrument=op=>{
   const key=Symbol.for('videospeed.qa.visual-dom-walk-counter');let state=globalThis[key];
   const view=()=>state?{documentQuerySelectorAll:state.counts.documentQuerySelectorAll,elementQuerySelectorAll:state.counts.elementQuerySelectorAll,createTreeWalker:state.counts.createTreeWalker,selectors:[...state.counts.selectors]}:{installed:false};
   if(op==='install'){
    if(state)return {...view(),installed:true};
    const documentDescriptor=Object.getOwnPropertyDescriptor(Document.prototype,'querySelectorAll');
    const elementDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'querySelectorAll');
    const walkerDescriptor=Object.getOwnPropertyDescriptor(Document.prototype,'createTreeWalker');
    const instanceWalkerDescriptor=Object.getOwnPropertyDescriptor(document,'createTreeWalker');
    const counts={documentQuerySelectorAll:0,elementQuerySelectorAll:0,createTreeWalker:0,selectors:[]};
    const remember=(kind,selector)=>{if(counts.selectors.length<32)counts.selectors.push({kind,selector:String(selector??'')});};
    Object.defineProperty(Document.prototype,'querySelectorAll',{...documentDescriptor,value:function(selector,...args){counts.documentQuerySelectorAll++;remember('Document.querySelectorAll',selector);return documentDescriptor.value.call(this,selector,...args);}});
    Object.defineProperty(Element.prototype,'querySelectorAll',{...elementDescriptor,value:function(selector,...args){counts.elementQuerySelectorAll++;remember('Element.querySelectorAll',selector);return elementDescriptor.value.call(this,selector,...args);}});
    const originalWalker=document.createTreeWalker;
    document.createTreeWalker=function(...args){counts.createTreeWalker++;remember('document.createTreeWalker',args[0]);return originalWalker.apply(this,args);};
    state={counts,documentDescriptor,elementDescriptor,walkerDescriptor,instanceWalkerDescriptor};globalThis[key]=state;
    return {...view(),installed:true};
   }
   if(!state)return {installed:false};
   const result={...view(),installed:true};
   if(op==='restore'){
    Object.defineProperty(Document.prototype,'querySelectorAll',state.documentDescriptor);
    Object.defineProperty(Element.prototype,'querySelectorAll',state.elementDescriptor);
    if(state.instanceWalkerDescriptor)Object.defineProperty(document,'createTreeWalker',state.instanceWalkerDescriptor);else delete document.createTreeWalker;
    delete globalThis[key];result.restored=true;
   }
   return result;
  };
  return chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:instrument,args:[operation]});
 },{tabId,operation});
 return results?.[0]?.result||{installed:false};
}
async function load(url,{registered=[],unregistered=[],childRegistered=[],settle=350}={}){
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.qa?.ready,null,{timeout:8000});
 await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.readyState>=2),null,{timeout:8000}).catch(()=>{});
 if(registered.length)await page.waitForFunction(ids=>ids.every(id=>document.getElementById(id)?.getAttribute('data-video-control-id')),registered,{timeout:8000});
 if(unregistered.length)await page.waitForFunction(ids=>ids.every(id=>document.getElementById(id)&&!document.getElementById(id).getAttribute('data-video-control-id')),unregistered,{timeout:8000});
 if(childRegistered.length){const child=page.frames().find(frame=>new URL(frame.url()).pathname==='/frame-child');if(!child)throw Error('The child frame did not load');await child.waitForFunction(ids=>ids.every(id=>document.getElementById(id)?.getAttribute('data-video-control-id')),childRegistered,{timeout:8000});}
 await page.waitForTimeout(settle);
}
async function pick(id){
 const worker=context.serviceWorkers()[0]||serviceWorker;
 const tabId=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('No active fixture tab');return tab.id;});
 await worker.evaluate(async id=>chrome.tabs.sendMessage(id,{scope:'video-control',action:'pick'}),tabId);
 await page.waitForSelector('div[style*="2147483646"]',{state:'attached',timeout:4000});
 await page.locator('#'+id).click({position:{x:4,y:4}});
 await page.bringToFront();await page.waitForTimeout(350);
}
async function run(){
 let executablePath=process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath();
 if(stage==='candidate-brave'){
  const programs=process.env.ProgramW6432||process.env.ProgramFiles||'C:\\Program Files';
  const candidates=[process.env.VIDEOSPEED_BRAVE,path.join(programs,'BraveSoftware/Brave-Browser/Application/brave.exe'),process.env.ProgramFilesX86&&path.join(process.env.ProgramFilesX86,'BraveSoftware/Brave-Browser/Application/brave.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'BraveSoftware/Brave-Browser/Application/brave.exe')].filter(Boolean);
  executablePath=undefined;
  for(const candidate of candidates){try{await access(candidate);executablePath=candidate;break;}catch{}}
  if(!executablePath)throw Error('Brave executable not found; set VIDEOSPEED_BRAVE to its executable path');
 }
 report.browser.executablePath=executablePath;
 context=await chromium.launchPersistentContext(path.join(profile,'isolated-profile'),{
  executablePath,headless:true,
  args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--disable-background-networking','--no-first-run','--autoplay-policy=no-user-gesture-required']});
 context.on('page',item=>item.on('pageerror',error=>report.errors.push(String(error))));
 page=context.pages()[0];if(!page)page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(String(error)));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.protocol==='chrome-extension:')return route.continue();
  if(url.protocol!=='http:'||!allowedHosts.has(url.hostname))return route.abort();
  if(url.pathname==='/tiny.webm')return route.fulfill({status:200,contentType:'video/webm',body:media});
  if(url.pathname==='/frame-child')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:childFixture()});
  return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture(url)});
 });
 serviceWorker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await serviceWorker.evaluate(async()=>{
  const deadline=Date.now()+5000;
  while(!Number.isSafeInteger((await chrome.storage.local.get('lastRateRevision')).lastRateRevision)){
   if(Date.now()>=deadline)throw Error('Fixture setup: extension rate memory did not initialize');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  await chrome.storage.local.set({settings:{enabled:true,defaultMode:'off',qualityEnabled:false,preferredRate:1.25,customRate:1.25,steps:[.5,.75,1,1.25,1.5,2,3,4],shortcuts:{slower:'<',faster:'>',reset:':',preferred:'"',fineSlower:'',fineFaster:''}},lastRate:1,lastRateRevision:1});
 });
 report.browser.version=context.browser()?.version()||null;
 page.setDefaultTimeout(8000);await page.setViewportSize({width:1280,height:800});

 // A paused, large primary candidate must beat an autoplaying small card on
 // an unknown site. This deliberately does not use any platform preview tags.
 await load('http://media.example.test/?case=priority',{registered:['main','small','next-main']});
 const domTab=await activeTabId();
 const counterInstalled=await domWalkCounter(domTab,'install');
 const ordinaryHotkey=await checkTarget('unknown site: paused large main beats playing small card',['main'],['small','next-main'],{viewport:{width:1280,height:800}});
 const afterOrdinaryHotkey=await domWalkCounter(domTab,'read');
 await page.evaluate(()=>window.scrollTo(0,1120));
 const unknownScrollBefore=await page.evaluate(()=>({scrollY,at:performance.now()}));
 const unknownScrollHotkey=await checkTarget('unknown site: scroll change then immediate hotkey follows new visible main',['next-main'],['main','small'],{scrollBefore:unknownScrollBefore,expectedUnchangedRates:{main:1.25,small:1}});
 const afterUnknownScrollHotkey=await domWalkCounter(domTab,'read');
 const counterRestored=await domWalkCounter(domTab,'restore');
 const noFullScan=[afterOrdinaryHotkey,afterUnknownScrollHotkey].every(item=>item.documentQuerySelectorAll===0&&item.elementQuerySelectorAll===0&&item.createTreeWalker===0);
 const domCost={pass:noFullScan,counterInstalled,ordinaryHotkey,afterOrdinaryHotkey,unknownScrollHotkey,afterUnknownScrollHotkey,counterRestored};
 report.domCost=domCost;report.checks.push({name:'keyboard rechecks registered candidates without a DOM-wide scan',pass:noFullScan,evidence:domCost});
 if(!noFullScan)report.checks.at(-1).screenshot=await screenshot('keyboard-dom-walk-counter');

 // Known preview exclusions remain hard exclusions on both supported sites.
 await load('http://www.youtube.com/watch?v=main&case=known-yt',{registered:['main'],unregistered:['preview']});
 await checkTarget('YouTube preview stays excluded',['main'],['preview'],{platform:'youtube'});
 await load('http://www.bilibili.com/video/BV1main?case=known-bili',{registered:['main'],unregistered:['preview']});
 await checkTarget('Bilibili preview stays excluded',['main'],['preview'],{platform:'bilibili'});

 // Manual selection grants a short preference to a visible candidate; after
 // four seconds the larger primary candidate should regain control.
 await load('http://media.example.test/?case=manual',{registered:['main','small']});
 await pick('small');
 const manualNow=await checkTarget('manual pick briefly favors visible small candidate',['small'],['main'],{phase:'immediate'});
 await page.waitForTimeout(4300);
 const expired=await checkTarget('manual pick expires after about four seconds',['main'],['small'],{phase:'after-4.3s',expectedUnchangedRate:1.25});
 report.manual={immediate:manualNow,expired};

 // A manually picked A remains playing after scrolling fully to paused B.
 // The trusted key follows the fresh viewport synchronously, before the
 // regular scroll/report debounce can change cached selection.
 await load('http://www.facebook.com/feed?case=scroll',{registered:['post-a-video','post-b-video']});
 await pick('post-a-video');
 await page.evaluate(()=>window.scrollTo(0,1120));
 const scrollBefore=await page.evaluate(()=>({scrollY,at:performance.now()}));
 const scrollResult=await checkTarget('immediate hotkey after scroll controls visible paused B',['post-b-video'],['post-a-video'],{scrollBefore,expectedDelayMs:250});
 report.scroll=scrollResult;

 // The element box is large, but an overflow ancestor exposes only a tiny
 // left-edge sliver. The real IntersectionObserver ratio records the clip.
 await load('http://media.example.test/?case=clip',{registered:['main','edge']});
 await page.waitForFunction(()=>Number.isFinite(window.qa.io.edge?.ratio),null,{timeout:4000});
 const clipEvidence=await page.evaluate(()=>({edgeIo:qa.io.edge,mainIo:qa.io.main}));
 await checkTarget('overflow-clipped edge sliver cannot beat centered paused main',['main'],['edge'],clipEvidence);
 report.clip=clipEvidence;

 // A child-frame video can be fully visible in its own viewport while its
 // iframe is offscreen in the parent. Parent-frame IO provides evidence.
 await load('http://media.example.test/?case=frame',{registered:['main'],childRegistered:['frame-video']});
 await page.waitForFunction(()=>window.qa.frameLoaded&&Number.isFinite(window.qa.frameRatio),null,{timeout:5000});
 const frameEvidence=await page.evaluate(()=>({iframeIntersectionRatio:qa.frameRatio,iframeRect:(()=>{const r=document.querySelector('#offscreen-frame').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()}));
 await checkTarget('offscreen iframe video cannot beat visible paused parent main',['main'],['frame-video'],frameEvidence);
 report.frame=frameEvidence;

 // Repeat with a cross-origin child so ancestor-frame visibility cannot rely
 // on same-origin DOM access.
 await load('http://media.example.test/?case=cross-origin-frame',{registered:['main'],childRegistered:['frame-video']});
 await page.waitForFunction(()=>window.qa.frameLoaded&&Number.isFinite(window.qa.frameRatio),null,{timeout:5000});
 const crossOriginFrameEvidence=await page.evaluate(()=>({iframeIntersectionRatio:qa.frameRatio,iframeRect:(()=>{const r=document.querySelector('#offscreen-frame').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})(),childOrigin:new URL(document.querySelector('#offscreen-frame').src).origin}));
 const crossOriginResult=await checkTarget('offscreen cross-origin iframe video cannot beat visible paused parent main',['main'],['frame-video'],crossOriginFrameEvidence);
 report.crossOriginFrame={...crossOriginFrameEvidence,result:crossOriginResult};

 // A small geometry change makes B only slightly higher-scoring. Keep A as
 // the active target inside the requested 15% hysteresis band.
 await load('http://media.example.test/?case=stability',{registered:['candidate-a-video','candidate-b-video']});
 await checkTarget('initial near-tie establishes candidate A',['candidate-a-video'],['candidate-b-video'],{phase:'initial'});
 await page.evaluate(()=>{document.querySelector('#candidate-b video').style.width='650px';document.querySelector('#candidate-b video').style.height='360px';window.dispatchEvent(new Event('resize'));});
 await page.waitForTimeout(500);
 const stable=await checkTarget('near-tie within 15 percent keeps current target A',['candidate-a-video'],['candidate-b-video'],{phase:'within-hysteresis',expectedTargetRate:1.5});
 report.stability=stable;

 assert.deepEqual(report.errors,[],'Fixture page errors occurred');
 report.runtimeSha256After=await runtimeHash();
 assert.equal(report.runtimeSha256After,report.runtimeSha256Before,'Extension runtime changed during the run');
}

try{await run();}
catch(error){report.error=String(error?.stack||error);process.exitCode=1;
 if(page)report.failureState=await Promise.all(page.frames().map(async frame=>({url:frame.url(),videos:await frame.evaluate(()=>[...document.querySelectorAll('video')].map(v=>({id:v.id,rate:v.playbackRate,paused:v.paused,ready:v.readyState,registryId:v.getAttribute('data-video-control-id')}))).catch(()=>null),qa:await frame.evaluate(()=>window.qa||null).catch(()=>null)})));
 report.failureBackground=await serviceWorker?.evaluate(async()=>({storage:await chrome.storage.local.get(['settings','lastRate','lastRateRevision','tabActivityGrace']),session:await chrome.storage.session.get('tabActivity'),window:await chrome.windows.getLastFocused(),tabs:(await chrome.tabs.query({})).map(({id,url,active,status})=>({id,url,active,status}))})).catch(()=>null);
}
finally{
 await context?.close().catch(()=>{});
 const resolved=await realpath(profile),relative=path.relative(path.resolve(os.tmpdir()),resolved);
 if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('videospeed-visual-')){await rm(resolved,{recursive:true,force:true});report.cleanup=true;}
 if(!report.runtimeSha256After)report.runtimeSha256After=await runtimeHash().catch(error=>'ERROR: '+String(error));
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
}
if(report.checks.some(item=>!item.pass))process.exitCode=1;
console.log(JSON.stringify(report,null,2));
