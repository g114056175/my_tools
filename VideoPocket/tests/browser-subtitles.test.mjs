import test from 'node:test';import assert from 'node:assert/strict';
import {parseSubtitles,exportSubtitle} from '../extension/subtitles.js';
test('Player SRV3 XML retains complete text/timing and discards visual styling',()=>{
 const raw='<timedtext><head><pen id="1" fc="#FF0000"/></head><body><p t="0" d="2500"><s p="1">完整</s><s>字幕 &amp; 文字</s></p><p t="3600000" d="2000">一小時後的末尾</p></body></timedtext>';
 const cues=parseSubtitles(raw);assert.deepEqual(cues,[{start:0,end:2.5,text:'完整字幕 & 文字'},{start:3600,end:3602,text:'一小時後的末尾'}]);for(const format of ['txt','srt','vtt'])assert.match(exportSubtitle({cues},format).content,/一小時後的末尾/);
});
test('Legacy timedtext XML and Bilibili original JSON preserve their source timestamps',()=>{
 assert.deepEqual(parseSubtitles('<transcript><text start="4.2" dur="1.8">Hello &quot;world&quot;</text></transcript>'),[{start:4.2,end:6,text:'Hello "world"'}]);
 assert.deepEqual(parseSubtitles('{"body":[{"from":700,"to":703,"content":"完整原有字幕"}]}'),[{start:700,end:703,text:'完整原有字幕'}]);
});
test('Plain export removes only generated timestamps and keeps complete Unicode text',()=>{
 const subtitle={cues:[{start:700,end:703,text:'完整原有字幕'},{start:704,end:707,text:'第二句 [笑聲]'}]};assert.deepEqual(exportSubtitle(subtitle,'plain'),{format:'txt',content:'完整原有字幕\n第二句 [笑聲]'});assert.match(exportSubtitle(subtitle,'txt').content,/\[00:11:40\]/);assert.ok(exportSubtitle(subtitle,'vtt').content.startsWith('WEBVTT'));assert.match(exportSubtitle(subtitle,'srt').content,/00:11:40,000 --> 00:11:43,000/);
});
