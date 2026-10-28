import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityLease} from '../src/activity-lease.js';

test('pending playback survives exploration expiry but cannot be renewed by stale replies',()=>{
 const lease=new ActivityLease();lease.accept({revision:1,focused:false,until:10_000,loadingUntil:60_000});
 assert.equal(lease.isRecent(15_000),false);assert.equal(lease.isLoading(15_000),true);
 assert.equal(lease.accept({revision:1,focused:false,until:10_000,loadingUntil:70_000}),false);
 assert.equal(lease.isLoading(60_000),false);
 lease.accept({revision:2,focused:false,until:0});assert.equal(lease.isLoading(20_000),false);
 assert.equal(lease.accept({revision:3,focused:false,until:0,loadingUntil:Infinity}),false);
});

test('cold frames remain idle and focus grants a lease until a later blur',()=>{
 const lease=new ActivityLease();assert.equal(lease.isRecent(100),false);
 assert.equal(lease.accept({revision:1,focused:true,until:0}),true);assert.equal(lease.isRecent(100000),true);
 lease.accept({revision:2,focused:false,until:10100});assert.equal(lease.isRecent(10099),true);assert.equal(lease.isRecent(10100),false);
});
test('late startup replies cannot overwrite newer focus notifications',()=>{
 const lease=new ActivityLease();lease.accept({revision:4,focused:false,until:200});
 assert.equal(lease.accept({revision:3,focused:true,until:0}),false);assert.equal(lease.isRecent(201),false);
 assert.equal(lease.accept({revision:4,focused:true,until:0}),false);
 assert.equal(lease.accept({revision:4,focused:false,until:300}),false);
 assert.equal(lease.accept({revision:4,focused:false,until:0}),true);
 lease.accept({revision:5,focused:true,until:0});assert.equal(lease.isRecent(100000),true);
});
test('invalid or legacy activity values never grant access',()=>{
 const lease=new ActivityLease();
 for(const value of [null,{}, {focused:true,until:0},{revision:-1,focused:true,until:0},{revision:1,focused:1,until:0},{revision:1,focused:false,until:Infinity}])assert.equal(lease.accept(value),false);
 assert.equal(lease.isRecent(),false);
});
