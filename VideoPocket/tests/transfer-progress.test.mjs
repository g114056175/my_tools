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
