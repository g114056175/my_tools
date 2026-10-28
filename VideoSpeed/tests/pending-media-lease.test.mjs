import test from 'node:test';
import assert from 'node:assert/strict';
import {PendingMediaLease} from '../src/pending-media-lease.js';

test('a discovered media lease outlives exploration but events cannot extend it',()=>{
 const lease=new PendingMediaLease();lease.start('a',30_000);
 assert.equal(lease.accepts('a',15_000),true);
 lease.start('a',45_000);assert.equal(lease.until,30_000);
 assert.equal(lease.accepts('a',30_000),false);
});
test('a source-less element binds its first source, not a later replacement',()=>{
 const lease=new PendingMediaLease();lease.start('',30_000);
 assert.equal(lease.accepts('',100),true);assert.equal(lease.accepts('a',200),true);
 assert.equal(lease.accepts('b',300),false);assert.equal(lease.accepts('a',400),false);
});
test('completion affects only one element and focus is required to reset its lease',()=>{
 const a=new PendingMediaLease(),b=new PendingMediaLease();a.start('same',30_000);b.start('same',30_000);
 a.finish();a.start('same',40_000);assert.equal(a.accepts('same',500),false);assert.equal(b.accepts('same',500),true);
 a.reset();a.start('next',40_000);assert.equal(a.accepts('next',35_000),true);
});
