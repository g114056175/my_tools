import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),extension=path.join(root,'extension');
const output=path.join(root,'work/qa-077-network');await mkdir(output,{recursive:true});
const bytes=await readFile(path.join(root,'tests/fixtures/tiny.webm'));
const report={version:JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8')).version,checks:[],errors:[],cleanup:false,scope:'Real HTTP response delay and two isolated browser windows, with a local YouTube player fixture. No popup or real-site requests.'};
const files=(await readdir(extension,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(f=>path.relative(extension,path.join(f.parentPath,f.name)).replaceAll('\\','/')).sort();
const digest=createHash('sha256');for(const file of files)digest.update(file).update('\0').update(await readFile(path.join(extension,file))).update('\0');report.runtimeSha256=digest.digest('hex');
const profile=await mkdtemp(path.join(os.tmpdir(),'videospeed-network-'));let context,server,worker;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label,timeout=25000){const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await delay(50);}throw Error(label);}
function html(mode){return `<!doctype html><title>Delayed ${mode}</title><style>video{width:640px;height:360px}</style><div id="movie_player" class="html5-video-player"><video id="v" autoplay muted loop playsinline></video></div><script>
const p=document.querySelector('#movie_player'),v=document.querySelector('#v');window.qa={setters:[],started:Date.now()};
p.getVideoData=()=>({video_id:'network',title:'Delayed network'});p.getPlayerResponse=()=>({videoDetails:{videoId:'network'}});
p.getAvailableQualityLevels=()=>['hd1080','hd720'];p.setPlaybackQualityRange=(a,b)=>qa.setters.push([a,b]);
v.src='/${mode==='media'?'slow':'fast'}.webm';v.play().catch(()=>{});</script>`;}
try{
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/slow.webm')await delay(16000);
  if(url.pathname.endsWith('.webm')){if(!res.destroyed){res.writeHead(200,{'content-type':'video/webm','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);}return;}
  if(url.pathname==='/late-doc')await delay(16000);
  if(res.destroyed)return;res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(url.pathname==='/away'?'<title>Away</title>':html(url.pathname==='/late-doc'?'document':'media'));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://www.youtube.com:'+server.address().port;
 context=await chromium.launchPersistentContext(path.join(profile,'profile'),{executablePath:process.env.VIDEOSPEED_CHROMIUM||chromium.executablePath(),headless:true,args:['--load-extension='+extension,'--disable-extensions-except='+extension,'--autoplay-policy=no-user-gesture-required','--disable-background-networking','--no-first-run','--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});
 context.on('page',page=>page.on('pageerror',e=>report.errors.push(e.message)));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await wait(async()=>Number.isSafeInteger((await worker.evaluate(()=>chrome.storage.local.get('lastRateRevision'))).lastRateRevision),'Initial memory seed');
 await worker.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,defaultMode:'custom',customRate:4,qualityEnabled:true,preferredQuality:1080}}));
 for(const mode of ['media','document']){
  const mediaWindow=await worker.evaluate(()=>chrome.windows.create({url:'about:blank',focused:true}));
  const tabId=mediaWindow.tabs[0].id;
  await worker.evaluate(({tabId,url})=>{chrome.tabs.update(tabId,{url}).catch(()=>{});}, {tabId,url:base+(mode==='document'?'/late-doc':'/watch')+'?v=network'});
  await wait(async()=>{const a=(await worker.evaluate(()=>chrome.storage.session.get('tabActivity'))).tabActivity;return a?.focusedTabId===tabId&&a.loadingUntilByTab?.[tabId]>Date.now();},'Loading intent was not captured');
  const awayWindow=await worker.evaluate(url=>chrome.windows.create({url,focused:true}),base+'/away');
  const blurAt=Date.now();await wait(async()=>(await worker.evaluate(()=>chrome.windows.getLastFocused())).id===awayWindow.id,'Second window not focused');
  const page=await wait(()=>context.pages().find(p=>p.url().includes(mode==='document'?'/late-doc':'/watch')),'Fixture document not loaded');
  if(mode==='media'){
   await page.waitForFunction(()=>document.querySelector('#v')&&!document.querySelector('#v').paused&&document.querySelector('#v').readyState===0);
   report.pendingNetworkConfirmed=true;
  }
  await page.waitForFunction(()=>document.querySelector('#v')?.playbackRate===4&&document.querySelector('#v').readyState>=2&&qa.setters.length===1,null,{timeout:25000});
  const evidence=await page.evaluate(()=>({rate:v.playbackRate,defaultRate:v.defaultPlaybackRate,ready:v.readyState,paused:v.paused,quality:qa.setters}));
  const activeWindow=await worker.evaluate(()=>chrome.windows.getLastFocused());assert.equal(activeWindow.id,awayWindow.id);assert.ok(Date.now()-blurAt>10000);assert.equal(evidence.rate,4);assert.equal(evidence.defaultRate,4);
  report.checks.push({mode,pass:true,elapsedAfterWindowSwitch:Date.now()-blurAt,...evidence});
  await worker.evaluate(ids=>Promise.all(ids.map(id=>chrome.windows.remove(id))),[mediaWindow.id,awayWindow.id]);
 }
 assert.deepEqual(report.errors,[]);
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
 await context?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 const absolute=await realpath(profile),relative=path.relative(os.tmpdir(),absolute);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(absolute).startsWith('videospeed-network-'));await rm(absolute,{recursive:true,force:true});report.cleanup=true;
 await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
