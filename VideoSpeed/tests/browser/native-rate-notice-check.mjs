import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {chromium}=createRequire(path.join(root,'package.json'))('playwright');
const label=process.env.VIDEOSPEED_QA_LABEL||'current';
if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid report label');
const extension=path.resolve(process.env.VIDEOSPEED_QA_EXTENSION_DIR||path.join(root,'extension'));
const output=path.join(root,'work/qa-091-native-rate');
const report={label,scope:'Trusted browser input on local speed controls, with the real extension and no popup',checks:[],errors:[],cleanup:false};
let context,server,profile;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(read,ms=1800){const end=Date.now()+ms;while(Date.now()<end){if(await read())return true;await sleep(25);}return false;}
function check(name,pass,evidence){report.checks.push({name,pass:!!pass,evidence});}
async function hashRuntime(){const names=[];async function walk(folder){for(const e of await readdir(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory())await walk(p);else names.push(path.relative(extension,p).replaceAll('\\','/'));}}await walk(extension);const hash=createHash('sha256');for(const name of names.sort())hash.update(name).update('\0').update(await readFile(path.join(extension,name))).update('\0');return hash.digest('hex');}
try{
 await mkdir(output,{recursive:true});report.runtimeSha256=await hashRuntime();
 const media=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
 const html=`<!doctype html><meta charset="utf-8"><title>Native speed controls</title>
 <style>body{margin:25px;font:16px system-ui}video{width:640px;height:360px;display:block}input{width:420px}.ytp-speed-slider{width:420px;height:32px;background:#ddd;margin:12px 0}.bpx-player-ctrl-playbackrate-menu-item{padding:8px;display:inline-block}button,[role=menuitemradio]{padding:8px}</style>
 <div id="player"><video id="v" muted autoplay loop playsinline controls src="/tiny.webm"></video>
 <div role="menu"><button id="choice" role="menuitemradio">1.5×</button><button id="normal" role="menuitemradio">Normal</button></div>
 <input id="speed" type="range" aria-label="Playback speed" min="0.25" max="4" step="0.05" value="1.5">
 <div id="custom" class="ytp-speed-slider" role="slider" aria-label="Playback speed" aria-valuenow="1.5" aria-valuemin="0.25" aria-valuemax="4" tabindex="0"></div>
 <ul class="bpx-player-ctrl-playbackrate-menu"><li id="bili" class="bpx-player-ctrl-playbackrate-menu-item" data-value="1.75">1.75</li></ul>
 <button id="increase" aria-label="Increase playback speed">+</button><button id="ordinary">Play</button>
 <div class="ytp-variable-speed-panel-content"><button id="yt-preset" class="ytp-variable-speed-panel-preset-button"><span>2.0</span></button>
 <input id="yt-range" class="ytp-input-slider ytp-speedslider" role="slider" type="range" min="0.25" max="4" step="0.05" value="2" aria-valuenow="2" aria-valuetext="2.00"></div></div>
 <script>
 const video=document.querySelector('#v'),slider=document.querySelector('#speed'),custom=document.querySelector('#custom');window.__native=[];window.__early=true;
 const set=(value,source)=>{video.playbackRate=Number(value);window.__native.push({value:video.playbackRate,source});};
 window.addEventListener('click',e=>{if(e.target.id==='choice')set(1.5,'window-choice');if(e.target.id==='normal')set(1,'window-normal');if(e.target.id==='bili')set(1.75,'window-bili');if(e.target.id==='increase')set(Math.min(4,video.playbackRate+.25),'window-increase');if(e.target.id==='ordinary')set(1,'ordinary-reset');},true);
 window.addEventListener('input',e=>{if(e.target===slider)set(slider.value,'window-input');},true);
 let dragging=false;custom.addEventListener('pointerdown',e=>{dragging=true;custom.setPointerCapture(e.pointerId);});custom.addEventListener('pointermove',e=>{if(!dragging)return;const r=custom.getBoundingClientRect(),rate=Math.round((.25+3.75*Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)))*20)/20;custom.setAttribute('aria-valuenow',String(rate));set(rate,'custom-drag');});custom.addEventListener('pointerup',()=>{dragging=false;});
 window.addEventListener('keydown',e=>{if(e.target.matches('input,[role=slider]'))return;if(e.key==='!'){e.preventDefault();set(Math.max(.25,video.playbackRate-.25),'window-key-!');}if(e.key==='@'){e.preventDefault();set(Math.min(4,video.playbackRate+.25),'window-key-@');}},true);
 document.querySelector('#yt-preset').addEventListener('click',()=>set(2,'youtube-preset'));
 const ytRange=document.querySelector('#yt-range');ytRange.addEventListener('change',()=>{const rate=Number(ytRange.value);setTimeout(()=>set(rate,'youtube-delayed-change'),80);});
 window.__notices=[];new MutationObserver(()=>{const text=document.querySelector('#video-control-toast')?.shadowRoot?.textContent;const label=document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent;if(label&&window.__notices.at(-1)?.text!==label)window.__notices.push({text:label,at:performance.now()});}).observe(document.documentElement,{childList:true,subtree:true});
 </script>`;
 server=createServer((req,res)=>{res.writeHead(200,{'content-type':req.url.startsWith('/tiny.webm')?'video/webm':'text/html'});res.end(req.url.startsWith('/tiny.webm')?media:html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-native-rate-'));
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath(),viewport:{width:1000,height:850},args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--autoplay-policy=no-user-gesture-required','--disable-background-networking','--no-first-run']});
 report.browser=context.browser().version();await context.route('**/*',route=>{const u=new URL(route.request().url());return u.protocol==='chrome-extension:'||u.hostname==='127.0.0.1'?route.continue():route.abort();});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 if(!await waitFor(()=>worker.evaluate(async()=>Number.isSafeInteger((await chrome.storage.local.get('lastRateRevision')).lastRateRevision)),6000))throw Error('Rate memory startup did not complete');
 await worker.evaluate(async()=>{await chrome.storage.local.set({settings:{enabled:true,defaultMode:'follow',preferredRate:2,qualityEnabled:false,steps:[.25,.5,.75,1,1.25,1.5,1.75,2,2.5,3,3.5,4]},lastRate:2,lastRateRevision:1});});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(String(e.message)));
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'domcontentloaded'});await page.bringToFront();
 report.initialBrowserContext=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});const tab=tabs.find(t=>t.url?.startsWith('http://127.0.0.1:'));if(!tab)return {focused:false};await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});return {tabId:tab.id,windowId:tab.windowId};});
 const actual=()=>page.locator('video').evaluate(v=>v.playbackRate);
 const remembered=async()=>Number((await worker.evaluate(()=>chrome.storage.local.get('lastRate'))).lastRate);
 const toast=()=>page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent||null);
 if(!await waitFor(async()=>await actual()===2,6000)){
  report.initialFailure={settings:await worker.evaluate(()=>chrome.storage.local.get(['settings','lastRate','lastRateRevision'])),video:await page.locator('video').evaluate(v=>({rate:v.playbackRate,readyState:v.readyState,paused:v.paused,registryId:v.getAttribute('data-video-control-id')}))};
  throw Error('Initial speed did not apply');
 }
 await sleep(1400);
 async function settled(name,action,expected){
  await action();const started=Date.now();
  const visible=await waitFor(async()=>await toast()===expected+'×',200),noticeMs=Date.now()-started;
  const memory=await waitFor(async()=>await remembered()===expected);
  check(name,memory&&visible&&await actual()===expected,{actual:await actual(),memory:await remembered(),toast:await toast(),noticeMs});await sleep(1200);
 }
 await settled('window-capture native menu records and shows its speed',()=>page.locator('#choice').click(),1.5);
 const range=await page.locator('#speed').boundingBox();await page.mouse.move(range.x+range.width*.35,range.y+range.height/2);await page.mouse.down();
 const rangeUpdates=[];
 for(const p of [.4,.5,.6,.7]){await page.mouse.move(range.x+range.width*p,range.y+range.height/2);rangeUpdates.push(await page.evaluate(()=>({rate:v.playbackRate,toast:document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent})));await sleep(45);}
 const during=await toast();await page.mouse.up();const finalRange=await actual();
 const sliderMemory=await waitFor(async()=>await remembered()===finalRange),sliderNotice=await waitFor(async()=>await toast()===finalRange+'×',900);
 check('trusted range drag updates its notice on every confirmed change',rangeUpdates.every(update=>update.toast===String(Number(update.rate.toFixed(2)))+'×')&&sliderMemory&&sliderNotice,{during,updates:rangeUpdates,actual:finalRange,memory:await remembered(),toast:await toast()});await sleep(1200);
 const custom=await page.locator('#custom').boundingBox();await page.mouse.move(custom.x+custom.width*.4,custom.y+custom.height/2);await page.mouse.down();
 const customUpdates=[];
 for(const p of [.5,.6,.7,.8]){await page.mouse.move(custom.x+custom.width*p,custom.y+custom.height/2);customUpdates.push(await page.evaluate(()=>({rate:v.playbackRate,toast:document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent})));await sleep(45);}await page.mouse.up();const finalCustom=await actual();
 const customStarted=Date.now(),customNotice=await waitFor(async()=>await toast()===finalCustom+'×',200),customNoticeMs=Date.now()-customStarted;
 const customMemory=await waitFor(async()=>await remembered()===finalCustom);
 check('custom ARIA slider drag shows the confirmed speed immediately on release',customMemory&&customNotice,{updates:customUpdates,actual:finalCustom,memory:await remembered(),toast:await toast(),noticeMs:customNoticeMs});await sleep(1200);
 await settled('class-based Bilibili option records and shows its speed',()=>page.locator('#bili').click(),1.75);
 await page.mouse.click(850,700);
 await settled('Bilibili ! from window capture records and shows its speed',()=>page.keyboard.press('Shift+Digit1'),1.5);
 await settled('Bilibili @ from window capture records and shows its speed',()=>page.keyboard.press('Shift+Digit2'),1.75);
 await settled('native speed increase button records and shows the confirmed result',()=>page.locator('#increase').click(),2);
 await settled('an explicit native 1x choice remains a real saved preference',()=>page.locator('#normal').click(),1);
 await page.keyboard.press('Shift+Period');await waitFor(async()=>await actual()===1.25);await sleep(1200);
 const memoryBefore=await remembered();await page.evaluate(()=>{setTimeout(()=>document.querySelector('video').playbackRate=1,0);});await sleep(500);
 check('programmatic stream reset does not replace memory or show a user notice',await remembered()===memoryBefore&&await toast()===null,{memoryBefore,memoryAfter:await remembered(),actual:await actual(),toast:await toast()});
 await page.locator('#increase').click();await sleep(60);const beforeOwn=await actual(),start=Date.now();await page.keyboard.press('Shift+Period');
 const immediate=await waitFor(async()=>await toast()===(await actual())+'×',200),ownRate=await actual();await sleep(450);
 check('extension shortcut immediately replaces the native notice without an older value returning',immediate&&ownRate>beforeOwn&&await toast()===ownRate+'×',{beforeOwn,ownRate,elapsedMs:Date.now()-start-450,toast:await toast()});
 await page.locator('#choice').click();await waitFor(async()=>await remembered()===1.5);
 await page.evaluate(()=>{const v=document.querySelector('video');v.src='/tiny.webm?clip=next';v.play().catch(()=>{});});
 const nextUsesNative=await waitFor(()=>page.evaluate(()=>{const v=document.querySelector('video');return v.readyState>=2&&!v.paused&&v.playbackRate===1.5&&v.getAttribute('data-video-control-initialized')?.includes('clip=next');}));
 check('the next video follows the saved native speed',nextUsesNative&&await remembered()===1.5,{actual:await actual(),memory:await remembered()});
 await settled('YouTube variable-speed preset without a menu role shows its confirmed value',()=>page.locator('#yt-preset span').click(),2);
 const ytBox=await page.locator('#yt-range').boundingBox(),ytUpdates=[];
 await page.mouse.move(ytBox.x+ytBox.width*.47,ytBox.y+ytBox.height/2);await page.mouse.down();
 for(const ratio of [.4,.3,.27]){
  await page.mouse.move(ytBox.x+8+(ytBox.width-16)*ratio,ytBox.y+ytBox.height/2);
  ytUpdates.push(await page.evaluate(()=>{const slider=document.querySelector('#yt-range');return {value:Number(slider.value),aria:slider.getAttribute('aria-valuetext'),actual:document.querySelector('video').playbackRate,toast:document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent};}));
 }
 const beforeCommit=await remembered();
 check('YouTube drag previews current range values while ARIA still contains the old rate',ytUpdates.every(x=>x.toast===String(Number(x.value.toFixed(2)))+'×'&&x.actual===2)&&beforeCommit===2,{updates:ytUpdates,memoryBeforeCommit:beforeCommit});
 await page.mouse.up();const ytFinal=ytUpdates.at(-1).value;
 const ytCommitted=await waitFor(async()=>await actual()===ytFinal&&await remembered()===ytFinal&&await toast()===ytFinal+'×',350);
 check('YouTube delayed commit survives the release click and then updates memory',ytCommitted,{actual:await actual(),memory:await remembered(),toast:await toast(),expected:ytFinal});
 report.finalDiagnostics=await worker.evaluate(async()=>({memory:await chrome.storage.local.get(['lastRate','lastRateRevision'])}));
 report.afterRuntimeSha256=await hashRuntime();
}catch(error){report.error=String(error.stack||error);}
finally{
 await context?.close().catch(()=>{});await new Promise(resolve=>server?server.close(resolve):resolve());
 if(profile){const actual=await realpath(profile),base=await realpath(os.tmpdir());if(path.dirname(actual).toLowerCase()===base.toLowerCase()&&path.basename(actual).startsWith('videospeed-native-rate-')){await rm(actual,{recursive:true,force:true,maxRetries:4,retryDelay:150});report.cleanup=true;}}
 report.passed=!report.error&&report.checks.length===14&&report.checks.every(c=>c.pass)&&report.runtimeSha256===report.afterRuntimeSha256;
 await writeFile(path.join(output,label+'-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
