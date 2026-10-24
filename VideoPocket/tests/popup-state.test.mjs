import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILD_ID} from '../extension/build-info.js';

test('selection expiry diagnostic carries a reason without exposing the selected source',()=>{
 const value=sourceInspectionDiagnostic({page:{videos:[{url:'blob:private'}]},phase:'failed',failure:{code:'SOURCE_CHANGED',sourceStage:'selection-inventory'}});
 assert.equal(value.failure.code,'SOURCE_CHANGED');assert.equal(value.failure.stage,'selection-inventory');assert.ok(!JSON.stringify(value).includes('private'));
});
import {mediaAvailability,popupAvailability,restoredKind,sourceVisibility,sourceHeader,sourceDeadline,mediaTitleLabel,orderedMediaOptions,sourceInspectionDiagnostic} from '../extension/popup-state.js';

test('named media precede numbered placeholders without changing selection indices or within-group order',()=>{
 const videos=[{title:'影片 1'},{title:'Lecture'},{title:''},{title:'影片2'},{title:'影片 1 的生活'}];
 assert.deepEqual(orderedMediaOptions(videos),[{index:1,title:'Lecture'},{index:4,title:'影片 1 的生活'},{index:0,title:'影片 1'},{index:2,title:'影片 3'},{index:3,title:'影片2'}]);
 assert.equal(videos[0].title,'影片 1');
});

test('generic player labels share the placeholder group and keep stable order',()=>{
 const videos=[{title:'Video player'},{title:'Actual post'},{title:'影片 2'},{title:'Twitch video player'},{title:'Another post'}];
 assert.deepEqual(orderedMediaOptions(videos),[
  {index:1,title:'Actual post'},{index:4,title:'Another post'},
  {index:0,title:'Video player'},{index:2,title:'影片 2'},{index:3,title:'Twitch video player'},
 ]);
});

test('unbound metadata diagnostics contain only allowlisted reasons and counts',()=>{
 const page={videos:[{}],platform:{site:'metadata-media',versions:[{url:'https://private.test/token=secret'}]},media:{discoveryDiagnostics:{metadataCandidates:1,metadataReason:'verification-required'}}};
 const value=sourceInspectionDiagnostic({page,phase:'inspecting'});
 assert.equal(value.platformKind,'metadata-media');assert.equal(value.discovery.metadataCandidates,1);assert.equal(value.discovery.metadataReason,'verification-required');
 assert.doesNotMatch(JSON.stringify(value),/private|secret/);
 page.media.discoveryDiagnostics.metadataReason='https://private.test/secret';
 assert.equal(sourceInspectionDiagnostic({page}).discovery.metadataReason,undefined);
});

test('source diagnostics contain only safe counts and failure stages',()=>{
 const value=sourceInspectionDiagnostic({page:{title:'PRIVATE',url:'https://secret/?token=x',videos:[{linkedMedia:{id:'PRIVATE',url:'https://secret/'}}],media:{discoveryDiagnostics:{json:{observed:2},models:3,matches:0,reason:'identity-unmatched',unboundFallbackBlocked:true}}},phase:'failed',failure:{code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model',message:'PRIVATE'}});
 assert.equal(value.discovery.json,2);assert.equal(value.discovery.unboundFallbackBlocked,true);assert.equal(value.failure.stage,'linked-no-model');assert.equal(value.hasPermalink,true);assert.ok(!JSON.stringify(value).includes('PRIVATE'));assert.ok(!JSON.stringify(value).includes('secret'));
});

test('shareable save diagnostics preserve only allowlisted storage failure details',()=>{
 const value=sourceInspectionDiagnostic({phase:'failed',failure:{code:'SAVE_FAILED',saveStage:'write-target',saveReason:'disk-full',message:'C:/private/SECRET.mp4'}});
 assert.equal(value.build,BUILD_ID);assert.equal(value.failure.saveStage,'write-target');assert.equal(value.failure.saveReason,'disk-full');
 assert.doesNotMatch(JSON.stringify(value),/SECRET|private/);
 const unsafe=sourceInspectionDiagnostic({failure:{code:'SAVE_FAILED',saveStage:'private',saveReason:'SECRET'}});
 assert.equal(unsafe.failure.saveStage,undefined);assert.equal(unsafe.failure.saveReason,undefined);
});

test('diagnostics distinguish the popup build from the actual injected observer',()=>{
 const page={media:{discoveryDiagnostics:{observerBuild:'older-build-19'}}};
 assert.equal(sourceInspectionDiagnostic({page}).discovery.observerBuild,'older-build-19');
 page.media.discoveryDiagnostics.observerBuild='https://private.example/?secret';
 assert.equal(sourceInspectionDiagnostic({page}).discovery.observerBuild,undefined);
});

test('source diagnostics expose a bounded network fallback reason',()=>{
 const page={videos:[{},{}],media:{discoveryDiagnostics:{unboundFallbackBlocked:true,networkFallbackReason:'multiple-players'}}};
 const value=sourceInspectionDiagnostic({page,phase:'failed'});
 assert.equal(value.discovery.networkFallbackReason,'multiple-players');
 assert.equal(JSON.stringify(value).includes('https://'),false);
 const unknown=sourceInspectionDiagnostic({page:{media:{discoveryDiagnostics:{networkFallbackReason:'https://private'}}}});
 assert.equal(unknown.discovery.networkFallbackReason,undefined);
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
