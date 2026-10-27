#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const extension=path.join(root,'extension'),output=path.join(root,'work/qa-language');
const version=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8')).version;
const cases=[
 {name:'english-delay',language:'en',browser:'en-US',fault:'delay'},
 {name:'english-read-failure',language:'en',browser:'en-US',fault:'reject'},
 {name:'chinese-browser-without-preference',language:null,browser:'zh-TW',fault:'delay'},
 {name:'explicit-chinese',language:'zh-Hant',browser:'en-US',fault:'delay'},
];
const report={version,checks:[],runtimeHashes:{},coverage:'Isolated Chromium extension pages at 420px; storage faults are injected by the test, not natural storage failures. Native toolbar popup chrome is not covered.'};
const runtimeHash=createHash('sha256');
async function hashTree(directory,prefix=''){
 for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=prefix+entry.name,file=path.join(directory,entry.name);
  if(entry.isDirectory())await hashTree(file,name+'/');
  else{const bytes=await readFile(file);report.runtimeHashes[name]=createHash('sha256').update(bytes).digest('hex');runtimeHash.update(name).update('\0').update(bytes).update('\0');}
 }
}
await hashTree(extension);report.runtimeSha256=runtimeHash.digest('hex');

function recordFirstFrames({fault}){
 const qa={samples:[],hooked:false,settled:false};globalThis.__qaLanguage=qa;
 const visible=node=>!!node?.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden]');
 function sample(){
  const power=document.getElementById('enabled');
  const text=[...document.querySelectorAll('body *')].filter(visible).map(node=>[node.childElementCount?'':node.textContent,node.getAttribute('title'),node.getAttribute('aria-label')].filter(Boolean).join(' ')).join(' ');
  qa.samples.push({language:document.documentElement.lang,text,cjk:/[\u3400-\u9fff]/u.test(text),busy:document.body?.getAttribute('aria-busy'),power:power?.getAttribute('aria-pressed'),settled:qa.settled});
  if(qa.samples.length<180)requestAnimationFrame(sample);
 }
 const storage=chrome.storage.local,original=storage.get.bind(storage);let first=true;
 const wrapped=(...args)=>{
  if(!first)return original(...args);first=false;
  const response=fault==='reject'?null:original(...args);
  return new Promise((resolve,reject)=>setTimeout(()=>{
   qa.settled=true;
   if(fault==='reject')reject(Error('QA storage read failure'));
   else Promise.resolve(response).then(resolve,reject);
  },500));
 };
 Object.defineProperty(storage,'get',{configurable:true,writable:true,value:wrapped});
 qa.hooked=storage.get===wrapped;requestAnimationFrame(sample);
}

await mkdir(output,{recursive:true});
for(const item of cases){
 let context,temporary;
 const result={name:item.name,pass:false};
 try{
  temporary=await mkdtemp(path.join(os.tmpdir(),'videospeed-language-'));
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{
   ...(process.env.VIDEOSPEED_CHROMIUM?{executablePath:process.env.VIDEOSPEED_CHROMIUM}:{}),
   headless:true,viewport:{width:420,height:640},
   args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--disable-background-networking','--no-first-run','--lang='+item.browser,'--accept-lang='+item.browser],
  });
  await context.route(/^https?:\/\//,route=>route.abort());
  report.chromium=context.browser().version();
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async language=>{
   await chrome.storage.local.set({settings:{enabled:true},popupTheme:'dark'});
   if(language)await chrome.storage.local.set({popupLanguage:language});
   else await chrome.storage.local.remove('popupLanguage');
  },item.language);
  const page=await context.newPage();
  await page.addInitScript(recordFirstFrames,{fault:item.fault});
  await page.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html',{waitUntil:'commit'});
  await page.waitForFunction(()=>globalThis.__qaLanguage?.hooked&&document.body?.getAttribute('aria-busy')==='true');
  await page.screenshot({path:path.join(output,item.name+'-loading.png'),clip:{x:0,y:0,width:420,height:40}});
  await page.waitForFunction(()=>globalThis.__qaLanguage?.settled&&document.getElementById('enabled')?.getAttribute('aria-pressed')==='true'&&document.body?.getAttribute('aria-busy')!=='true');
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  result.samples=await page.evaluate(()=>globalThis.__qaLanguage.samples);
  const initial=result.samples.filter(sample=>!sample.settled&&sample.busy==='true');
  assert.ok(initial.length,'No rendered loading frame was captured');
  assert.ok(initial.every(sample=>!sample.cjk&&sample.power!=='false'),'Initial frame leaked Chinese or a false disabled state');
  const expected=item.language==='zh-Hant'?'zh-Hant':'en';
  assert.equal(await page.locator('html').getAttribute('lang'),expected);
  if(expected==='en')assert.ok(result.samples.every(sample=>!sample.cjk),'Chinese leaked into an English UI frame');
  else assert.ok(result.samples.some(sample=>sample.cjk&&sample.language==='zh-Hant'),'Explicit Chinese preference was ignored');
  await page.screenshot({path:path.join(output,item.name+'-ready.png'),fullPage:true});
  result.pass=true;
 }catch(error){result.error=String(error?.stack||error);}
 finally{
  await context?.close();
  if(temporary){
   const resolved=await realpath(temporary),relative=path.relative(path.resolve(os.tmpdir()),resolved);
   assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('videospeed-language-'));
   await rm(resolved,{recursive:true,force:true});result.profileRemoved=true;
  }
  report.checks.push(result);
 }
}
await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log('VideoSpeed language check: '+report.checks.filter(item=>item.pass).length+'/'+cases.length+' passed');
console.log('Report: '+path.join(output,'results.json'));
if(report.checks.some(item=>!item.pass)){console.error(report.checks.filter(item=>!item.pass).map(item=>item.error).join('\n'));process.exitCode=1;}
