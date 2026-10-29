import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeMessenger,setActionIcon} from '../src/runtime.js';

test('setIcon waits for the native callback and consumes its closed-tab error',async()=>{
 let callback,inside=false,reads=0,settled=false;
 const runtime={get lastError(){assert.ok(inside,'lastError must be read in the callback');reads++;return {message:'No tab with id: 12.'};}};
 const action={setIcon(_details,listener){callback=listener;return Promise.resolve();}};
 const result=setActionIcon(action,runtime,{tabId:12,path:'icons/16.png'});
 const checked=assert.rejects(result,/No tab with id: 12/).finally(()=>{settled=true;});
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false,'early native promise is not completion');
 inside=true;callback();inside=false;await checked;assert.equal(reads,1);
});

test('setIcon succeeds through the callback and propagates binding failures',async()=>{
 await setActionIcon({setIcon(_details,callback){callback();}},{},{path:'icons/16.png'});
 await assert.rejects(setActionIcon({setIcon(){throw Error('invalid icon');}},{},{}),/invalid icon/);
 await assert.rejects(setActionIcon({setIcon(){return Promise.reject(Error('binding failed'));}},{},{}),/binding failed/);
});

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

test('disconnect consumes callback-scoped lastError before checking context liveness',()=>{
 let inside=false,reads=0,listener,removed=0;const order=[],messages=[];
 const runtime={id:'live',getManifest(){if(inside)order.push('alive');return {};},get lastError(){assert.ok(inside);reads++;order.push('error');return {message:'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.'};}};
 const event={addListener(value){listener=value;},removeListener(value){assert.equal(value,listener);removed++;}};
 const messenger=createRuntimeMessenger(runtime),stop=messenger.listenDisconnect({onDisconnect:event},error=>messages.push(error));
 inside=true;listener();inside=false;
 assert.equal(reads,1);assert.deepEqual(order,['error','alive']);assert.match(messages[0],/back\/forward cache/);assert.equal(messenger.alive(),true);
 stop();stop();assert.equal(removed,1);
});

test('a disconnected invalid context disposes without another native liveness call',()=>{
 let listener,disposed=0,callbacks=0,checks=0,invalid=false;
 const runtime={id:'old',getManifest(){checks++;assert.equal(invalid,false);return {};},get lastError(){return invalid?{message:'Extension context invalidated.'}:undefined;}};
 const messenger=createRuntimeMessenger(runtime,()=>disposed++);
 messenger.listenDisconnect({onDisconnect:{addListener(value){listener=value;}}},()=>callbacks++);
 const before=checks;invalid=true;assert.doesNotThrow(()=>listener());
 assert.equal(disposed,1);assert.equal(callbacks,0);assert.equal(checks,before);assert.equal(messenger.alive(),false);
});

test('a port getter invalidated during connection is caught and produces a safe no-op cleanup',()=>{
 let disposed=0;const messenger=createRuntimeMessenger({id:'old'},()=>disposed++);
 const stop=messenger.listenDisconnect({get onDisconnect(){throw Error('Extension context invalidated.');}},()=>assert.fail());
 assert.equal(disposed,1);assert.doesNotThrow(stop);assert.equal(messenger.alive(),false);
});
