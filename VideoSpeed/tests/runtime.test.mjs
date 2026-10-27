import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeMessenger} from '../src/runtime.js';

test('send catches synchronous context invalidation and disposes once',async()=>{
 let calls=0,disposed=0;
 const runtime={id:'test',sendMessage(){calls++;throw Error('Extension context invalidated.');}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 assert.equal(await messenger.send({}),null);
 assert.equal(await messenger.send({}),null);
 assert.equal(calls,1);
 assert.equal(disposed,1);
 assert.equal(messenger.alive(),false);
});

test('send catches rejected context invalidation and a context-invalidated dispose error',async()=>{
 let calls=0,disposed=0;
 const runtime={id:'x',sendMessage:async()=>{calls++;throw Error('Extension context invalidated.');}};
 const messenger=createRuntimeMessenger(runtime,()=>{disposed++;throw Error('Extension context invalidated.');});
 assert.equal(await messenger.send({}),null);
 assert.equal(await messenger.send({}),null);
 assert.equal(calls,1);
 assert.equal(disposed,1);
});

test('missing runtime id invalidates once',async()=>{
 let disposed=0,calls=0;
 const runtime={id:'x',sendMessage:async()=>{calls++;return null;}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 delete runtime.id;
 await messenger.send({});
 await messenger.send({});
 assert.equal(calls,0);
 assert.equal(disposed,1);
});

test('a liveness check disposes immediately when runtime id disappears',()=>{
 let disposed=0;
 const runtime={id:'x'},messenger=createRuntimeMessenger(runtime,()=>disposed++);
 delete runtime.id;
 assert.equal(messenger.alive(),false);
 assert.equal(disposed,1);
 assert.equal(messenger.alive(),false);
 assert.equal(disposed,1);
});

test('cached runtime id does not keep an invalidated native context alive',()=>{
 let disposed=0,checks=0;
 const runtime={id:'still-readable',getManifest(){checks++;throw Error('Extension context invalidated.');}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 assert.equal(messenger.alive(),false);
 assert.equal(disposed,1);
 assert.equal(messenger.alive(),false);
 assert.equal(checks,1);
});

test('listener registration catches invalidation while runtime.id remains readable',()=>{
 let disposed=0,attempts=0;
 const runtime={id:'still-readable'};
 const event={addListener(){attempts++;throw Error('Extension context invalidated.');}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 messenger.listen(event,()=>{});
 assert.equal(runtime.id,'still-readable');
 assert.equal(messenger.alive(),false);
 assert.equal(attempts,1);
 assert.equal(disposed,1);
});

test('call catches context invalidation from connect while runtime.id remains readable',()=>{
 let disposed=0,calls=0;
 const runtime={id:'still-readable',connect(){calls++;throw Error('Extension context invalidated.');}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 assert.equal(messenger.call(runtime,'connect',{name:'content'}),null);
 assert.equal(runtime.id,'still-readable');
 assert.equal(messenger.alive(),false);
 assert.equal(calls,1);
 assert.equal(disposed,1);
});

test('listener cleanup catches invalidation and dispose errors without rejecting',()=>{
 let disposed=0,removed=0;
 const runtime={id:'test'};
 const event={
  addListener(){},
  removeListener(){removed++;throw Error('Extension context invalidated.');},
 };
 const messenger=createRuntimeMessenger(runtime,()=>{disposed++;throw Error('Extension context invalidated.');});
 const unlisten=messenger.listen(event,()=>{});
 assert.doesNotThrow(()=>unlisten());
 assert.equal(messenger.alive(),false);
 assert.equal(removed,1);
 assert.equal(disposed,1);
});

test('guard handles async listener invalidation without an unhandled rejection',async()=>{
 let disposed=0;
 const messenger=createRuntimeMessenger({id:'test'},()=>disposed++);
 const listener=messenger.guard(async()=>{throw Error('Extension context invalidated.');});
 assert.equal(await listener(),null);
 assert.equal(messenger.alive(),false);
 assert.equal(disposed,1);
});

test('a guarded response stops after its context is invalidated during an async request',async()=>{
 let valid=true,replies=0,disposed=0;
 const runtime={id:'test',getManifest(){if(!valid)throw Error('Extension context invalidated.');return {};}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++),respond=messenger.guard(()=>replies++);
 const pending=Promise.resolve().then(()=>respond({ok:true}));valid=false;
 assert.equal(await pending,null);assert.equal(replies,0);assert.equal(disposed,1);
});

test('ordinary receiver failure does not dispose a live content script',async()=>{
 let disposed=0;
 const runtime={id:'x',sendMessage:async()=>{throw Error('Could not establish connection. Receiving end does not exist.');}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 assert.equal(await messenger.send({}),null);
 assert.equal(disposed,0);
 assert.equal(messenger.alive(),true);
});

test('guard rethrows programming errors and invalidate does not hide dispose bugs',()=>{
 const messenger=createRuntimeMessenger({id:'test'});
 assert.throws(()=>messenger.guard(()=>{throw Error('listener bug');})(),/listener bug/);
 const broken=createRuntimeMessenger({id:'test'},()=>{throw Error('dispose bug');});
 assert.throws(()=>broken.invalidate(),/dispose bug/);
});
