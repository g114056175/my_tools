import test from 'node:test';import assert from 'node:assert/strict';import {classifyFailure,briefFailure,visibleFailure,ERROR_VISIBILITY_MS} from '../extension/diagnostics.js';
test('Failures classify network, verification, storage and subtitle conditions',()=>{
 assert.equal(classifyFailure(new Error('HTTP 403 https://x/token')).code,'HTTP_AUTH');assert.equal(classifyFailure({name:'QuotaExceededError'}).code,'TEMP_STORAGE_FULL');assert.equal(classifyFailure(new Error('attestation required')).code,'STREAM_VERIFICATION');assert.equal(classifyFailure(new Error('影片已變更')).code,'SOURCE_CHANGED');assert.equal(classifyFailure(new Error('failed'),'subtitle').code,'SUBTITLE_UNAVAILABLE');
});
test('Compact display has fixed safe labels, expires quickly and ignores cancellation',()=>{
 const secret='SECRET_PRIVATE_VALUE';const r=briefFailure(new Error('HTTP 403 https://user:pass@host/video?token='+secret));assert.deepEqual(r,{code:'E01',message:'來源拒絕存取'});assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('host'));
 assert.deepEqual(briefFailure({code:'TEMP_STORAGE_FULL'}),{code:'E03',message:'本機暫存空間不足'});assert.equal(briefFailure({code:'CANCELLED'}),null);
 assert.ok(visibleFailure({time:1000,code:'TEMP_STORAGE_FULL'},1001));assert.equal(visibleFailure({time:1000,code:'TEMP_STORAGE_FULL'},1000+ERROR_VISIBILITY_MS),null);assert.equal(visibleFailure({time:Infinity,code:'INTERNAL_ERROR'},1001),null);
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
