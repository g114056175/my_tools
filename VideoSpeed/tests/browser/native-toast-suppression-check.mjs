import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {chromium}=createRequire(path.join(root,'package.json'))('playwright');
const label=process.env.VIDEOSPEED_QA_LABEL||'current';if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid label');
const extension=path.resolve(process.env.VIDEOSPEED_QA_EXTENSION_DIR||path.join(root,'extension'));
const output=path.join(root,'work/qa-093-native-suppression');
const report={label,scope:'Real extension, trusted native input and local YouTube/Bilibili DOM fixtures in an isolated browser',checks:[],errors:[],cleanup:false};
let context,profile;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(read,ms=3000){const end=Date.now()+ms;while(Date.now()<end){if(await read())return true;await sleep(25);}return false;}
function check(name,pass,evidence={}){report.checks.push({name,pass:!!pass,evidence});}
async function hashRuntime(){const files=[];async function walk(folder){for(const e of await readdir(folder,{withFileTypes:true})){const full=path.join(folder,e.name);if(e.isDirectory())await walk(full);else files.push(path.relative(extension,full).replaceAll('\\','/'));}}await walk(extension);const value=createHash('sha256');for(const name of files.sort())value.update(name).update('\0').update(await readFile(path.join(extension,name))).update('\0');return value.digest('hex');}
function html(site){
 const bili=site==='bilibili';
 return `<!doctype html><meta charset="utf-8"><title>Native notification fixture</title><style>body{margin:20px;font:16px system-ui}#player,#movie_player{width:640px;position:relative}video{width:640px;height:360px;display:block}.native-row{display:block;background:#111;color:#fff;padding:4px}button{padding:8px}.bpx-player-three-playrate-hint:empty{display:none}</style>
 <div id="${bili?'player':'movie_player'}" class="${bili?'bpx-player-container':'html5-video-player'}">
 <video id="v" muted autoplay loop playsinline controls src="/tiny.webm"></video><button id="choose" role="menuitemradio">1.5×</button>
 <div id="native-root" ${bili?'class="bpx-player-toast-wrap"':''}>
 ${bili?'<div id="native-row" class="native-row bpx-player-toast-item"><span class="bpx-player-toast-cancel"><svg></svg></span><span id="native-text" class="bpx-player-toast-text"></span></div>':'<div class="ytp-bezel-text-wrapper"><div id="native-text" class="native-row ytp-bezel-text"></div></div><div id="native-icon" class="ytp-bezel" aria-label=""><svg><circle cx="5" cy="5" r="4"></circle></svg></div>'}
 </div>
 ${bili?'<div id="native-hint" class="bpx-player-three-playrate-hint"><span class="bpx-player-three-playrate-hint-label"></span></div>':''}
 ${bili?'<div class="bpx-player-tooltip-area"><div id="native-shortcut" class="bpx-player-tooltip-item" data-name="shortcut"><div class="bpx-player-tooltip-title"></div></div><div id="native-hover" class="bpx-player-tooltip-item" data-name="ctrl:rate"><div class="bpx-player-tooltip-title">1.5x播放</div></div></div>':''}
 <div id="noise"></div></div>
 <div id="outside" class="native-row ${bili?'bpx-player-toast-text':'ytp-bezel-text'}">1.5x</div>
 <script>
 const v=document.querySelector('#v'),player=v.parentElement;window.__savedNative=[];
 player.getVideoData=()=>({video_id:'VSFixture',title:'Native notification fixture'});player.getPlayerResponse=()=>({videoDetails:{videoId:'VSFixture'}});
 window.showNative=(text,label='')=>{document.querySelector('#native-text').textContent=text;document.querySelector('#native-icon')?.setAttribute('aria-label',label);const shortcut=document.querySelector('#native-shortcut .bpx-player-tooltip-title');if(shortcut)shortcut.textContent=text;};
 window.addEventListener('click',e=>{if(e.target.id==='choose'){v.playbackRate=1.5;showNative(${bili?"'1.5x播放'":"'1.5x'"},'速度為 1.5');}},true);
 ${bili?"window.addEventListener('keydown',e=>{if(e.key==='!'||e.key==='@'){e.preventDefault();v.playbackRate=e.key==='!'?1.25:1.5;showNative(v.playbackRate+'x播放');}},true);":''}
 window.replaceNative=()=>{const old=document.querySelector('#native-root');window.__oldNative=old;old.remove();const next=document.createElement('div');next.id='native-root';${bili?"next.className='bpx-player-toast-wrap';next.innerHTML='<div id=\"native-row\" class=\"native-row bpx-player-toast-item\"><span id=\"native-text\" class=\"bpx-player-toast-text\">1.5x播放</span></div>';":"next.innerHTML='<div class=\"ytp-bezel-text-wrapper\"><div id=\"native-text\" class=\"native-row ytp-bezel-text\">1.5x</div></div><div id=\"native-icon\" class=\"ytp-bezel\" aria-label=\"速度為 1.5\"><svg></svg></div>';"}player.append(next);};
 </script>`;
}
try{
 await mkdir(output,{recursive:true});report.runtimeSha256=await hashRuntime();
 const bytes=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
 profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-native-suppression-'));
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath(),viewport:{width:1000,height:820},args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--autoplay-policy=no-user-gesture-required','--disable-background-networking','--no-first-run']});
 report.browser=context.browser().version();
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.protocol==='chrome-extension:')return route.continue();
  if(!['www.youtube.com','www.bilibili.com','unknown.test'].includes(u.hostname))return route.abort();
  if(u.pathname==='/tiny.webm')return route.fulfill({contentType:'video/webm',body:bytes});
  if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:html(u.hostname==='www.bilibili.com'?'bilibili':'youtube')});
  return route.abort();
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 if(!await waitFor(()=>worker.evaluate(async()=>Number.isSafeInteger((await chrome.storage.local.get('lastRateRevision')).lastRateRevision)),6000))throw Error('Rate memory startup');
 await worker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,defaultMode:'off',qualityEnabled:false,preferredRate:2},lastRate:2,lastRateRevision:1}));
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));
 const visible=selector=>page.locator(selector).evaluate(n=>getComputedStyle(n).display!=='none'&&n.checkVisibility({checkVisibilityCSS:true}));
 const hasMarker=()=>page.evaluate(()=>document.querySelectorAll('[data-video-control-native-rate-hidden]').length);
 async function open(site){
  const url=site==='youtube'?'https://www.youtube.com/watch?v=VSFixture':site==='bilibili'?'https://www.bilibili.com/video/BVFixture':'https://unknown.test/watch';
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.bringToFront();
  await worker.evaluate(async expected=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===expected);await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});},url);
  if(!await waitFor(()=>page.locator('#v').evaluate(v=>v.readyState>=2&&!v.paused&&!!v.getAttribute('data-video-control-initialized')),6000))throw Error('Fixture startup: '+site);
 }
 for(const site of ['youtube','bilibili']){
  await open(site);await page.locator('#choose').click();
  const hidden=await waitFor(async()=>!await visible('#native-text'));
  const own=await waitFor(()=>page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent==='1.5×'));
  let memory;const saved=await waitFor(async()=>{memory=await worker.evaluate(()=>chrome.storage.local.get('lastRate'));return memory.lastRate===1.5;});
  check(site+': native speed feedback is hidden while VS shows the confirmed rate',hidden&&own&&saved,{hidden,own,memory:memory.lastRate});
  await page.screenshot({path:path.join(output,label+'-'+site+'.png')});
  if(site==='youtube')check('youtube: only the speed-labelled native icon is hidden',!await visible('#native-icon'));
  if(site==='bilibili'){
   check('bilibili: the real keyboard shortcut tooltip is hidden',await waitFor(async()=>!await visible('#native-shortcut')));
   check('bilibili: same-text control-hover tooltips remain visible',await visible('#native-hover'));
  }
  check(site+': identical text outside the selected player remains visible',await visible('#outside'));
  for(const text of ['50%','1080p','3 秒後播放下一P','網路錯誤','1.5']){
   await page.evaluate(value=>showNative(value,'音量 50%'),text);await sleep(40);
   check(site+': preserves unrelated native content '+text,await visible('#native-text')&&(site!=='youtube'||await visible('#native-icon'))&&(site!=='bilibili'||await visible('#native-shortcut')));
  }
  for(const text of ['1.25x','2x']){
   await page.evaluate(value=>showNative(value,'速度為 '+value.replace('x','')),text);await sleep(40);
   check(site+': mismatched speed text is left alone '+text,await visible('#native-text'));
  }
  if(site==='bilibili'){
   await page.locator('#v').focus();
   for(const [key,rate]of [['Shift+Digit1',1.25],['Shift+Digit2',1.5]]){
    await page.keyboard.press(key);
    const hidden=await waitFor(async()=>!await visible('#native-row'));
    const shown=await waitFor(()=>page.evaluate(expected=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent===expected+'×',rate));
    check('bilibili: native '+key+' tooltip and dismissible toast are hidden',hidden&&shown&&!await visible('#native-shortcut')&&await page.locator('#v').evaluate(v=>v.playbackRate)===rate);
   }
   await page.evaluate(()=>document.querySelector('#native-shortcut .bpx-player-tooltip-title').textContent='1.0x播放');
   check('bilibili: an older shortcut multiplier stays hidden after newer VS feedback',await waitFor(async()=>!await visible('#native-shortcut')));
   await page.locator('#choose').click();
   await page.evaluate(()=>{const row=document.querySelector('#native-row');const button=document.createElement('button');button.id='native-action';button.textContent='詳情';row.append(button);});await sleep(40);
   check('bilibili: interactive notifications are preserved',await visible('#native-text')&&await visible('#native-action'));
   await page.locator('#native-action').evaluate(n=>n.remove());
   await page.evaluate(()=>document.querySelector('.bpx-player-three-playrate-hint-label').textContent='1.5');
   check('bilibili: a dedicated speed hint accepts a bare rate',await waitFor(async()=>!await visible('#native-hint')));
  }
  await page.locator('#choose').click();await page.evaluate(()=>replaceNative());
  check(site+': lazy replacement is hidden and detached nodes are restored',await waitFor(async()=>!await visible('#native-text')&&await page.evaluate(()=>!__oldNative.querySelector('[data-video-control-native-rate-hidden]'))));
  await sleep(2150);
  const [tab]=await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}));
  await worker.evaluate(id=>chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:()=>{
   globalThis.__nativeUiQueries=0;const original=Element.prototype.querySelectorAll;
   Element.prototype.querySelectorAll=function(selector){if(/ytp-bezel|bpx-player-toast|three-playrate-hint/.test(selector))globalThis.__nativeUiQueries++;return original.call(this,selector);};
  }}),tab.id);
  await page.evaluate(()=>{const area=document.querySelector('#noise');for(let i=0;i<100;i++)area.append(document.createElement('span'));});await sleep(200);
  const probes=await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:()=>globalThis.__nativeUiQueries}))[0].result,tab.id);
  check(site+': unrelated DOM activity causes no native-toast searches after discovery',probes===0,{searches:probes});
  await page.evaluate(()=>showNative('載入失敗','播放'));await sleep(40);
  check(site+': a late warning reusing the hidden node is restored',await visible('#native-text')&&(site!=='youtube'||await visible('#native-icon')));
  await page.locator('#choose').click();await waitFor(async()=>!await visible('#native-text'));
  await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,enabled:false}});});
  check(site+': disabling VS restores all native feedback',await waitFor(async()=>await hasMarker()===0&&await visible('#native-text')));
  await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,enabled:true}});});
  if(!await waitFor(()=>page.locator('#v').evaluate(v=>!!v.getAttribute('data-video-control-id')),6000))throw Error('Re-enable did not register video');
  await page.keyboard.press('Shift+Period');await waitFor(()=>page.locator('#v').evaluate(v=>v.playbackRate>1.5));
  await page.locator('#choose').click();await waitFor(async()=>!await visible('#native-text'));
  await page.evaluate(()=>{const v=document.querySelector('#v');v.src='/tiny.webm?next';v.play().catch(()=>{});});
  check(site+': loading another source removes old suppression',await waitFor(async()=>await hasMarker()===0));
 }
 await open('unknown');await page.locator('#choose').click();
 const unknownOwn=await waitFor(()=>page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent==='1.5×'));
 check('unknown website: native feedback and DOM are untouched',unknownOwn&&await visible('#native-text')&&await hasMarker()===0);
 await page.screenshot({path:path.join(output,label+'-unknown.png')});
 report.afterRuntimeSha256=await hashRuntime();
}catch(error){report.error=String(error.stack||error);}
finally{
 await context?.close().catch(()=>{});
 if(profile){const actual=await realpath(profile),base=await realpath(os.tmpdir());if(path.dirname(actual).toLowerCase()===base.toLowerCase()&&path.basename(actual).startsWith('videospeed-native-suppression-')){await rm(actual,{recursive:true,force:true,maxRetries:4,retryDelay:150});report.cleanup=true;}}
 report.passed=!report.error&&!report.errors.length&&report.checks.length>=28&&report.checks.every(c=>c.pass)&&report.runtimeSha256===report.afterRuntimeSha256;
 await writeFile(path.join(output,label+'-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
