import test from 'node:test';import assert from 'node:assert/strict';
import {sizeOf} from '../extension/browser-media.js';

const duration=1473.914;

test('Segmented formats do not estimate from peak bitrate alone',()=>{
 assert.equal(sizeOf({segments:[{}],bitrate:2_000_000},duration),null);
 const estimated=sizeOf({segments:[{}],bitrate:2_000_000,averageBitrate:900_000},duration);
 assert.deepEqual(estimated,{bytes:900_000*duration/8,approximate:true});
 assert.ok(estimated.bytes/1024**2>158&&estimated.bytes/1024**2<159);
});

test('Segmented exact filesize takes precedence over average bitrate',()=>{
 assert.deepEqual(sizeOf({segments:[{}],filesize:123_456_789,averageBitrate:900_000},duration),{bytes:123_456_789,approximate:false});
});

test('Non-segmented formats retain bitrate and exact filesize behavior',()=>{
 assert.deepEqual(sizeOf({bitrate:2_000_000},duration),{bytes:2_000_000*duration/8,approximate:true});
 assert.deepEqual(sizeOf({filesize:123_456_789,bitrate:2_000_000},duration),{bytes:123_456_789,approximate:false});
});
