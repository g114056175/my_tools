import test from 'node:test';
import assert from 'node:assert/strict';
import {StartupHandshake} from '../src/startup-handshake.js';
const ready={ok:true,settings:{enabled:true}};
const options=request=>({request,accept:response=>!!response.settings,delays:[1,1],timeout:15});

test('a single failed worker wake retries without a popup or a new page event',async()=>{
 let calls=0,accepted=0;
 const startup=new StartupHandshake({...options(async()=>++calls===1?null:ready),accept:()=>{accepted++;return true;}});
 assert.equal(await startup.ensure(),true);assert.equal(calls,2);assert.equal(accepted,1);
 assert.equal(startup.snapshot().status,'ready');
});
test('receiver rejection and a hanging response cannot trap initial configuration',async()=>{
 let calls=0;
 const startup=new StartupHandshake(options(()=>{calls++;if(calls===1)throw Error('Receiving end does not exist');if(calls===2)return new Promise(()=>{});return ready;}));
 assert.equal(await startup.ensure(),true);assert.equal(calls,3);assert.equal(startup.snapshot().error,'');
});
test('an unfinished document wake is single flight across load and playback events',async()=>{
 let finish,calls=0;
 const startup=new StartupHandshake(options(()=>{calls++;return new Promise(resolve=>finish=resolve);}));
 const first=startup.ensure(),second=startup.ensure({reason:'playing'});
 assert.equal(first,second);await Promise.resolve();finish(ready);
 assert.equal(await first,true);assert.equal(calls,1);
});
test('exhaustion stops timers; a later real event can resume configuration',async()=>{
 let available=false,calls=0;
 const startup=new StartupHandshake(options(async()=>{calls++;return available?ready:null;}));
 assert.equal(await startup.ensure(),false);assert.equal(calls,3);assert.equal(startup.snapshot().status,'waiting');
 available=true;assert.equal(await startup.ensure({reason:'focus'}),true);assert.equal(calls,4);
});
test('an inactive document does not keep retrying a failed wake',async()=>{
 let calls=0;
 const startup=new StartupHandshake({...options(async()=>{calls++;return null;}),mayRetry:()=>false});
 assert.equal(await startup.ensure(),false);assert.equal(calls,1);
});
test('an incoming configuration cancels a pending retry and a late response',async()=>{
 let finish,accepted=0;
 const startup=new StartupHandshake({...options(()=>new Promise(resolve=>finish=resolve)),accept:()=>{accepted++;return true;}});
 const pending=startup.ensure();await Promise.resolve();startup.acknowledge();
 assert.equal(await pending,true);finish(ready);await Promise.resolve();
 assert.equal(accepted,0);assert.equal(startup.snapshot().status,'ready');
});
test('context invalidation and disposal prevent another native request',async()=>{
 let alive=true,calls=0;
 const startup=new StartupHandshake({...options(async()=>{calls++;alive=false;return null;}),alive:()=>alive});
 assert.equal(await startup.ensure(),false);assert.equal(calls,1);
 startup.dispose();assert.equal(await startup.ensure({force:true}),false);assert.equal(calls,1);
});
test('a thrown configuration bug is recorded and reported, not retried as a transport failure',async()=>{
 let calls=0,error;
 const startup=new StartupHandshake({...options(async()=>{calls++;return ready;}),accept:()=>{throw Error('configuration bug');},onError:value=>error=value});
 assert.equal(await startup.ensure(),false);assert.equal(calls,1);assert.match(error.message,/configuration bug/);assert.equal(startup.snapshot().status,'failed');
});
