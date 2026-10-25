import test from 'node:test';import assert from 'node:assert/strict';import {classifyFailure,briefFailure,visibleFailure,ERROR_VISIBILITY_MS,ERROR_RETENTION_MS} from '../extension/diagnostics.js';
test('Failures classify network, verification, storage and subtitle conditions',()=>{
 assert.equal(classifyFailure(new Error('HTTP 403 https://x/token')).code,'HTTP_AUTH');assert.equal(classifyFailure({name:'QuotaExceededError'}).code,'TEMP_STORAGE_FULL');assert.equal(classifyFailure(new Error('attestation required')).code,'STREAM_VERIFICATION');assert.equal(classifyFailure(new Error('影片已變更')).code,'SOURCE_CHANGED');assert.equal(classifyFailure(new Error('failed'),'subtitle').code,'SUBTITLE_UNAVAILABLE');
 const request=classifyFailure(new Error('來源讀取失敗（HTTP 403，GET Range，v16m.tiktokcdn.com），請重新整理影片'));
 assert.equal(request.httpStatus,403);assert.equal(request.requestMethod,'GET RANGE');assert.equal(request.requestHost,'v16m.tiktokcdn.com');
 const unsafe=classifyFailure(new Error('來源讀取失敗（HTTP 403，GET Range，user:pass@cdn.example/token?secret=x）'));
 assert.equal(unsafe.requestHost,undefined);
});

test('bare transport AbortError is not user cancellation, while explicit cancellation is',()=>{
 assert.equal(classifyFailure(new DOMException('The operation was aborted','AbortError')).code,'NETWORK_FAILURE');
 assert.equal(classifyFailure(new DOMException('timeout','TimeoutError')).code,'NETWORK_TIMEOUT');
 assert.equal(classifyFailure(Object.assign(new Error('已取消'),{code:'CANCELLED'})).code,'CANCELLED');
 assert.equal(classifyFailure(Object.assign(new Error('已取消'),{userCancelled:true})).code,'CANCELLED');
});
test('linked-document diagnostics survive RPC classification without accepting arbitrary strings',()=>{
 const result=classifyFailure({code:'SOURCE_UNAVAILABLE',sourceStage:'linked-no-model',message:'private payload'});
 assert.equal(classifyFailure(result).sourceStage,'linked-no-model');
 assert.equal(classifyFailure({...result,sourceStage:'https://private.example/?token=secret'}).sourceStage,undefined);
 assert.ok(!JSON.stringify(result).includes('private payload'));
});

test('save diagnostics retain bounded stages and causes without paths or raw native errors',()=>{
 const failure=classifyFailure({code:'SAVE_FAILED',saveStage:'close-target',saveReason:'permission',message:'C:/private/SECRET.mp4'});
 assert.equal(classifyFailure(failure).saveStage,'close-target');assert.equal(classifyFailure(failure).saveReason,'permission');
 assert.deepEqual(briefFailure(failure),{code:'E06',message:'檔案儲存失敗 · 儲存權限失效'});
 assert.ok(!JSON.stringify(failure).includes('SECRET'));
 const unsafe=classifyFailure({...failure,saveStage:'C:/private',saveReason:'SECRET'});
 assert.equal(unsafe.saveStage,undefined);assert.equal(unsafe.saveReason,undefined);
});

test('browser filename and native file interruptions retain precise safe causes',()=>{
 const invalid=classifyFailure(new Error('Invalid filename'),'save');
 assert.equal(invalid.code,'SAVE_FAILED');assert.equal(invalid.saveReason,'invalid-filename');
 assert.deepEqual(briefFailure(invalid),{code:'E06',message:'檔案儲存失敗 · 檔名不受支援'});
 for(const [message,reason] of [['FILE_ACCESS_DENIED','permission'],['FILE_NO_SPACE','disk-full'],['FILE_TOO_LARGE','file-too-large'],['FILE_BLOCKED','blocked']]){
  const result=classifyFailure({message,saveStage:'browser-write'},'save');
  assert.equal(result.saveStage,'browser-write');assert.equal(result.saveReason,reason);assert.equal(classifyFailure(result).saveReason,reason);
 }
 const unknown=classifyFailure(new Error('C:/private/SECRET.mp4'),'save');
 assert.equal(unknown.saveReason,'unknown');assert.doesNotMatch(JSON.stringify(unknown),/SECRET|private/);
});
test('Compact display has fixed safe labels, expires quickly and ignores cancellation',()=>{
 const secret='SECRET_PRIVATE_VALUE';const r=briefFailure(new Error('HTTP 403 https://user:pass@host/video?token='+secret));assert.deepEqual(r,{code:'E01',message:'來源拒絕存取'});assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('host'));
 assert.deepEqual(briefFailure({code:'TEMP_STORAGE_FULL'}),{code:'E03',message:'本機暫存空間不足'});assert.equal(briefFailure({code:'CANCELLED'}),null);
 assert.ok(visibleFailure({time:1000,code:'TEMP_STORAGE_FULL'},1001));assert.equal(visibleFailure({time:1000,code:'TEMP_STORAGE_FULL'},1000+ERROR_RETENTION_MS),null);assert.equal(visibleFailure({time:Infinity,code:'INTERNAL_ERROR'},1001),null);
});

test('Bilibili and YouTube diagnostics retain safe numeric causes across storage and popup rendering',()=>{
 const secret='https://private.example/?sign=SECRET';
 const detail=classifyFailure({code:'BILI_LIST_API',message:secret,apiCode:-412,subtitleStage:'list',url:secret});
 assert.deepEqual(briefFailure(detail),{code:'B01',message:'字幕清單 API 拒絕請求 · API -412'});
 assert.ok(!JSON.stringify(detail).includes('SECRET'));
 const http=classifyFailure({code:'BILI_FILE_HTTP',status:403,subtitleStage:'file'});
 assert.deepEqual(briefFailure(http),{code:'B05',message:'字幕檔讀取失敗 · HTTP 403'});
 assert.deepEqual(briefFailure({code:'YT_FILE_HTTP',httpStatus:403}),{code:'YT02',message:'YouTube 字幕讀取失敗 · HTTP 403'});
 const unsafe=classifyFailure({code:'BILI_LIST_API',apiCode:secret,status:9999,subtitleStage:secret});
 assert.equal(unsafe.apiCode,undefined);assert.equal(unsafe.httpStatus,undefined);assert.equal(unsafe.subtitleStage,undefined);
});

test('unseen failures survive popup closure and preserve safe Bilibili playback detail',()=>{
 assert.ok(visibleFailure({time:1000,code:'HTTP_AUTH'},1000+ERROR_VISIBILITY_MS+1));
 const result=classifyFailure({code:'HTTP_AUTH',status:403,sourceStage:'bilibili-playurl',requestMethod:'GET',requestHost:'api.bilibili.com'});
 assert.equal(classifyFailure(result).sourceStage,'bilibili-playurl');
});

test('empty YouTube captions give an actionable language and subtitle hint',()=>{
 const value=briefFailure({code:'YT_FILE_EMPTY',message:'private response'});
 assert.equal(value.code,'YT03');assert.equal(value.message,'未取得字幕，請開啟字幕並切換為所選語言');
});
