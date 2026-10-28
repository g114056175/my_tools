import test from 'node:test';
import assert from 'node:assert/strict';
import {originalTracks,selectTrack,orderTracks,mergeTracks,trackLabel} from '../extension/tracks.js';
import {summarize,subtitleInfo} from '../native/core.mjs';
import {parseSubtitles,exportSubtitle} from '../extension/subtitles.js';
const caption=(language,name,extra={})=>({source:'youtube-page',language,name,url:`https://example.com/timedtext?lang=${language}&name=${encodeURIComponent(name)}`,...extra});
test('User language controls default independently of Chinese extension UI',()=>{
  const tracks=originalTracks([caption('ja','日文'),caption('zh-Hant','繁體中文'),caption('en','English')]);
  assert.equal(selectTrack(tracks,['en-US','zh-Hant']).language,'en');
  assert.equal(selectTrack(tracks,['zh-TW','en-US']).language,'zh-hant');
  assert.equal(selectTrack(tracks,['ja-JP','en-US']).language,'ja');
  assert.deepEqual(orderTracks(tracks,['en-US']).map(t=>t.language),['en','ja','zh-hant']);
});
test('Locale and English outrank active RGB variants and defaults',()=>{
  const tracks=originalTracks([caption('en','English'),caption('ja','RGB v1',{default:true}),caption('ja','RGB v2',{active:true})]);
  assert.equal(selectTrack(tracks,['en-US']).name,'English');
  assert.equal(selectTrack(tracks,['de-DE']).name,'English');
});
test('All named Japanese tracks survive, formats of the same variant merge',()=>{
  const labels=['日文','日文 - RGB [Mobile]','日文 - RGB ~ Kanji + Romaji [PC] - v1','日文 - RGB ~ Kanji + Romaji [PC] - v2','日文 - RGB ~ Romaji + Kanji [PC]','日文 - v1','日文 - Ya Boy in the captions'];
  const page=labels.map((name,i)=>caption('ja',name,{pageTrackId:'.ja.'+i,pageTrackIndex:i}));
  const native=page.flatMap(t=>['vtt','json3'].map(fmt=>({...t,source:'native',nativeLanguage:'ja-'+t.pageTrackIndex,url:t.url+'&fmt='+fmt,name:'Japanese - '+t.pageTrackIndex})));
  const tracks=originalTracks([...page,...native]);assert.equal(tracks.length,7);assert.deepEqual(tracks.map(t=>t.name),labels);assert.equal(new Set(tracks.map(t=>t.trackId)).size,7);assert.ok(tracks.every(t=>t.nativeLanguage));
});
test('Distinct vss IDs without URL name stay distinct',()=>{
  const tracks=originalTracks([caption('ja','日文',{url:'https://example.com/?lang=ja',vssId:'.ja'}),caption('ja','日文 - RGB',{url:'https://example.com/?lang=ja',vssId:'.ja.RGB'})]);assert.equal(tracks.length,2);
});
test('Native exact item selection works even if yt-dlp shares one language key',()=>{
  const info={subtitles:{ja:['RGB v1','RGB v2'].flatMap(name=>['vtt','json3'].map(ext=>({name,url:`https://example.com/?lang=ja&name=${encodeURIComponent(name)}&fmt=${ext}`,ext})))}};
  const tracks=summarize(info).tracks;assert.equal(tracks.length,2);assert.throws(()=>subtitleInfo(info,{language:'ja',automatic:false}));
  for(const track of tracks){const chosen=subtitleInfo(info,{language:'ja',trackId:track.trackId});assert.equal(chosen.info.subtitles.ja.length,2);assert.ok(chosen.info.subtitles.ja.every(item=>item.name===track.name));}
  assert.throws(()=>subtitleInfo(info,{language:'ja',trackId:'missing'}));
});
test('Native custom vss key is language ja for locale selection',()=>{
  const tracks=summarize({subtitles:{'ja-hash':[{name:'Japanese - RGB',url:'https://example.com/?lang=ja&name=RGB',ext:'vtt'}],en:[{name:'English',url:'https://example.com/?lang=en',ext:'vtt'}]}}).tracks;
  const japanese=tracks.find(t=>t.nativeLanguage==='ja-hash');assert.equal(japanese.language,'ja');assert.equal(selectTrack(tracks,['ja-JP']).language,'en'); // effect variant stays below standard English
});
test('Only plain caption exports remain; original/effect export unsupported',()=>{
  const raw=JSON.stringify({pens:[{fcForeColor:16711680}],events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'RGB',pPenId:0}]}]});const value={cues:parseSubtitles(raw)};
  assert.throws(()=>exportSubtitle(value,'original'));assert.match(exportSubtitle(value,'txt').content,/RGB/);assert.ok(!exportSubtitle(value,'txt').content.includes('fcForeColor'));
  const vtt='WEBVTT\n\nSTYLE\n::cue(.red) {color:red}\n\n00:00:00.000 --> 00:00:01.000 line:10%\n<c.red>Red text</c>\n';const styled={cues:parseSubtitles(vtt)};
  for(const format of ['txt','srt','vtt']){assert.match(exportSubtitle(styled,format).content,/Red text/);assert.ok(!exportSubtitle(styled,format).content.includes('color:red'));}
});
test('ASR format/client/HLS duplicates merge, translations do not enter menu',()=>{
  const embed=p=>'https://manifest.googlevideo.com/api/tts_params/'+encodeURIComponent(p)+'/playlist/index.m3u8';
  const raw=[caption('en','English',{automatic:true,vssId:'a.en',url:'https://example.com/?lang=en&kind=asr'}),{language:'a-en',name:'en',automatic:true,source:'native',url:embed('lang=en&caps=asr')},...['json3','vtt','srt','srv1'].map(fmt=>({language:'en-orig',name:'English (Original)',automatic:true,source:'native',url:'https://example.com/?lang=en&kind=asr&fmt='+fmt})),{language:'fr',automatic:true,source:'native',url:embed('lang=en&tlang=fr&caps=asr')}];
  const tracks=originalTracks(raw);assert.equal(tracks.length,1);assert.equal(tracks[0].nativeLanguage,'en-orig');assert.equal(tracks[0].language,'en');
});
test('YouTube page inventory excludes phantom native ASR on manual languages',()=>{
  const page={captionInventory:true,tracks:[caption('zh-TW','中文（台灣）',{url:'https://example.com/?lang=zh-TW'}),caption('ko','韓文（自動產生）',{automatic:true,url:'https://example.com/?lang=ko&kind=asr'})]};
  const native=summarize({subtitles:{'zh-TW':[{url:'https://example.com/?lang=zh-TW'}]},automatic_captions:{'zh-TW':[{url:'https://example.com/?lang=zh-TW&kind=asr'}],en:[{url:'https://example.com/?lang=en&kind=asr'}],ko:[{url:'https://example.com/?lang=ko&kind=asr'}]}}).tracks;
  const tracks=mergeTracks(page,native);assert.equal(tracks.length,2);assert.equal(tracks[0].name,'中文（台灣）');assert.equal(tracks[1].nativeLanguage,'ko');assert.equal(trackLabel(tracks[1]),'Korean · Speech recognition');
});
test('track labels use English language names without changing source metadata or identity',()=>{
  const manual=caption('zh-TW','中文（台灣）',{pageTrackId:'provider-track-7'}),automatic=caption('ko','韓文（自動產生）',{automatic:true,pageTrackId:'provider-asr-8'});
  assert.equal(trackLabel(manual),'Chinese (Taiwan)');assert.equal(trackLabel(automatic),'Korean · Speech recognition');
  assert.equal(manual.pageTrackId,'provider-track-7');assert.equal(automatic.pageTrackId,'provider-asr-8');
  assert.equal(trackLabel(caption('en','English - Director commentary')),'English - Director commentary','custom provider labels remain intact');
});
test('Genuine manual and ASR choices in page inventory remain distinct',()=>{
  const tracks=mergeTracks({captionInventory:true,tracks:[caption('en','English',{url:'https://example.com/?lang=en'}),caption('en','English (auto-generated)',{automatic:true,url:'https://example.com/?lang=en&kind=asr'})]});assert.equal(tracks.length,2);
});
test('Taiwan locale order: Traditional, Simplified, English, Japanese; custom last',()=>{
  const tracks=originalTracks([caption('ja','日文 - RGB'),caption('es','Español'),caption('en','English'),caption('zh-CN','簡體中文'),caption('zh-TW','繁體中文'),caption('ja','日文')]);
  assert.deepEqual(orderTracks(tracks,['zh-TW','es']).map(t=>t.name),['繁體中文','簡體中文','English','Español','日文','日文 - RGB']);
});
test('Exact Chinese region beats active/default Hong Kong for a Taiwan browser',()=>{
  const tracks=originalTracks([caption('zh-HK','中文（香港）',{active:true,default:true}),caption('zh-TW','中文（台灣）'),caption('en','English')]);
  assert.equal(selectTrack(tracks,['zh-TW','zh','en-US']).language,'zh-tw');
  assert.equal(selectTrack(tracks,['zh-HK','en-US']).language,'zh-hk');
});
test('Separate Bilibili ASR languages and exact API tracks remain selectable with the chosen part identity',()=>{
  const tracks=originalTracks(['zh','en'].map((language,i)=>({language,name:language,rawLanguage:'ai-'+language,apiTrackId:'track-'+i,automatic:true,source:'bilibili-api',bvid:'BVfixture001',cid:12,page:2,explicitPage:true,pageTrackId:`external:bili:BVfixture001:12:${i+1}`})));
  assert.equal(tracks.length,2);assert.equal(selectTrack(tracks,['zh-TW']).language,'zh');assert.equal(selectTrack(tracks,['en-US']).language,'en');
  assert.ok(tracks.every(t=>t.bvid==='BVfixture001'&&t.cid===12&&t.page===2&&t.explicitPage&&t.rawLanguage==='ai-'+t.language&&t.apiTrackId.startsWith('track-')));
});
