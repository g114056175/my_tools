import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {createDiscoveryIntent,existingMediaResources,stopPageObservation} from '../extension/discovery-intent.js';

function harness(options={}){
 const calls=[],timers=new Map();let next=0;
 const controller=createDiscoveryIntent({start:async id=>{calls.push(['start',id]);await options.start?.(id);},stop:async id=>{calls.push(['stop',id]);await options.stop?.(id);},renew:async id=>calls.push(['renew',id]),setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 return {controller,calls,timers,tick:async()=>{for(const fn of [...timers.values()])fn();await new Promise(resolve=>setImmediate(resolve));}};
}
function port(url='extension/popup.html'){
 const messages=[],disconnects=[];
 return {sender:{url},onMessage:{addListener:fn=>messages.push(fn)},onDisconnect:{addListener:fn=>disconnects.push(fn)},send:value=>messages.forEach(fn=>fn(value)),close:()=>disconnects.forEach(fn=>fn())};
}

test('idle construction starts no work; the last holder stops observation and timer',async()=>{
 const {controller,calls,timers,tick}=harness();assert.equal(calls.length,0);assert.equal(timers.size,0);
 const one=controller.acquire(7),two=controller.acquire(7);await Promise.all([one.ready,two.ready]);
 assert.deepEqual(calls,[['start',7]]);assert.equal(timers.size,1);await tick();
 assert.deepEqual(calls.at(-1),['renew',7]);await one.release();assert.equal(controller.active(7),true);
 await two.release();assert.equal(controller.active(7),false);assert.equal(timers.size,0);assert.deepEqual(calls.at(-1),['stop',7]);
 await two.release();assert.equal(calls.filter(c=>c[0]==='stop').length,1);
});

test('popup close stops its tab while an explicitly requested subtitle task may finish',async()=>{
 const {controller,calls}=harness(),view=port();controller.attach(view,'extension/popup.html');view.send({action:'observeMedia',tabId:1});
 let finish;const operation=controller.run(1,()=>new Promise(resolve=>finish=resolve));
 await new Promise(resolve=>setImmediate(resolve));view.close();assert.equal(controller.active(1),true);
 finish('captions');assert.equal(await operation,'captions');assert.equal(controller.active(1),false);assert.deepEqual(calls,[['start',1],['stop',1]]);
});

test('a rapid reopen never lets late disposal kill the new observation',async()=>{
 let releaseStop;const {controller,calls}=harness({stop:()=>new Promise(resolve=>releaseStop=resolve)});
 const old=controller.acquire(3);await old.ready;const stopping=old.release();await new Promise(resolve=>setImmediate(resolve));
 const current=controller.acquire(3);releaseStop();await stopping;await current.ready;
 assert.equal(controller.active(3),true);assert.deepEqual(calls,[['start',3],['stop',3],['start',3]]);
 const end=current.release();await new Promise(resolve=>setImmediate(resolve));releaseStop();await end;
});

test('disconnect before queued start and untrusted ports do not trigger exploration',async()=>{
 const {controller,calls,timers}=harness(),view=port();controller.attach(view,'extension/popup.html');view.send({action:'observeMedia',tabId:1});view.close();
 const bad=port('https://site.test');controller.attach(bad,'extension/popup.html');bad.send({action:'observeMedia',tabId:2});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);assert.equal(timers.size,0);
});

test('failed work and partial startup release observations without masking the work result',async()=>{
 const a=harness();await assert.rejects(a.controller.run(5,()=>{throw new Error('probe failed');}),/probe failed/);assert.deepEqual(a.calls,[['start',5],['stop',5]]);assert.equal(a.timers.size,0);
 const b=harness({start:()=>{throw new Error('start failed');}});await assert.rejects(b.controller.run(5,()=>{}),/start failed/);assert.deepEqual(b.calls,[['start',5],['stop',5]]);assert.equal(b.timers.size,0);
});

test('resource recovery reads only bounded existing media URLs and leaves ownership to later validation',()=>{
 const resource=name=>({name,startTime:180000}),old=Array.from({length:210},(_,i)=>resource(`https://cdn.test/old-${i}.mp4`)),timeOrigin=Date.now()-180000;
 const records=[...old,resource('https://cdn.test/master.m3u8'),resource('https://cdn.test/segment.ts'),resource('https://user:secret@cdn.test/file.mp4'),resource('data:video/mp4,stuff'),resource('https://cdn.test/master.m3u8'),{name:'https://cdn.test/previous-video.mp4',startTime:0}];
 const context={location:{href:'https://page.test/player'},performance:{timeOrigin,getEntriesByType:type=>{assert.equal(type,'resource');return records;}},URL,Date};
 const result=vm.runInNewContext(`(${existingMediaResources.toString()})()`,context);
 assert.equal(result.length,40);assert.equal(result.at(-1).url,'https://cdn.test/master.m3u8');assert.ok(result.every(r=>r.pageUrl===context.location.href&&!('method'in r)&&!('mime'in r)&&!('headers'in r)));
 assert.ok(!result.some(r=>/segment|secret|data:|previous-video/.test(r.url)));assert.equal(result.at(-1).timeStamp,timeOrigin+180000);
});

test('release drops the selection DOM cache but retains weak player identities',()=>{
 const root={},ids={keys:new WeakMap()};let stopped=0;root[Symbol.for('video-pocket.identities')]=ids;root[Symbol.for('video-pocket.mediaObserver')]={dispose:()=>stopped++};root[Symbol.for('video-pocket.selection')]={videos:[{}]};
 vm.runInNewContext(`(${stopPageObservation.toString()})()`,{globalThis:root,Symbol});assert.equal(stopped,1);assert.equal(root[Symbol.for('video-pocket.selection')],undefined);assert.equal(root[Symbol.for('video-pocket.identities')],ids);
});

test('the shipped manifest has no automatic media observer content script',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 assert.ok(!(manifest.content_scripts||[]).some(script=>script.js?.includes('media-observer.js')));
});
