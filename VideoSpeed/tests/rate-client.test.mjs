import test from 'node:test';
import assert from 'node:assert/strict';
import {RateClient} from '../src/rate-client.js';
const storageChange=(lastRate,rateRevision)=>({lastRate:{newValue:lastRate},lastRateRevision:{newValue:rateRevision}});
test('late snapshots cannot replace a locally confirmed speed awaiting persistence',()=>{
 const client=new RateClient();client.accept({lastRate:1,rateRevision:0});const token=client.begin(2);
 assert.equal(client.accept({lastRate:1,rateRevision:0}),false);assert.equal(client.rate,2);
  client.acknowledge(token,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:token,lastRate:2,rateRevision:1});
 assert.equal(client.accept({lastRate:1,rateRevision:0}),false);assert.equal(client.rate,2);
});
test('an older write acknowledgement cannot undo the latest local choice',()=>{
 const client=new RateClient();client.accept({lastRate:1,rateRevision:0});const first=client.begin(2),second=client.begin(1.5);
 assert.equal(client.acknowledge(first,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:first,lastRate:2,rateRevision:1}),false);assert.equal(client.rate,1.5);assert.equal(client.snapshot().pending,true);
 assert.equal(client.acknowledge(second,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:second,lastRate:1.5,rateRevision:2}),true);assert.equal(client.rate,1.5);
});
test('read errors and invalid responses never manufacture a remembered 1x',()=>{
 const client=new RateClient();assert.equal(client.rate,null);assert.equal(client.accept({lastRate:NaN,rateRevision:0}),false);
 const token=client.begin(8);assert.equal(client.acknowledge(token,{ok:false,error:'storage failed'}),false);
 assert.equal(client.rate,8);assert.equal(client.snapshot().pending,true);assert.equal(client.error,'storage failed');
});
test('rate-client validation and missing persistence confirmations use canonical English messages',()=>{
 const client=new RateClient();assert.throws(()=>client.begin(NaN),{message:'Invalid playback speed'});
 const token=client.begin(8);assert.equal(client.acknowledge(token,{ok:false}),false);
 assert.equal(client.error,'Saved speed could not be confirmed');
});
test('newer confirmed cross-tab memory is accepted after local acknowledgement',()=>{
 const client=new RateClient();client.accept({lastRate:2,rateRevision:3});assert.equal(client.accept({lastRate:1.5,rateRevision:4}),true);
 assert.equal(client.rate,1.5);assert.equal(client.accept({lastRate:1,rateRevision:4}),false);
});
test('a newer committed cross-tab value cannot be lost behind a late local acknowledgement',()=>{
 const client=new RateClient();client.accept({lastRate:1,rateRevision:0});const token=client.begin(2);
 client.accept({lastRate:1.5,rateRevision:2});assert.equal(client.rate,2);
 client.acknowledge(token,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:token,lastRate:2,rateRevision:1});
 assert.equal(client.rate,1.5);assert.equal(client.revision,2);assert.equal(client.snapshot().pending,false);
});
test('a valid paired local storage event is handled without a settings refresh',()=>{
 const client=new RateClient();
 assert.equal(client.acceptStorageChanges(storageChange(1.5,4)),'handled');
 assert.equal(client.rate,1.5);assert.equal(client.revision,4);
});
test('repeated paired frame notifications never request a settings refresh',()=>{
 const client=new RateClient();let refreshes=0;
 for(let revision=0;revision<60;revision++){
  const rate=1+(revision%8)/4,result=client.acceptStorageChanges(storageChange(rate,revision));
  if(result==='refresh')refreshes++;
  assert.equal(result,'handled');
 }
 assert.equal(refreshes,0);assert.equal(client.revision,59);
});
test('paired out-of-order and same-revision conflicting values remain guarded',()=>{
 const client=new RateClient();
 assert.equal(client.acceptStorageChanges(storageChange(2,3)),'handled');
 assert.equal(client.acceptStorageChanges(storageChange(1.5,3)),'handled');
 assert.equal(client.acceptStorageChanges(storageChange(1,2)),'handled');
 assert.equal(client.rate,2);assert.equal(client.revision,3);
});
test('storage changes received while a write is pending defer the newest value past its acknowledgement',()=>{
 const client=new RateClient();client.accept({lastRate:1,rateRevision:0});const token=client.begin(2);
 assert.equal(client.acceptStorageChanges(storageChange(1.25,3)),'handled');
 assert.equal(client.acceptStorageChanges(storageChange(1.5,2)),'handled');
 assert.equal(client.rate,2);
 client.acknowledge(token,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:token,lastRate:2,rateRevision:1});
 assert.equal(client.rate,1.25);assert.equal(client.revision,3);assert.equal(client.snapshot().pending,false);
});
test('a newer write acknowledgement wins over an older deferred storage value',()=>{
 const client=new RateClient();client.accept({lastRate:1,rateRevision:0});const token=client.begin(2);
 assert.equal(client.acceptStorageChanges(storageChange(1.25,3)),'handled');
 client.acknowledge(token,{ok:true,accepted:true,rateSessionId:client.sessionId,rateWriteId:token,lastRate:2,rateRevision:4});
 assert.equal(client.rate,2);assert.equal(client.revision,4);
});
test('revision-only, incomplete, or invalid rate pairs request one settings refresh',()=>{
 const client=new RateClient();
 assert.equal(client.acceptStorageChanges({lastRateRevision:{newValue:2}}),'refresh');
 assert.equal(client.acceptStorageChanges({lastRate:{newValue:2}}),'refresh');
 assert.equal(client.acceptStorageChanges(storageChange('2',2)),'refresh');
 assert.equal(client.acceptStorageChanges(storageChange(2,1.5)),'refresh');
 assert.equal(client.acceptStorageChanges(storageChange(17,2)),'refresh');
 assert.equal(client.rate,null);assert.equal(client.revision,-1);
});
test('unrelated fields are ignored and non-local rate events do not trigger refresh',()=>{
 const client=new RateClient();
 assert.equal(client.acceptStorageChanges({savedRate:{newValue:8},popupTheme:{newValue:'dark'}}),'ignored');
 assert.equal(client.acceptStorageChanges(storageChange(8,4),'sync'),'ignored');
 assert.equal(client.rate,null);assert.equal(client.revision,-1);
});
