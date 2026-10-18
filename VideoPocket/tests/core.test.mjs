import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles,toSrt,toText} from '../extension/subtitles.js';
import {makeZip} from '../extension/zip.js';
import {validateRequest,downloadArgs,summarize,isInside,friendlyError,subtitleChunks} from '../native/core.mjs';
test('JSON3 automatic captions retain timestamp and Unicode',()=>{
  const cues=parseSubtitles(JSON.stringify({events:[{tStartMs:1500,dDurationMs:2000,segs:[{utf8:'測試 &amp; '},{utf8:'字幕'}]},{tStartMs:0}]}));
  assert.deepEqual(cues,[{start:1.5,end:3.5,text:'測試 & 字幕'}]);assert.match(toSrt(cues),/00:00:01,500 --> 00:00:03,500/);
});
test('VTT styles, entities and distinct cue times; BOM SRT',()=>{
  const cues=parseSubtitles('WEBVTT\n\n00:01.000 --> 00:03.000 align:start\n<c.colorE5>hello</c> &lt;world&gt;\n\n00:03.000 --> 00:04.000\nhello &lt;world&gt;\n');
  assert.equal(cues.length,2);assert.equal(toText(cues),'[00:00:01] hello <world>\n[00:00:03] hello <world>');
  assert.equal(parseSubtitles('\ufeff1\r\n00:00:00,000 --> 00:00:01,000\r\n&#x4e2d;文\r\n')[0].text,'中文');
});
test('Bilibili subtitle JSON',()=>assert.deepEqual(parseSubtitles('{"body":[{"from":2,"to":4,"content":"你好"}]}'),[{start:2,end:4,text:'你好'}]));
test('Reject executable protocols, credential URLs and injected parameters',()=>{
  for(const url of ['file:///C:/Windows/system.ini','javascript:alert(1)','https://user:pass@example.com'])assert.throws(()=>validateRequest({id:'x',action:'inspect',url}));
  assert.throws(()=>validateRequest({id:'x',action:'download',url:'https://example.com',kind:'video',height:'720];--exec=calc'}));
  assert.throws(()=>validateRequest({id:'x',action:'subtitle',url:'https://example.com',language:'.*'}));
  assert.equal(validateRequest({id:'x',action:'inspect',url:'https://example.com/?q=%26calc'}).url,'https://example.com/?q=%26calc');
});
test('Video ceiling and audio conversion args',()=>{
  const args=downloadArgs({kind:'video',height:720},'C:/downloads');assert.equal(args[args.indexOf('-f')+1],'bv*[height<=720]+ba/b[height<=720]');
  const audio=downloadArgs({kind:'audio',audioFormat:'mp3',audioQuality:'192'},'C:/downloads');assert.equal(audio[audio.indexOf('--audio-quality')+1],'192K');
  assert.notEqual(args[args.indexOf('--output')+1],audio[audio.indexOf('--output')+1]);assert.ok(audio.includes('--no-post-overwrites'));
});
test('Metadata filters DRM, separates automatic captions, omits signed URLs',()=>{
  const data=summarize({formats:[{height:720,vcodec:'avc',acodec:'none'},{height:1080,has_drm:true,vcodec:'avc'}],subtitles:{en:[{url:'secret'}]},automatic_captions:{'live_chat':[{}],zh:[{}]}});
  assert.deepEqual(data.heights,[720]);assert.equal(data.tracks.length,2);assert.equal(data.tracks[1].automatic,true);assert.ok(!JSON.stringify(data).includes('secret'));
});
test('File path stays inside configured output directory',()=>{
  assert.equal(isInside('C:/downloads','C:/downloads/a.mp4'),true);assert.equal(isInside('C:/downloads','C:/downloads-other/a.mp4'),false);assert.equal(isInside('C:/downloads','C:/downloads/../secret'),false);
});
test('Blocking response gives actionable fallback',()=>assert.match(friendlyError('ERROR: Sign in to confirm you are not a bot'),/頁面字幕/));
test('ZIP contains UTF8 filenames and central directory',async()=>{
  const bytes=new Uint8Array(await makeZip([{name:'字幕.txt',data:'測試'},{name:'frames/01.jpg',data:new Uint8Array([1,2,3])}]).arrayBuffer());
  const view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(bytes.length-14,true),2);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
});
test('Long Unicode subtitles roundtrip across native-message chunks',()=>{
  const cues=Array.from({length:10000},(_,i)=>({start:i*2,end:i*2+2,text:'字幕'.repeat(30)+' '+i}));
  assert.ok(Buffer.byteLength(JSON.stringify(cues),'utf8')>950000);
  const chunks=subtitleChunks(cues);assert.ok(chunks.length>1);
  for(const chunk of chunks)assert.ok(Buffer.byteLength(JSON.stringify(chunk),'utf8')<=500000);
  assert.deepEqual(chunks.flat(),cues);assert.match(toText(chunks.flat()),/9999$/);
});
test('Explicit container settings remux without accepting arbitrary flags',()=>{
  const args=downloadArgs({kind:'video',height:0,videoFormat:'mp4'},'C:/test');assert.equal(args[args.indexOf('--remux-video')+1],'mp4');
  assert.throws(()=>validateRequest({id:'x',action:'download',kind:'video',url:'https://example.com',videoFormat:'--exec=calc'}));
});
