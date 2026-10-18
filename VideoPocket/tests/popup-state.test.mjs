import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaAvailability,popupAvailability,restoredKind,sourceVisibility} from '../extension/popup-state.js';

const info = {
  choices: {
    video: {auto: {enabled: true}},
    audio: {original: {enabled: false}},
  },
};

test('empty or failed inspect hides the media UI while source controls remain representable', () => {
  assert.deepEqual(mediaAvailability(null), {video: false, audio: false});
  assert.deepEqual(sourceVisibility({info: null, tracks: [], kind: 'video'}), {
    available: {video: false, audio: false, subtitle: false, any: false},
    showDownloadSection: false,
    showSubtitleSection: false,
    showVideoSettings: false,
    showAudioSettings: false,
  });
});

test('cached or polled subtitle tracks keep subtitle mode available without media formats', () => {
  const available = popupAvailability(null, [{trackId: 'en'}]);
  assert.deepEqual(available, {video: false, audio: false, subtitle: true, any: true});
  assert.equal(restoredKind('video', available), 'subtitle');
  assert.equal(sourceVisibility({info: null, tracks: [{trackId: 'en'}], kind: 'subtitle'}).showSubtitleSection, true);
});

test('restored mode falls back to an available media mode when the selected mode disappears', () => {
  assert.equal(restoredKind('audio', {video: true, audio: false, subtitle: false}), 'video');
  assert.equal(restoredKind('subtitle', {video: false, audio: true, subtitle: false}), 'audio');
  assert.equal(restoredKind('subtitle', {video: false, audio: false, subtitle: false}), 'video');
  assert.equal(restoredKind('audio', {...mediaAvailability(info), subtitle: false}), 'video');
});
