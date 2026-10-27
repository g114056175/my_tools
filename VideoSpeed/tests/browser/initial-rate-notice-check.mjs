import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),extension=path.join(root,'extension');
const label=process.env.VIDEOSPEED_NOTICE_LABEL||'fixtures';assert.match(label,/^[a-z0-9-]+$/);
const output=path.join(root,'work/qa-074-notice-'+label);await mkdir(output,{recursive:true});
const version=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8')).version;
const bytes=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
const report={version,checks:[],error:null,cleanup:false,scope:'Isolated Chromium with local YouTube/Bilibili structure fixtures; no real-site requests or popup.'};
const profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-notice-'));let context,page;
function fixture(mode){
 const shell=mode==='main'?'<div id="movie_player" class="html5-video-player"><video id="v" style="opacity:0"></video></div>':
 mode==='youtube'?'<yt-lockup-view-model><a href="/watch?v=previewA">Preview</a></yt-lockup-view-model><ytd-video-preview><div id="inline-preview-player" class="html5-video-player"><video id="v"></video></div></ytd-video-preview>':
 '<div class="bili-video-card" data-bvid="BV1fixture"><video id="v"></video></div>';
 return `<!doctype html><meta charset="utf-8"><title>Notice fixture</title><style>video{width:640px;height:360px;display:block}body{margin:20px}</style>${shell}<script>
 window.qa={mode:${JSON.stringify(mode)},notices:[],frames:[],ready:false,cycle:0,previewIdReady:false};
 let clip='A',replaced=false;const player=document.querySelector('.html5-video-player');
 if(player){player.getVideoData=()=>({video_id:qa.mode==='main'?clip:qa.previewIdReady?'previewA':undefined,title:'Notice fixture'});player.getPlayerResponse=()=>({videoDetails:{videoId:qa.mode==='main'?clip:qa.previewIdReady?'previewA':undefined}});}
 const watchHost=host=>{if(host.id!=='video-control-toast'||host.qaObserved)return;host.qaObserved=true;
  const read=()=>{const text=host.shadowRoot?.querySelector('span')?.textContent;if(text&&text!==host.qaText){host.qaText=text;qa.notices.push({text,at:performance.now(),cycle:qa.cycle});}};
  new MutationObserver(read).observe(host.shadowRoot,{childList:true,subtree:true,characterData:true});read();};
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)watchHost(node);}).observe(document.documentElement,{childList:true,subtree:true});
 function attach(video){video.muted=true;video.loop=true;video.autoplay=true;video.playsInline=true;const cycle=++qa.cycle;
  const frame=()=>{if(!video.isConnected)return;if(video.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!qa.frames.some(item=>item.cycle===cycle))qa.frames.push({cycle,at:performance.now()});video.requestVideoFrameCallback(frame);};video.requestVideoFrameCallback(frame);
  if(qa.mode==='youtube')video.addEventListener('playing',()=>{if(replaced)return;replaced=true;qa.previewIdReady=true;video.src='/tiny.webm?final=1';video.play().catch(()=>{});});
  video.src='/tiny.webm?clip='+clip;video.play().catch(()=>{});return video;}
 window.reveal=()=>{document.querySelector('#v').style.opacity='1';};
 window.replaceVideo=next=>{if(next){clip=next;history.pushState({},'','/watch?v='+next);}const old=document.querySelector('#v'),video=document.createElement('video');video.id='v';old.replaceWith(video);attach(video);};
 window.nextUnknownPreview=()=>{qa.previewIdReady=false;const video=document.querySelector('#v');video.removeAttribute('data-video-control-preview-id');video.src='/tiny.webm?unknown=next';video.play().catch(()=>{});};
 attach(document.querySelector('#v'));qa.ready=true;
 </script>`;
}
async function check(name,fn){await fn();report.checks.push({name,pass:true});}
try{
 context=await chromium.launchPersistentContext(path.join(profile,'profile'),{executablePath:process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath(),headless:true,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--no-first-run','--autoplay-policy=no-user-gesture-required']});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol==='chrome-extension:')return route.continue();
  if(url.protocol!=='http:'||!['www.youtube.com','www.bilibili.com'].includes(url.hostname))return route.abort();
  return route.fulfill(url.pathname==='/tiny.webm'?{status:200,contentType:'video/webm',body:bytes}:{status:200,contentType:'text/html',body:fixture(url.searchParams.get('mode')||'main')});});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,defaultMode:'follow',qualityEnabled:false},lastRate:2,lastRateRevision:1}));
 page=context.pages()[0];
 await page.goto('http://www.youtube.com/watch?v=A&mode=main');
 await page.waitForFunction(()=>window.qa?.ready&&document.querySelector('#v').playbackRate===2);
 await check('hidden pre-roll setup creates no automatic toast',async()=>{await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>qa.notices.length),0);});
 await page.evaluate(()=>reveal());
 await page.waitForFunction(()=>qa.notices.length===1);
 await check('main notice follows its first visible frame',async()=>{
  const evidence=await page.evaluate(()=>({notices:qa.notices,frames:qa.frames}));assert.ok(evidence.frames[0]);assert.ok(evidence.notices[0].at>=evidence.frames[0].at);report.main=evidence;});
 await page.waitForTimeout(1250);await page.evaluate(()=>replaceVideo());
 await page.waitForFunction(()=>qa.cycle===2&&document.querySelector('#v').playbackRate===2);await page.waitForTimeout(450);
 await check('a replacement element for the same route does not show another notice',async()=>assert.equal(await page.evaluate(()=>qa.notices.length),1));
 await page.evaluate(()=>replaceVideo('B'));await page.waitForFunction(()=>qa.notices.length===2);
 await check('a different YouTube route can show its own notice',async()=>assert.equal(await page.evaluate(()=>qa.notices.at(-1).text),'2×'));
 await page.keyboard.press('Shift+Comma');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75);
 await check('manual keyboard feedback remains immediate',async()=>assert.equal(await page.evaluate(()=>document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent),'1.75×'));
 for(const mode of ['youtube','bilibili']){
  await page.goto(mode==='youtube'?'http://www.youtube.com/?mode=youtube':'http://www.bilibili.com/?mode=bilibili');
  await page.waitForFunction(()=>qa.notices.length>=1&&document.querySelector('#v').playbackRate===1.75);
  await page.screenshot({path:path.join(output,mode+'-preview.png')});await page.waitForTimeout(500);
  await check(mode+' preview has one visible-frame notice despite source setup',async()=>{
   const evidence=await page.evaluate(()=>({notices:qa.notices,frames:qa.frames,rate:document.querySelector('#v').playbackRate}));
   assert.equal(evidence.notices.length,1);assert.equal(evidence.notices[0].text,'1.75×');assert.ok(evidence.notices[0].at>=evidence.frames[0].at);report[mode]=evidence;
  });
  await page.waitForFunction(()=>!document.querySelector('#video-control-toast'));
  if(mode==='youtube'){
   await page.evaluate(()=>nextUnknownPreview());await page.waitForFunction(()=>qa.notices.length===2);
   await check('a source-only YouTube preview can notify the next clip',async()=>assert.equal(await page.evaluate(()=>qa.notices.at(-1).text),'1.75×'));
   await page.waitForFunction(()=>!document.querySelector('#video-control-toast'));
  }
  const count=await page.evaluate(()=>qa.notices.length);
  await page.evaluate(()=>document.querySelector('#v').pause());await page.waitForTimeout(80);await page.evaluate(()=>document.querySelector('#v').play());
  await page.waitForFunction(previous=>qa.notices.length===previous+1,count);
  await check(mode+' preview re-entry gets one new notice',async()=>assert.equal(await page.evaluate(()=>qa.notices.at(-1).text),'1.75×'));
 }
}catch(error){report.error=String(error?.stack||error);process.exitCode=1;}
finally{
 await context?.close().catch(()=>{});const resolved=await realpath(profile),relative=path.relative(path.resolve(os.tmpdir()),resolved);
 if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('videospeed-notice-')){await rm(resolved,{recursive:true,force:true});report.cleanup=true;}
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
