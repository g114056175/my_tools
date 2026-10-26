import test from 'node:test';
import assert from 'node:assert/strict';
import {RateClient} from '../src/rate-client.js';
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
