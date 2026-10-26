import test from 'node:test';
import assert from 'node:assert/strict';
import {RateMemory,RateWriteLedger} from '../src/rate-memory.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class LocalStorage{
 constructor(data={}){this.data={...data};this.sets=[];this.log=[];this.getImpl=null;this.setImpl=null;}
 async get(keys){
  this.log.push('get:start');
  const result=this.getImpl?await this.getImpl(keys):Object.fromEntries(keys.filter(key=>Object.hasOwn(this.data,key)).map(key=>[key,this.data[key]]));
  this.log.push('get:done');return result;
 }
 async set(values){
  this.log.push('set:start');if(this.setImpl)await this.setImpl(values);
  this.sets.push({...values});Object.assign(this.data,values);this.log.push('set:done');
 }
}

test('serializes a confirmed write behind a delayed initial read',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:4}),entered=deferred(),release=deferred();
 storage.getImpl=async keys=>{entered.resolve();await release.promise;return Object.fromEntries(keys.filter(key=>Object.hasOwn(storage.data,key)).map(key=>[key,storage.data[key]]));};
 const memory=new RateMemory(storage),read=memory.read();await entered.promise;
 const write=memory.remember(1.5,'command');assert.equal(storage.sets.length,0);
 release.resolve();
 assert.deepEqual(await read,{lastRate:2,rateRevision:4});
 assert.deepEqual(await write,{lastRate:1.5,rateRevision:5});
 assert.deepEqual(storage.data,{lastRate:1.5,lastRateRevision:5});
 assert.deepEqual(storage.log,['get:start','get:done','set:start','set:done']);
});

test('a read queued after a delayed confirmed write sees its acknowledged revision',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:7}),entered=deferred(),release=deferred();
 storage.getImpl=async keys=>{entered.resolve();await release.promise;return Object.fromEntries(keys.filter(key=>Object.hasOwn(storage.data,key)).map(key=>[key,storage.data[key]]));};
 const memory=new RateMemory(storage),write=memory.remember(1.25,'native');await entered.promise;
 const read=memory.read();release.resolve();
 assert.deepEqual(await write,{lastRate:1.25,rateRevision:8});
 assert.deepEqual(await read,{lastRate:1.25,rateRevision:8});
});

test('a newer write supersedes an older operation queued behind a delayed load',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:3}),entered=deferred(),release=deferred();
 storage.getImpl=async keys=>{entered.resolve();await release.promise;return Object.fromEntries(keys.filter(key=>Object.hasOwn(storage.data,key)).map(key=>[key,storage.data[key]]));};
 const memory=new RateMemory(storage);let oldCurrent=true;
 const oldWrite=memory.remember(2.5,'command',{isCurrent:()=>oldCurrent});await entered.promise;
 const newWrite=memory.remember(1.5,'command');oldCurrent=false;release.resolve();
 assert.equal(await oldWrite,null);
 assert.deepEqual(await newWrite,{lastRate:1.5,rateRevision:4});
 assert.deepEqual(storage.sets,[{lastRate:1.5,lastRateRevision:4}]);
});

test('rate write ledger rejects reordered IDs, allows same-ID retry, and completes once',async()=>{
 const ledger=new RateWriteLedger(),sender={tab:{id:7},frameId:2,documentId:'doc-a'},msg={rate:1.5,source:'command',rateSessionId:'session-a',rateWriteId:2};
 const latest=ledger.begin(msg,sender);assert.equal(latest.status,'pending');
 const stale=ledger.begin({...msg,rate:2,rateWriteId:1},sender);assert.equal(stale.status,'stale');assert.equal(stale.isCurrent(),false);
 const retry=ledger.begin(msg,sender);assert.equal(retry.status,'pending');assert.equal(retry.isCurrent(),true);assert.equal(retry.complete(),true);
 assert.equal(ledger.begin(msg,sender).status,'completed');
 assert.equal(ledger.begin({...msg,rate:2},sender).status,'conflict');
 assert.equal(ledger.begin({...msg,rateSessionId:undefined},sender),null);
});

test('rate write ledger is bounded, scoped to sender/session, and cleared by tab',()=>{
 const ledger=new RateWriteLedger(1),message={rate:2,source:'native',rateSessionId:'session-a',rateWriteId:1};
 const first=ledger.begin(message,{tab:{id:1},frameId:0,documentId:'doc'});
 const second=ledger.begin(message,{tab:{id:2},frameId:0,documentId:'doc'});
 assert.equal(first.isCurrent(),false);assert.equal(second.isCurrent(),true);
 ledger.forgetTab(2);assert.equal(second.isCurrent(),false);
});

test('seeds only genuinely missing memory and stores rate with its revision atomically',async()=>{
 const storage=new LocalStorage(),memory=new RateMemory(storage);
 assert.deepEqual(await memory.load(),{lastRate:1,rateRevision:0});
 assert.deepEqual(storage.sets,[{lastRate:1,lastRateRevision:0}]);
});

test('accepts a valid legacy rate without revision and upgrades it atomically',async()=>{
 const storage=new LocalStorage({lastRate:1.5}),memory=new RateMemory(storage);
 assert.deepEqual(await memory.read(),{lastRate:1.5,rateRevision:0});
 assert.deepEqual(storage.sets,[{lastRate:1.5,lastRateRevision:0}]);
});

test('adopts a newer paired storage change after rereading the stored pair',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:5}),memory=new RateMemory(storage);await memory.load();
 storage.data={lastRate:8,lastRateRevision:12};
 assert.deepEqual(await memory.observeChanges({lastRate:{oldValue:2,newValue:8},lastRateRevision:{oldValue:5,newValue:12}}),{lastRate:8,rateRevision:12});
 assert.deepEqual(await memory.read(),{lastRate:8,rateRevision:12});
});

test('adopts a revision-only change when the stored rate remains the cached rate',async()=>{
 const storage=new LocalStorage({lastRate:1.5,lastRateRevision:5}),memory=new RateMemory(storage);await memory.load();
 storage.data.lastRateRevision=6;
 assert.deepEqual(await memory.observeChanges({lastRateRevision:{oldValue:5,newValue:6}}),{lastRate:1.5,rateRevision:6});
});

test('ignores old, unpaired, and event/storage-mismatched changes',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:5}),memory=new RateMemory(storage);await memory.load();
 storage.data={lastRate:8,lastRateRevision:4};
 assert.deepEqual(await memory.observeChanges({lastRate:{oldValue:2,newValue:8},lastRateRevision:{oldValue:5,newValue:4}}),{lastRate:2,rateRevision:5});
 storage.data.lastRate=7;
 assert.equal(await memory.observeChanges({lastRate:{oldValue:2,newValue:7}}),null);
 assert.deepEqual(await memory.read(),{lastRate:2,rateRevision:5});
 storage.data={lastRate:7,lastRateRevision:6};
 assert.deepEqual(await memory.observeChanges({lastRate:{oldValue:2,newValue:8},lastRateRevision:{oldValue:5,newValue:6}}),{lastRate:2,rateRevision:5});
});

test('an own storage onChanged event queued during its write does not race the cache',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:3}),memory=new RateMemory(storage);await memory.load();let observed;
 storage.setImpl=values=>{observed=memory.observeChanges({lastRate:{oldValue:storage.data.lastRate,newValue:values.lastRate},lastRateRevision:{oldValue:storage.data.lastRateRevision,newValue:values.lastRateRevision}});};
 const ack=await memory.remember(1.5,'command');
 assert.deepEqual(ack,{lastRate:1.5,rateRevision:4});
 assert.deepEqual(await observed,ack);
 assert.deepEqual(await memory.read(),ack);
});

test('propagates storage reread errors while reconciling an external change',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:3}),memory=new RateMemory(storage);await memory.load();
 const error=Error('storage reread failed');storage.getImpl=()=>{throw error;};
 await assert.rejects(memory.observeChanges({lastRate:{oldValue:2,newValue:8},lastRateRevision:{oldValue:3,newValue:4}}),failure=>failure===error);
 assert.deepEqual(await memory.read(),{lastRate:2,rateRevision:3});
});

test('propagates storage read and seed-write failures instead of returning one',async()=>{
 const readError=Error('storage read failed'),readStorage=new LocalStorage();readStorage.getImpl=()=>{throw readError;};
 await assert.rejects(new RateMemory(readStorage).read(),error=>error===readError);
 await assert.rejects(new RateMemory(new LocalStorage({lastRate:NaN,lastRateRevision:2})).read(),/無效的播放速度記憶資料/);
 const writeError=Error('storage write failed'),writeStorage=new LocalStorage();writeStorage.setImpl=()=>{throw writeError;};
 await assert.rejects(new RateMemory(writeStorage).read(),error=>error===writeError);
 assert.equal(writeStorage.sets.length,0);
});

test('retries a transient initial read failure without replacing memory with one',async()=>{
 const error=Error('temporary storage read failure'),storage=new LocalStorage({lastRate:8,lastRateRevision:11});let reads=0;
 storage.getImpl=async keys=>{if(reads++===0)throw error;return Object.fromEntries(keys.filter(key=>Object.hasOwn(storage.data,key)).map(key=>[key,storage.data[key]]));};
 const memory=new RateMemory(storage);
 await assert.rejects(memory.load(),failure=>failure===error);
 assert.deepEqual(await memory.read(),{lastRate:8,rateRevision:11});
 assert.deepEqual(storage.data,{lastRate:8,lastRateRevision:11});assert.deepEqual(storage.sets,[]);
});

test('invalid stored memory stays an error and is never reseeded as one',async()=>{
 const storage=new LocalStorage({lastRate:NaN,lastRateRevision:4}),memory=new RateMemory(storage);
 await assert.rejects(memory.load(),/無效的播放速度記憶資料/);
 await assert.rejects(memory.read(),/無效的播放速度記憶資料/);
 assert.deepEqual(storage.sets,[]);assert(Number.isNaN(storage.data.lastRate));
});

test('rejects invalid rates and unrecognized or missing sources without persisting',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:3}),memory=new RateMemory(storage);await memory.load();
 for(const [rate,source]of [[NaN,'command'],[Infinity,'native'],[0,'default'],[17,'command'],[1.5,'old-content'],[1.5,undefined]])
  assert.equal(await memory.remember(rate,source),null);
 assert.deepEqual(storage.sets,[]);
 assert.deepEqual(await memory.read(),{lastRate:2,rateRevision:3});
});

test('confirmed sources return an ack after one paired write; rejected writes keep old state',async()=>{
 const storage=new LocalStorage({lastRate:2,lastRateRevision:3}),memory=new RateMemory(storage);await memory.load();
 assert.deepEqual(await memory.remember(1.5,'command'),{lastRate:1.5,rateRevision:4});
 assert.deepEqual(await memory.remember(1.25,'default'),{lastRate:1.25,rateRevision:5});
 assert.deepEqual(await memory.remember(1,'native'),{lastRate:1,rateRevision:6});
 assert.deepEqual(storage.sets,[{lastRate:1.5,lastRateRevision:4},{lastRate:1.25,lastRateRevision:5},{lastRate:1,lastRateRevision:6}]);
 const writeError=Error('storage write failed');storage.setImpl=()=>{throw writeError;};
 await assert.rejects(memory.remember(0.75,'default'),error=>error===writeError);
 assert.deepEqual(await memory.read(),{lastRate:1,rateRevision:6});
});
