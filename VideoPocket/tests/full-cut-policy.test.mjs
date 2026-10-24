import test from 'node:test';
import assert from 'node:assert/strict';
import { fullCutPolicy } from '../extension/full-cut-policy.js';

const source = { duration: 120 };
const plan = (format, size) => ({ ext: 'mp4', video: { url: 'https://cdn.test/video.mp4', ext: 'mp4', videoCodec:'h264', ...format }, size });

test('progressive exact and approximate plans are eligible for full-cut with size metadata', () => {
  const exact = fullCutPolicy(source, plan({ filesize: 10_000_000 }));
  assert.equal(exact.mode, 'full-cut');
  assert.equal(exact.estimatedInputBytes, 10_000_000);
  const estimated = fullCutPolicy(source, plan({}, { bytes: 20_000_000, approximate: true }));
  assert.equal(estimated.mode, 'full-cut');
  assert.equal(estimated.estimatedInputBytes, 20_000_000);
  assert.equal(estimated.sizeKnown, false);
});

test('unknown and very large estimates remain eligible without a policy size cap', () => {
  const unknown = fullCutPolicy(source, plan({}));
  assert.equal(unknown.supported, true);
  assert.equal(unknown.estimatedInputBytes, null);
  const large = fullCutPolicy(source, plan({}, { bytes: 20 * 1024 * 1024 * 1024, approximate: true }));
  assert.equal(large.supported, true);
  assert.equal(large.estimatedInputBytes, 20 * 1024 * 1024 * 1024);
});

test('a known video size is not advertised as the total when the separate audio size is unknown',()=>{
 const partial={...plan({filesize:8*1024**2}),audio:{url:'https://cdn.test/audio.m4a',ext:'m4a',audioCodec:'aac'}};
 const unknown=fullCutPolicy(source,partial);
 assert.equal(unknown.supported,true);assert.equal(unknown.sizeKnown,false);assert.equal(unknown.knownInputBytes,8*1024**2);assert.equal(unknown.estimatedInputBytes,null);
 const estimated=fullCutPolicy(source,{...partial,size:{bytes:9*1024**2,approximate:true}});
 assert.equal(estimated.estimatedInputBytes,9*1024**2);assert.equal(estimated.sizeKnown,false);
});

test('partial, DRM, SABR and invalid sources do not enter full-cut', () => {
  for (const format of [
    { segments: [{ duration: 1 }] },
    { indexRange: '0-10' },
    { mp4Index: { video: {} } },
    { drm: true },
  ]) assert.equal(fullCutPolicy(source, plan(format)).supported, false);
  assert.equal(fullCutPolicy({ ...source, sabr: true }, plan({})).supported, false);
  assert.equal(fullCutPolicy({ duration: 0 }, plan({})).supported, false);
  assert.equal(fullCutPolicy(source,plan({videoCodec:''})).supported,false);
});
