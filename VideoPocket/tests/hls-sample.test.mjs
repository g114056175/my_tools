import test from 'node:test';
import assert from 'node:assert/strict';
import {decryptHlsSample,hlsIv} from '../extension/hls-sample.js';

test('bounded AES-CBC prefix preserves plaintext without downloading whole segment',async()=>{
 const rawKey=crypto.getRandomValues(new Uint8Array(16)),iv=hlsIv(null,17),plain=crypto.getRandomValues(new Uint8Array(32768));
 const key=await crypto.subtle.importKey('raw',rawKey,{name:'AES-CBC'},false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},key,plain));
 const decoded=await decryptHlsSample(encrypted.subarray(0,8197),rawKey,iv);
 assert.equal(decoded.length,8192);assert.deepEqual(decoded,plain.subarray(0,8192));
 const all=await decryptHlsSample(encrypted,rawKey,iv);assert.deepEqual(all.subarray(0,plain.length),plain);
});
test('HLS IV uses explicit words or the first media sequence',()=>{
 assert.deepEqual([...hlsIv({iv:[1,2,3,4]},99)],[0,0,0,1,0,0,0,2,0,0,0,3,0,0,0,4]);
 assert.equal(new DataView(hlsIv(null,100).buffer).getUint32(12),100);
});
test('invalid key and incomplete encrypted prefix fail explicitly',async()=>{
 await assert.rejects(decryptHlsSample(new Uint8Array(32),new Uint8Array(15),new Uint8Array(16)),/金鑰長度/);
 await assert.rejects(decryptHlsSample(new Uint8Array(15),new Uint8Array(16),new Uint8Array(16)),/不完整/);
});
