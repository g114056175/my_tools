import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaAvailability,popupAvailability,restoredKind,sourceVisibility,sourceHeader,sourceDeadline,mediaTitleLabel,sourceInspectionDiagnostic} from '../extension/popup-state.js';

test('source diagnostics contain only safe counts and failure stages',()=>{
 const value=sourceInspectionDiagnostic({page:{title:'PRIVATE',url:'https://secret/?token=x',videos:[{linkedMedia:{id:'PRIVATE',url:'https://secret/'}}],media:{discoveryDiagnostics:{json:{observed:2},models:3,matches:0,reason:'identity-unmatched',unboundFallbackBlocked:true}}},phase:'failed',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model',message:'PRIVATE'}});
 assert.equal(value.discovery.json,2);assert.equal(value.discovery.unboundFallbackBlocked,true);assert.equal(value.failure.stage,'linked-no-model');assert.equal(value.hasPermalink,true);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.ok(!JSON.stringify(value).includes('secret'));
});

test('generic network discovery keeps its safe platform label in diagnostics',()=>{
 assert.equal(sourceInspectionDiagnostic({page:{platform:{site:'network-media'}},phase:'failed'}).platformKind,'network-media');
 assert.equal(sourceInspectionDiagnostic({page:{platform:{site:'https://private.example/token'}}}).platformKind,undefined);
});

test('media labels use available width and preserve complete titles when no measurement is needed',()=>{
  assert.equal(mediaTitleLabel('短標題'),'短標題');
  assert.equal(mediaTitleLabel('a'.repeat(80)),'a'.repeat(80));
  assert.equal(mediaTitleLabel('長'.repeat(25)),'長'.repeat(25));
  const glyphs=value=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].map(part=>part.segment);
  const measure=value=>glyphs(value).reduce((width,glyph)=>width+(glyph==='i'?2:glyph==='…'?6:12),0);
  assert.equal(mediaTitleLabel('i'.repeat(30),60,measure),'i'.repeat(30));
  assert.equal(mediaTitleLabel('長'.repeat(30),60,measure),'長'.repeat(4)+'…');
  const emoji='👩‍💻';assert.equal(mediaTitleLabel(emoji.repeat(25),60,measure),emoji.repeat(4)+'…');
  assert.equal(mediaTitleLabel('超長標題',5,measure),'');
  assert.equal(mediaTitleLabel('  第一行\n第二行  '),'第一行 第二行');
});

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

test('a selected video without any download controls never receives a normal source header',()=>{
 for(const phase of ['idle','ready','failed']){
  const header=sourceHeader({hasVideo:true,info:{},phase});
  assert.equal(header.error,true);assert.equal(header.label,'找到影片，但無下載來源');
 }
 const pending=sourceHeader({hasVideo:true,info:null,phase:'inspecting'});
 assert.equal(pending.label,'解析影片中…');assert.equal(pending.error,false);
 assert.equal(sourceHeader({hasVideo:true,info,phase:'ready'}).label,'影片：');
 assert.equal(sourceHeader({hasVideo:true,phase:'failed',error:'來源拒絕下載',detail:'HTTP 403'}).detail,'HTTP 403');
});

test('source validation has a deadline even when the background never responds',async()=>{
 await assert.rejects(sourceDeadline(()=>new Promise(()=>{}),10),{code:'NETWORK_TIMEOUT'});
 assert.equal(await sourceDeadline(async()=>42,100),42);
});

test('Bilibili playback diagnostics retain only a bounded numeric API code',()=>{
 const value=sourceInspectionDiagnostic({failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'bilibili-playurl',apiCode:-404}});assert.equal(value.failure.apiCode,-404);assert.equal(value.failure.stage,'bilibili-playurl');assert.equal(sourceInspectionDiagnostic({failure:{apiCode:'PRIVATE'}}).failure.apiCode,undefined);
});
