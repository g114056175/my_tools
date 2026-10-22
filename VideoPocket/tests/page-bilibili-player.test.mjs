import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pageSnapshot} from '../extension/page.js';

async function snapshot({mini=true,other=true,selected=0,route='BVfixture01',stateBvid=route}={}){
 const host='www.bilibili.com',url=`https://${host}/video/${route}/?p=2`,requests=[];
 const video=(name,owned,visible,src=`blob:${name}`)=>({name,currentSrc:src,src:'',textTracks:[],mediaKeys:null,currentTime:25,duration:600,paused:!visible,readyState:4,
  closest:s=>owned&&s.includes('#bilibili-player')?{}:null,getAttribute:()=>null,hasAttribute:()=>false,querySelector:()=>null,querySelectorAll:()=>[],
  getBoundingClientRect:()=>({width:640,height:360,top:visible?100:-1000,left:0,bottom:visible?460:-640,right:640})});
 const main=video('main',true,!mini),floating=video('mini',true,true),advert=video('advert',false,true,'https://cdn.test/ad.mp4');
 const videos=[...(other?[advert]:[]),main,...(mini?[floating]:[])];
 const context={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,setTimeout,location:{href:url,hostname:host,pathname:`/video/${route}/`},navigator:{languages:['zh-TW']},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};
 context.window=context;
 context.__INITIAL_STATE__={videoData:{bvid:stateBvid,title:'正確的 Bilibili 標題',pages:[{cid:11,duration:100},{cid:22,duration:600}]}};
 context.document={title:'正確的 Bilibili 標題_哔哩哔哩_bilibili',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?videos:[]};
 context.fetch=async raw=>{const u=new URL(raw);requests.push(u);if(u.pathname.includes('/view'))return{ok:true,status:200,json:async()=>({code:0,data:{bvid:route,title:'新路由標題',pages:[{cid:33},{cid:44,duration:600}]}})};
  return{ok:true,status:200,json:async()=>({code:0,data:{bvid:route,cid:stateBvid===route?22:44,timelength:600000,dash:{video:[{baseUrl:'https://cdn.test/main.m4s'}]}}})};};
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})(${selected})`,context);
 return{page,requests,context,main,floating};
}

test('Bilibili floating/main players retain route metadata with an unrelated video present',async()=>{
 const{page,requests}=await snapshot();
 assert.equal(page.platform.site,'bilibili');assert.equal(page.platform.cid,22);assert.equal(page.platform.page,2);assert.ok(page.platform.data.dash.video.length);assert.equal(page.platform.sourceFailure,undefined);
 assert.equal(page.videos.length,3);assert.equal(page.videos[0].url,'blob:mini');
 for(const item of page.videos.filter(v=>v.bilibiliMain)){
  assert.equal(item.title,'正確的 Bilibili 標題');assert.equal(item.mediaIdentity,'bilibili:BVfixture01:2');assert.equal(item.downloadUrl,page.url);
 }
 assert.equal(page.videos.at(-1).bilibiliMain,undefined);assert.equal(page.videos.at(-1).downloadUrl,'https://cdn.test/ad.mp4');
 assert.equal(requests.filter(u=>u.pathname.endsWith('/playurl')).length,1);
});

test('selecting either owned Bilibili element resolves the same platform, but ads do not',async()=>{
 assert.equal((await snapshot({selected:1})).page.platform.cid,22);
 assert.equal((await snapshot({selected:2})).page.platform,undefined);
 assert.equal((await snapshot({mini:false})).page.platform.cid,22);
});

test('a mini player cannot reuse stale Bilibili SPA state or a previous part CID',async()=>{
 const{page,requests}=await snapshot({route:'BVnewRoute01',stateBvid:'BVoldRoute01'});
 assert.equal(page.platform.bvid,'BVnewRoute01');assert.equal(page.platform.cid,44);
 assert.equal(page.videos[0].title,'新路由標題');assert.equal(page.videos[0].mediaIdentity,'bilibili:BVnewRoute01:2');
 assert.equal(requests.find(u=>u.pathname.endsWith('/playurl')).searchParams.get('cid'),'44');
});

test('Bilibili bwp-video in an open shadow root is selected while an ad stays unrelated',async()=>{
 const host={tagName:'BWP-VIDEO',closest:s=>s.includes('bwp-video')?{}:null};
 const main={tagName:'VIDEO',currentSrc:'blob:main',src:'',textTracks:[],mediaKeys:null,currentTime:1,duration:600,paused:false,readyState:4,hasAttribute:()=>false,
  getRootNode:()=>({host}),closest:()=>null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360,top:100,left:0,bottom:460,right:640})};
 const ad={tagName:'VIDEO',currentSrc:'https://ads.test/ad.mp4',src:'',textTracks:[],mediaKeys:null,currentTime:0,duration:10,paused:false,readyState:4,hasAttribute:()=>false,
  getRootNode:()=>({host:null}),closest:()=>null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:320,height:180,top:0,left:0,bottom:180,right:320})};
 const shadow={querySelectorAll:s=>s==='video'?[main]:s==='*'?[main]:[]},hostWithShadow={...host,shadowRoot:shadow};main.getRootNode=()=>({host:hostWithShadow});
 const url='https://www.bilibili.com/video/BVshadow01/?p=2',context={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,location:{href:url,hostname:'www.bilibili.com',pathname:'/video/BVshadow01/'},navigator:{languages:['zh-TW']},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};context.window=context;
 context.__INITIAL_STATE__={videoData:{bvid:'BVshadow01',title:'Shadow 影片',pages:[{cid:11},{cid:22,duration:600}]}};
 context.document={title:'Shadow_哔哩哔哩_bilibili',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?[ad]:s==='*'?[hostWithShadow]:[]};
 context[Symbol.for('video-pocket.mediaObserver')]={videosSnapshot:()=>[main,ad]};
 context.fetch=async raw=>{const u=new URL(raw);return{ok:true,status:200,json:async()=>u.pathname.endsWith('/playurl')?{code:0,data:{bvid:'BVshadow01',cid:22,timelength:600000,dash:{video:[{baseUrl:'https://cdn.test/main.m4s'}]}}}:{code:0,data:{bvid:'BVshadow01',pages:[{cid:11},{cid:22,duration:600}]}}};};
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(page.platform.site,'bilibili');assert.equal(page.videos.find(v=>v.bilibiliMain)?.downloadUrl,page.url);assert.equal(page.videos.find(v=>v.url==='https://ads.test/ad.mp4')?.bilibiliMain,undefined);
});

test('Bilibili route context survives a closed shadow player without assigning an unknown blob',async()=>{
 const url='https://www.bilibili.com/video/BVclosed01/?p=2',video={tagName:'VIDEO',currentSrc:'blob:closed',src:'',textTracks:[],mediaKeys:null,currentTime:1,duration:600,paused:false,readyState:4,hasAttribute:()=>false,closest:()=>null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360,top:100,left:0,bottom:460,right:640})},ad={tagName:'VIDEO',currentSrc:'https://ads.test/ad.mp4',src:'',textTracks:[],mediaKeys:null,currentTime:0,duration:10,paused:false,readyState:4,hasAttribute:()=>false,closest:()=>null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:1,height:1,top:0,left:0,bottom:1,right:1})};
 const context={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,setTimeout,location:{href:url,hostname:'www.bilibili.com',pathname:'/video/BVclosed01/'},navigator:{languages:['zh-TW']},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};context.window=context;context.__INITIAL_STATE__={videoData:{bvid:'BVclosed01',title:'Closed 影片',pages:[{cid:11},{cid:22,duration:600}]}};context.document={title:'Closed_哔哩哔哩_bilibili',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?[video,ad]:[]};context.fetch=async raw=>{const u=new URL(raw);return{ok:true,status:200,json:async()=>u.pathname.endsWith('/playurl')?{code:0,data:{bvid:'BVclosed01',cid:22,timelength:600000,dash:{video:[{baseUrl:'https://cdn.test/main.m4s'}]}}}:{code:0,data:{bvid:'BVclosed01',pages:[{cid:11},{cid:22,duration:600}]}}};};
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(page.platform,undefined);assert.equal(page.bilibiliContext.bvid,'BVclosed01');assert.equal(page.bilibiliContext.cid,22);assert.equal(page.videos[0].downloadUrl,null);
 context.document.querySelectorAll=()=>[];const withoutElement=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(withoutElement.videos.length,0);assert.equal(withoutElement.media,null);assert.equal(withoutElement.bilibiliContext.cid,22);
});

test('Bilibili route context rejects an old BVID, page, or missing CID',async()=>{
 const url='https://www.bilibili.com/video/BVcurrent01/?p=2',video={tagName:'VIDEO',currentSrc:'blob:x',src:'',textTracks:[],mediaKeys:null,currentTime:0,duration:600,paused:false,readyState:4,hasAttribute:()=>false,closest:()=>null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:1,height:1,top:0,left:0,bottom:1,right:1})};
 const make=(state)=>{const c={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,location:{href:url,hostname:'www.bilibili.com',pathname:'/video/BVcurrent01/'},navigator:{languages:[]},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};c.window=c;c.__INITIAL_STATE__=state;c.document={title:'x',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?[video]:[]};c.fetch=async()=>({json:async()=>({code:-1})});return c;};
 const old=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,make({videoData:{bvid:'BVold01',pages:[{cid:1},{cid:2}]}}));assert.equal(old.bilibiliContext,undefined);
 const noPage=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,make({videoData:{bvid:'BVcurrent01',pages:[{cid:1}]}}));assert.equal(noPage.bilibiliContext,undefined);
});

test('Bilibili playurl retries one transient same-route failure and preserves the verified source',async()=>{
 const url='https://www.bilibili.com/video/BVretry01/?p=1',video={tagName:'VIDEO',currentSrc:'blob:main',src:'',textTracks:[],mediaKeys:null,currentTime:0,duration:60,paused:false,readyState:4,hasAttribute:()=>false,closest:s=>s.includes('#bilibili-player')?{}:null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360,top:10,left:0,bottom:370,right:640})};
 const context={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,setTimeout,location:{href:url,hostname:'www.bilibili.com',pathname:'/video/BVretry01/'},navigator:{languages:['zh-TW']},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};context.window=context;context.__INITIAL_STATE__={videoData:{bvid:'BVretry01',title:'Retry',pages:[{cid:17,duration:60}]}};context.document={title:'Retry',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?[video]:[]};let calls=0;
 context.fetch=async raw=>{const u=new URL(raw);if(u.pathname.endsWith('/playurl')){calls++;if(calls===1)return{ok:false,status:503,json:async()=>({})};return{ok:true,status:200,json:async()=>({code:0,data:{bvid:'BVretry01',cid:17,timelength:60000,dash:{video:[{baseUrl:'https://cdn.test/retry.m4s'}]}}})};}return{ok:false,status:500,json:async()=>({})};};
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(calls,2);assert.equal(page.platform.site,'bilibili');assert.equal(page.platform.cid,17);assert.equal(page.platform.data.dash.video[0].baseUrl,'https://cdn.test/retry.m4s');assert.equal(page.platform.sourceFailure,undefined);
});

test('Bilibili playurl refusal is retained as a safe source failure instead of empty generic media',async()=>{
 const url='https://www.bilibili.com/video/BVdenied01/?p=1',video={tagName:'VIDEO',currentSrc:'blob:main',src:'',textTracks:[],mediaKeys:null,currentTime:0,duration:60,paused:false,readyState:4,hasAttribute:()=>false,closest:s=>s.includes('#bilibili-player')?{}:null,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360,top:10,left:0,bottom:370,right:640})};
 const context={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,setTimeout,location:{href:url,hostname:'www.bilibili.com',pathname:'/video/BVdenied01/'},navigator:{languages:['zh-TW']},performance:{getEntriesByType:()=>[]},innerHeight:900,innerWidth:1200};context.window=context;context.__INITIAL_STATE__={videoData:{bvid:'BVdenied01',title:'Denied',pages:[{cid:18,duration:60}]}};context.document={title:'Denied',documentElement:{lang:'zh'},scripts:[],querySelector:()=>null,querySelectorAll:s=>s==='video'?[video]:[]};context.fetch=async()=>({ok:false,status:403,json:async()=>({})});
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(page.platform.site,'bilibili');assert.equal(page.platform.data,undefined);assert.equal(page.platform.sourceFailure.code,'HTTP_AUTH');assert.equal(page.platform.sourceFailure.httpStatus,403);assert.equal(page.platform.sourceFailure.sourceStage,'bilibili-playurl');
});

test('Bilibili empty metadata recovers once, bypasses cache and preserves CID',async()=>{
 const {context}=await snapshot({mini:false,other:false});let calls=0;
 context.fetch=async(raw,options)=>{assert.equal(options.cache,'no-store');calls++;return{ok:true,status:200,json:async()=>calls===1?{code:0,data:{}}:{code:0,data:{bvid:'BVfixture01',cid:22,dash:{video:[{baseUrl:'https://cdn.test/current.m4s'}]}}}};};
 const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(calls,2);assert.ok(page.platform.data.dash.video.length);assert.equal(page.platform.sourceFailure,undefined);
});
test('Bilibili refusal and API errors retain their cause without repeated requests',async()=>{
 for(const scenario of [{status:412,apiCode:undefined,code:'HTTP_AUTH'},{status:429,apiCode:undefined,code:'HTTP_RATE_LIMIT'},{status:200,apiCode:-403,code:'HTTP_AUTH'},{status:200,apiCode:-404,code:'SOURCE_UNAVAILABLE'}]){
  const {context}=await snapshot({mini:false,other:false});let calls=0;context.fetch=async()=>{calls++;return{ok:scenario.status===200,status:scenario.status,json:async()=>({code:scenario.apiCode})};};
  const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(calls,1);assert.equal(page.platform.data,undefined);assert.equal(page.platform.sourceFailure.code,scenario.code);assert.equal(page.platform.sourceFailure.sourceStage,'bilibili-playurl');
 }
});
test('Bilibili retry never accepts a changed route or changed CID',async()=>{
 for(const changeCid of [false,true]){
  const {context}=await snapshot({mini:false,other:false});let calls=0;context.fetch=async()=>{calls++;if(changeCid)context.__INITIAL_STATE__.videoData.pages[1].cid=99;else context.location.href='https://www.bilibili.com/video/BVother01/?p=2';return{ok:false,status:503};};
  const page=await vm.runInNewContext(`(${pageSnapshot.toString()})()`,context);assert.equal(calls,1);
  if(changeCid){assert.equal(page.platform.data,undefined);assert.equal(page.platform.sourceFailure.code,'SOURCE_CHANGED');}else{assert.equal(page.platform,undefined);assert.equal(page.bilibiliContext,undefined);}
 }
});
