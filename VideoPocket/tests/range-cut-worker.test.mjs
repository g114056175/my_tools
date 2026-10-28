import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('worker throttles validation sample counters while sending phase changes immediately',async()=>{
 const source=await fs.readFile(new URL('../extension/range-cut-worker.js',import.meta.url),'utf8'),messages=[];
 const context={importScripts(){},Date:{now:()=>1000},postMessage:message=>messages.push(message),VideoPocketRangeCut:{
  async cutRange({onActivity}){onActivity('initializing',0);onActivity('validating',0);for(let count=1;count<=100;count++)onActivity('validating',count);return {path:'cut.webm'};},cancel(){}
 }};
 vm.runInNewContext(source,context);await context.onmessage({data:{}});
 const activity=messages.filter(message=>message.type==='cutActivity');
 assert.deepEqual(activity.map(({stage,progress})=>[stage,progress]),[['initializing',0],['validating',0]]);
 assert.equal(messages.at(-1).type,'done');
});
