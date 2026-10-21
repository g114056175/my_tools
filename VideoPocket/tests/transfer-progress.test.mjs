import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransferProgress} from '../extension/transfer-progress.js';

test('HLS completes at 100 regardless of a 350 MB estimate and 139 MB actual input',()=>{
 const format={segments:Array.from({length:100},()=>({duration:2}))},p=createTransferProgress([format],350e6);
 for(let i=0;i<100;i++){p.bytes(format,1.39e6);p.segment(format,i);assert.equal(Math.round(p.percent()),i+1);}
 assert.equal(p.percent(),100);
});
test('out-of-order segments use duration and duplicate retry notifications are ignored',()=>{
 const f={segments:[{duration:1},{duration:8},{duration:1}]},p=createTransferProgress([f]);
 p.segment(f,1);assert.equal(p.percent(),80);p.segment(f,1);assert.equal(p.percent(),80);
 p.bytes(f,5e8);assert.equal(p.percent(),80);p.segment(f,2);assert.equal(p.percent(),90);p.segment(f,0);assert.equal(p.percent(),100);
});
test('separate audio and video tracks never reset or finish while another track is missing',()=>{
 const v={segments:[{duration:2},{duration:2}]},a={segments:[{duration:4}]},p=createTransferProgress([v,a]);
 p.segment(a,0);p.complete(a);assert.equal(p.percent(),50);
 p.segment(v,1);assert.equal(p.percent(),75);p.segment(v,0);assert.equal(p.percent(),100);
});
test('indexed audio and video tracks use the total selected byte ranges instead of equal track weights',()=>{
 const v={segments:[{duration:2,length:900},{duration:2,length:900}]},a={segments:[{duration:4,length:200}]},p=createTransferProgress([v,a]);
 p.segment(a,0);p.complete(a);
 assert.equal(Math.round(p.percent()),10);
 p.segment(v,0);assert.equal(Math.round(p.percent()),55);
 p.segment(v,1);assert.equal(p.percent(),100);
});
test('segmented progress keeps the duration fallback when any selected range length is unknown',()=>{
 const v={segments:[{duration:2,length:900},{duration:2}]},a={segments:[{duration:4,length:200}]},p=createTransferProgress([v,a]);
 p.segment(a,0);p.complete(a);assert.equal(p.percent(),50);
});
test('source bytes drive direct audio extraction instead of estimated small output bytes',()=>{
 const muxed={filesize:150e6},p=createTransferProgress([muxed],24e6);
 p.bytes(muxed,75e6);assert.equal(p.percent(),50);p.bytes(muxed,75e6);assert.equal(p.percent(),99);p.complete(muxed);assert.equal(p.percent(),100);
});
test('unknown segment duration falls back to count, unknown direct size stays indeterminate',()=>{
 const f={segments:[{duration:0},{duration:2}]},p=createTransferProgress([f]);p.segment(f,0);assert.equal(p.percent(),50);
 const raw={},q=createTransferProgress([raw]);q.bytes(raw,500);assert.equal(q.percent(),null);q.complete(raw);assert.equal(q.percent(),100);
});
test('mixed segmented and direct input can complete without counting initialization bytes as movie time',()=>{
 const v={segments:[{duration:1}]},a={filesize:100},p=createTransferProgress([v,a]);p.bytes(v,10000);assert.equal(p.percent(),0);
 p.bytes(a,50);assert.equal(p.percent(),25);p.segment(v,0);assert.equal(p.percent(),75);p.complete(a);assert.equal(p.percent(),100);
});
test('direct byte progress rolls back failed hedges without allowing percent to regress',()=>{
 const f={filesize:100},p=createTransferProgress([f]);
 p.bytes(f,60);assert.equal(p.percent(),60);
 p.bytes(f,-25);assert.equal(p.percent(),60); // public progress remains monotonic
 p.bytes(f,40);assert.equal(p.percent(),75); // internal bytes are 75, not 100
 p.bytes(f,-1000);assert.equal(p.percent(),75); // rollback is clamped at zero internally
 p.complete(f);assert.equal(p.percent(),100);
});

test('indexed segment bytes report partial work and failed attempts are removable',()=>{
 const f={segments:[{length:100},{length:100}]},p=createTransferProgress([f]);
 p.segmentBytes(f,0,40,'slow');assert.equal(p.percent(),20);
 p.segmentBytes(f,0,70,'fast');assert.equal(p.percent(),35);
 p.clearSegmentAttempt(f,0,'fast');assert.equal(p.percent(),35); // public progress stays monotonic
 p.segment(f,0);assert.equal(p.percent(),50);
 p.clearSegmentAttempt(f,0,'slow');p.segmentBytes(f,1,50,'retry');assert.equal(p.percent(),75);
 p.clearSegmentAttempt(f,1,'retry');p.segment(f,1);assert.equal(p.percent(),100);
});

test('late callbacks from a committed segment cannot add bytes again',()=>{
 const f={segments:[{length:100}]},p=createTransferProgress([f]);
 p.segmentBytes(f,0,80,'winner');p.segment(f,0);assert.equal(p.percent(),100);
 p.segmentBytes(f,0,100,'loser');assert.equal(p.percent(),100);
});

test('received bytes cannot reach 100 before the final segment is verified',()=>{
 const f={segments:[{length:100}]},p=createTransferProgress([f]);p.segmentBytes(f,0,100,'first');assert.equal(p.percent(),99);p.segmentBytes(f,0,100,'second');assert.equal(p.percent(),99);p.clearSegmentAttempt(f,0,'first');p.clearSegmentAttempt(f,0,'second');assert.equal(p.percent(),99);p.segmentBytes(f,0,1000,'retry');assert.equal(p.percent(),99);p.segment(f,0);assert.equal(p.percent(),100);
});
