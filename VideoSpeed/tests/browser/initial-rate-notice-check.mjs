import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),extension=path.join(root,'extension');
const label=process.env.VIDEOSPEED_NOTICE_LABEL||'fixtures';assert.match(label,/^[a-z0-9-]+$/);
const output=path.join(root,'work/qa-075-main-'+label);await mkdir(output,{recursive:true});
const version=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8')).version;
const bytes=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
const report={version,checks:[],errors:[],error:null,cleanup:false,scope:'Isolated browser with local structure fixtures and real media; no real-site requests or popup.'};
const profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-notice-'));let context,page,serviceWorker;
function browserFixture({youtube,social,hidden}){
 window.qa={youtube,social,notices:[],frames:[],cycle:0,previewEmptyId:null};
 let clip=new URL(location.href).searchParams.get('v')||'A';
 const player=document.querySelector('#movie_player');
 if(player){player.getVideoData=()=>({video_id:clip,title:'Main fixture'});player.getPlayerResponse=()=>({videoDetails:{videoId:clip}});}
 const watch=host=>{if(host.id!=='video-control-toast'||host.qaObserved)return;host.qaObserved=true;
  const read=()=>{const text=host.shadowRoot?.querySelector('span')?.textContent;if(text&&text!==host.qaText){host.qaText=text;qa.notices.push({text,at:performance.now(),cycle:qa.cycle});}};
  new MutationObserver(read).observe(host.shadowRoot,{childList:true,subtree:true,characterData:true});read();};
 new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)watch(n);}).observe(document.documentElement,{childList:true,subtree:true});
 function attach(video,source){
  video.muted=true;video.loop=true;video.playsInline=true;const cycle=++qa.cycle;
  const frame=()=>{if(!video.isConnected)return;if(video.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!qa.frames.some(item=>item.cycle===cycle))qa.frames.push({cycle,at:performance.now()});video.requestVideoFrameCallback(frame);};
  video.requestVideoFrameCallback(frame);video.src=source||'/tiny.webm?clip='+clip;video.play().catch(()=>{});return video;
 }
 window.reveal=()=>{document.querySelector('#v').style.opacity='1';};
 window.replaceVideo=next=>{if(next){clip=next;history.pushState({},'','/watch?v='+next);}const old=document.querySelector('#v'),video=document.createElement('video');video.id='v';old.replaceWith(video);attach(video);};
 window.nextSocial=()=>{const old=document.querySelector('#v'),article=document.createElement('article');article.className='video-card';const video=document.createElement('video');video.id='v';article.append(video);old.closest('article').replaceWith(article);attach(video,'/tiny.webm?post='+Date.now());};
 const thumb=document.querySelector('#thumb');
 thumb.addEventListener('pointerenter',()=>{
  if(document.querySelector('#preview'))return;
  const shell=document.createElement(qa.youtube?'ytd-video-preview':'div');shell.id='preview-shell';if(!qa.youtube)shell.className='bili-video-card';
  const inner=document.createElement('div');if(qa.youtube){inner.id='inline-preview-player';inner.className='html5-video-player';}
  const video=document.createElement('video');video.id='preview';inner.append(video);shell.append(inner);document.body.append(shell);
  setTimeout(()=>{if(!video.isConnected)return;qa.previewEmptyId=video.getAttribute('data-video-control-id');attach(video,'/tiny.webm?preview=1');},150);
 });
 thumb.addEventListener('pointerleave',()=>{const video=document.querySelector('#preview');video?.pause();document.querySelector('#preview-shell')?.remove();});
 document.addEventListener('keydown',event=>{qa.lastKeyPrevented=event.defaultPrevented;});
 const main=document.querySelector('#v');if(main){if(hidden)main.style.opacity='0';attach(main);}qa.ready=true;
}
function fixture(url){
 const youtube=url.hostname==='www.youtube.com',social=!youtube&&url.hostname!=='www.bilibili.com';
 const only=url.searchParams.has('previewOnly'),hidden=url.searchParams.has('hidden');
 const primary=youtube?'<div id="movie_player" class="html5-video-player"><video id="v"></video></div>':
 social?'<article class="video-card"><video id="v"></video></article>':'<div class="bpx-player-container"><video id="v"></video></div>';
 return '<!doctype html><meta charset="utf-8"><title>Main media fixture</title><style>body{margin:20px}video{width:640px;height:360px;display:block}#thumb{display:block;width:180px;height:50px;margin-top:20px}#preview{width:320px;height:180px}#away{position:fixed;right:5px;top:5px}</style>'+
 (only?'':primary)+'<button id="thumb">Preview</button><button id="away">Away</button><script>('+browserFixture.toString()+')('+JSON.stringify({youtube,social,hidden})+');</script>';
}
async function check(name,fn){await fn();report.checks.push({name,pass:true});}
async function memory(){return (await serviceWorker.evaluate(()=>chrome.storage.local.get('lastRate'))).lastRate;}
try{
 context=await chromium.launchPersistentContext(path.join(profile,'profile'),{executablePath:process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath(),headless:true,
  args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--disable-background-networking','--no-first-run','--autoplay-policy=no-user-gesture-required']});
 context.on('page',item=>item.on('pageerror',error=>report.errors.push(String(error))));context.pages()[0]?.on('pageerror',error=>report.errors.push(String(error)));
 const hosts=['www.youtube.com','www.bilibili.com','www.facebook.com','www.instagram.com','www.tiktok.com'];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol==='chrome-extension:')return route.continue();
  if(url.protocol!=='http:'||!hosts.includes(url.hostname))return route.abort();
  return route.fulfill(url.pathname==='/tiny.webm'?{status:200,contentType:'video/webm',body:bytes}:{status:200,contentType:'text/html',body:fixture(url)});});
 serviceWorker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await serviceWorker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,defaultMode:'follow',qualityEnabled:false},lastRate:2,lastRateRevision:1}));
 page=context.pages()[0];
 await page.goto('http://www.youtube.com/watch?v=A&hidden=1');
 await page.waitForFunction(()=>qa?.ready&&document.querySelector('#v').playbackRate===2);
 await check('hidden setup creates no automatic toast',async()=>{await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>qa.notices.length),0);});
 await page.evaluate(()=>reveal());await page.waitForFunction(()=>qa.notices.length===1);
 await check('the initial notice follows the first visible frame',async()=>{const e=await page.evaluate(()=>({notices:qa.notices,frames:qa.frames}));assert.ok(e.frames[0]);assert.ok(e.notices[0].at>=e.frames[0].at);report.main=e;});
 await page.waitForTimeout(1250);await page.evaluate(()=>replaceVideo());
 await page.waitForFunction(()=>qa.cycle===2&&document.querySelector('#v').playbackRate===2);await page.waitForTimeout(450);
 await check('replacing the element for the same route does not repeat the notice',async()=>assert.equal(await page.evaluate(()=>qa.notices.length),1));
 await page.evaluate(()=>replaceVideo('B'));await page.waitForFunction(()=>qa.notices.length===2);
 await check('a different main video gets one new notice',async()=>assert.equal(await page.evaluate(()=>qa.notices.at(-1).text),'2×'));
 await page.keyboard.press('Shift+Comma');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75);
 await check('manual feedback remains immediate',async()=>assert.equal(await page.locator('#video-control-toast').evaluate(el=>el.shadowRoot.querySelector('span').textContent),'1.75×'));
 await page.reload();await page.waitForFunction(()=>qa.notices.length===1&&document.querySelector('#v').playbackRate===1.75);
 await check('reloading the same video initializes and notifies again',async()=>assert.equal(await page.evaluate(()=>qa.notices[0].text),'1.75×'));
 for(const host of ['www.youtube.com','www.bilibili.com']){
  const platform=host.includes('youtube')?'youtube':'bilibili';
  await page.goto('http://'+host+'/watch?v=A');await page.waitForFunction(()=>qa.notices.length===1&&document.querySelector('#v').playbackRate===1.75);
  await page.waitForFunction(()=>!document.querySelector('#video-control-toast'));
  const primary=await page.locator('#v').getAttribute('data-video-control-id'),memoryBefore=await memory();
  await page.locator('#thumb').hover();await page.waitForFunction(()=>document.querySelector('#preview')?.readyState>=2&&!document.querySelector('#preview').paused);await page.waitForTimeout(450);
  await check(platform+' preview has no identity, defaults, toast or memory writes',async()=>{
   const evidence=await page.evaluate(()=>({rate:document.querySelector('#preview').playbackRate,defaultRate:document.querySelector('#preview').defaultPlaybackRate,id:document.querySelector('#preview').getAttribute('data-video-control-id'),emptyId:qa.previewEmptyId,notices:qa.notices.length,identities:[...document.querySelectorAll('video[data-video-control-id]')].map(v=>v.id)}));
   assert.equal(evidence.rate,1);assert.equal(evidence.defaultRate,1);assert.equal(evidence.id,null);assert.equal(evidence.emptyId,null);assert.equal(evidence.notices,1);assert.deepEqual(evidence.identities,['v']);assert.equal(await memory(),memoryBefore);report[platform]=evidence;
  });
  await page.keyboard.press('Shift+Period');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===2);
  await check(platform+' hovering B keeps shortcuts and feedback on A',async()=>{
   assert.equal(await page.locator('#preview').evaluate(v=>v.playbackRate),1);assert.equal(await page.locator('#v').getAttribute('data-video-control-id'),primary);
   assert.equal(await page.locator('#video-control-toast').evaluate(el=>el.shadowRoot.querySelector('span').textContent),'2×');
   await page.screenshot({path:path.join(output,platform+'-primary-with-preview.png')});
  });
  await page.locator('#away').hover();await page.waitForFunction(()=>!document.querySelector('#preview'));await page.keyboard.press('Shift+Comma');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75);
  await check(platform+' removing B leaves A immediately controllable',async()=>assert.equal(await page.locator('#v').getAttribute('data-video-control-id'),primary));
  await page.goto('http://'+host+'/?previewOnly=1');await page.locator('#thumb').hover();await page.waitForFunction(()=>document.querySelector('#preview')?.readyState>=2);await page.waitForTimeout(400);
  await page.keyboard.press('Shift+Comma');await page.waitForTimeout(200);
  await check(platform+' preview-only pages have no extension target or shortcut interception',async()=>{
   assert.equal(await page.locator('#preview').evaluate(v=>v.playbackRate),1);assert.equal(await page.evaluate(()=>qa.notices.length),0);
   assert.equal(await page.evaluate(()=>qa.lastKeyPrevented),false);assert.equal(await page.locator('video[data-video-control-id]').count(),0);
  });
 }
 for(const host of ['www.facebook.com','www.instagram.com','www.tiktok.com']){
  await page.goto('http://'+host+'/feed');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75&&qa.notices.length===1);
  const old=await page.locator('#v').getAttribute('data-video-control-id');await page.waitForFunction(()=>!document.querySelector('#video-control-toast'));
  await page.evaluate(()=>nextSocial());await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75&&qa.notices.length===2);
  await check(host+' dynamic feed videos retain initialization and keyboard control',async()=>{
   assert.notEqual(await page.locator('#v').getAttribute('data-video-control-id'),old);
   await page.keyboard.press('Shift+Period');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===2);
   assert.equal(await page.locator('#video-control-toast').evaluate(el=>el.shadowRoot.querySelector('span').textContent),'2×');
   await page.keyboard.press('Shift+Comma');await page.waitForFunction(()=>document.querySelector('#v').playbackRate===1.75);
  });
 }
 assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error?.stack||error);process.exitCode=1;}
finally{
 await context?.close().catch(()=>{});const resolved=await realpath(profile),relative=path.relative(path.resolve(os.tmpdir()),resolved);
 if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('videospeed-notice-')){await rm(resolved,{recursive:true,force:true});report.cleanup=true;}
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
