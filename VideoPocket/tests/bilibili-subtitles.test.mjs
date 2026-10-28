import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBilibiliSubtitle,parseBilibiliSubtitle} from '../extension/bilibili-subtitles.js';
import {briefFailure} from '../extension/diagnostics.js';

const url='https://aisubtitle.hdslb.com/bfs/ai_subtitle/selected.json?sign=SECRET';
const caption={url,bvid:'BVfixture01',cid:11,page:1,language:'zh',automatic:true,duration:60};
const body=JSON.stringify({body:[{from:0,to:1,content:'第一句'},{from:1,to:3,content:'最後一句'}]});
const response=(status=200,text=body,source=url)=>({ok:status===200,status,url:source,text:async()=>text});
const options=(extra={})=>({selector:{expectedBvid:caption.bvid,expectedCid:caption.cid,expectedPage:1,apiTrackId:'11'},prepare:async()=>({...caption}),verify:async()=>({verified:true}),fetchFile:async()=>response(),sleep:async()=>{},...extra});

test('confirmed Bilibili source needs one file fetch and no extra metadata API before saving',async()=>{
 let prepare=0,files=0,checks=0;
 const data=await loadBilibiliSubtitle(options({prepare:async selected=>{prepare++;assert.equal(selected.expectedCid,11);return {...caption};},fetchFile:async(source,init)=>{files++;assert.equal(source,url);assert.equal(init.cache,'no-store');assert.ok(init.signal);return response();},verify:async actual=>{checks++;assert.equal(actual.bvid,caption.bvid);return {verified:true};}}));
 assert.equal(prepare,1);assert.equal(files,1);assert.equal(checks,1);assert.equal(data.cues.at(-1).text,'最後一句');
});

test('expired Bilibili URL renews only the selected source once',async()=>{
 const renewed='https://aisubtitle.hdslb.com/bfs/ai_subtitle/selected.json?sign=NEW';let preparations=0,files=0;
 const data=await loadBilibiliSubtitle(options({prepare:async selection=>{assert.equal(selection.apiTrackId,'11');assert.equal(selection.refreshBilibiliSource,preparations>0);preparations++;return {...caption,url:preparations===1?url:renewed};},fetchFile:async source=>{files++;return files===1?response(403,'',source):response(200,body,source);}}));
 assert.equal(data.cues.length,2);assert.equal(files,2);assert.equal(preparations,2);
});

test('permanent file HTTP failure is specific and stops after two file attempts',async()=>{
 let files=0,preparations=0;
 await assert.rejects(loadBilibiliSubtitle(options({prepare:async()=>{preparations++;return {...caption};},fetchFile:async()=>{files++;return response(403,'');}})),error=>{assert.deepEqual(briefFailure(error),{code:'B05',message:'Could not read the subtitle file · HTTP 403'});return true;});
 assert.equal(files,2);assert.equal(preparations,2);
});

test('temporary CDN 503 retries the same file without re-querying the caption list',async()=>{
 let files=0,preparations=0;
 const value=await loadBilibiliSubtitle(options({prepare:async()=>{preparations++;return {...caption};},fetchFile:async source=>{files++;assert.equal(source,url);return files===1?response(503,''):response();}}));
 assert.equal(value.cues.length,2);assert.equal(files,2);assert.equal(preparations,1);
});

test('renewal list failure preserves API business code and never downloads a substitute',async()=>{
 let prepared=0,files=0;
 await assert.rejects(loadBilibiliSubtitle(options({prepare:async()=>{if(++prepared===2)throw Object.assign(new Error('BILI_LIST_API'),{code:'BILI_LIST_API',apiCode:-412,subtitleStage:'list'});return {...caption};},fetchFile:async()=>{files++;return response(404,'');}})),error=>{assert.deepEqual(briefFailure(error),{code:'B01',message:'The subtitle list API rejected the request · API -412'});return true;});
 assert.equal(files,1);assert.equal(prepared,2);
});

test('malformed JSON and invalid timelines stop immediately with no verification or retry',async()=>{
 for(const [raw,code] of [['<html>not subtitles</html>','BILI_FILE_INVALID'],[JSON.stringify({body:[{from:0,to:1000,content:'太長'}]}),'BILI_TIMELINE_INVALID'],[JSON.stringify({body:[]}),'BILI_FILE_EMPTY']]){
  let files=0,checks=0;
  await assert.rejects(loadBilibiliSubtitle(options({fetchFile:async()=>{files++;return response(200,raw);},verify:async()=>{checks++;return {verified:true};}})),error=>error.code===code);
  assert.equal(files,1);assert.equal(checks,0);
 }
});

test('blank HTTP body renews once then reports empty content separately',async()=>{
 let files=0;
 await assert.rejects(loadBilibiliSubtitle(options({fetchFile:async()=>{files++;return response(200,'');}})),error=>error.code==='BILI_FILE_EMPTY');
 assert.equal(files,2);
});

test('unsafe source and redirects are rejected before returning any cues',async()=>{
 let files=0;
 await assert.rejects(loadBilibiliSubtitle(options({prepare:async()=>({...caption,url:'https://example.com/private'}),fetchFile:async()=>{files++;return response();}})),error=>error.code==='BILI_SOURCE_REJECTED');assert.equal(files,0);
 await assert.rejects(loadBilibiliSubtitle(options({fetchFile:async()=>response(200,body,'https://example.com/redirect')})),error=>error.code==='BILI_SOURCE_REJECTED');
});

test('whole Bilibili pipeline deadline includes stalled preparation and verification',async()=>{
 for(const stage of ['list','verify']){
  const started=Date.now(),stalled=()=>new Promise(()=>{});
  await assert.rejects(loadBilibiliSubtitle(options({timeoutMs:35,...(stage==='list'?{prepare:stalled}:{verify:stalled})})),error=>error.code==='BILI_TIMEOUT'&&error.subtitleStage===stage);
  assert.ok(Date.now()-started<500);
 }
});

test('a real page change during file download rejects the data rather than saving it',async()=>{
 await assert.rejects(loadBilibiliSubtitle(options({verify:async()=>{throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED'});}})),error=>error.code==='SOURCE_CHANGED');
});

test('Bilibili source JSON keeps numeric original timestamps and Unicode text',()=>{
 assert.deepEqual(parseBilibiliSubtitle(body,60),[{start:0,end:1,text:'第一句'},{start:1,end:3,text:'最後一句'}]);
 assert.throws(()=>parseBilibiliSubtitle('{"body":[null]}'),error=>error.code==='BILI_FILE_INVALID');
});

test('unsorted overlapping cues and BOM are valid and sorted before export',()=>{
 const raw='\uFEFF'+JSON.stringify({body:[{from:10,to:12,content:'後'},{from:1,to:11,content:'前'},{from:10,to:12,content:'後'}]});
 assert.deepEqual(parseBilibiliSubtitle(raw,60),[{start:1,end:11,text:'前'},{start:10,end:12,text:'後'}]);
});
test('a JSON API error is not mislabeled as a broken subtitle JSON file',()=>{
 assert.throws(()=>parseBilibiliSubtitle('{"code":-412}'),error=>error.code==='BILI_FILE_API'&&error.apiCode===-412);
});

test('file timeouts keep a specific B09 even when DOMException has a numeric code',async()=>{
 await assert.rejects(loadBilibiliSubtitle(options({fetchFile:async()=>{throw new DOMException('timeout','TimeoutError');}})),e=>e.code==='BILI_TIMEOUT'&&briefFailure(e).code==='B09');
});
