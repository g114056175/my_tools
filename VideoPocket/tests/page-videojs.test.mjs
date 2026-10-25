import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSnapshot} from '../extension/page.js';

const absent=Symbol('absent');

function video({title='影片',src='blob:video',currentSrc=src,id}={}){
  const v={
    title,src,textTracks:[],
    querySelector:()=>null,
    querySelectorAll:selector=>selector==='source'?[]:[],
    getAttribute:()=>null,
    hasAttribute:()=>false,
    closest:()=>null,
  };
  if(id)v.getAttribute=name=>name==='id'?id:null;
  Object.defineProperty(v,'currentSrc',{configurable:true,get:()=>currentSrc});
  return v;
}

function documentFor(videos,wrappers=[],title='MMOV'){
  return {
    title,
    scripts:[],
    documentElement:{lang:'zh-Hant'},
    querySelector:selector=>selector==='#movie_player'?null:null,
    querySelectorAll:selector=>selector==='video'?videos:(selector==='.video-js,video-js'?wrappers:[]),
  };
}

async function snapshot({videos,players=[],wrappers=[],resources=[],observer,evidence,mediaIndex=0,pageUrl='https://hk.mmov.io/vodplay/416398/6-1.html',pageTitle='MMOV',mode='deep',budget={}}){
  const saved=new Map();
  const values={document:documentFor(videos,wrappers,pageTitle),window:{videojs:players.length?{getAllPlayers:()=>players}:undefined},location:{href:'https://hk.mmov.io/vodplay/416398/6-1.html',hostname:'hk.mmov.io',origin:'https://hk.mmov.io',pathname:'/vodplay/416398/6-1.html',search:''},performance:{getEntriesByType:kind=>kind==='resource'?resources.map(name=>({name})):[]}};
  const url=new URL(pageUrl);values.location={href:url.href,hostname:url.hostname,origin:url.origin,pathname:url.pathname,search:url.search};
  if(observer)values.window[Symbol.for('video-pocket.mediaObserver')]=observer;
  if(evidence)values.window[Symbol.for('video-pocket.sourceEvidence')]=evidence;
  for(const [key,value] of Object.entries(values)){
    saved.set(key,Object.prototype.hasOwnProperty.call(globalThis,key)?globalThis[key]:absent);
    globalThis[key]=value;
  }
  try{return await pageSnapshot(mediaIndex,mode,budget);}finally{
    for(const [key,value] of saved){if(value===absent)delete globalThis[key];else globalThis[key]=value;}
  }
}

test('focused discovery retains the media inventory and skips broad model scans and metadata queues',{concurrency:false},async()=>{
 const a=video({title:'Actual title'}),b=video(),fail=()=>assert.fail('focused source must not run broad exploration');
 const earlyPlatform={site:'network-media',binding:'generic-early',title:'Current playlist title',versions:[{url:'https://cdn.test/main.mp4'}]};
 const p=await snapshot({videos:[a,b],mode:'focused',budget:{earlyPlatform},observer:{scanDocument:fail,drainMetadata:fail,modelFor:fail,sourcesFor:fail,diagnosticsFor:fail}});
 assert.equal(p.platform,earlyPlatform);assert.equal(p.videos.length,2);assert.equal(p.media.discoveryDiagnostics.explorationReason,'player-first');assert.equal(p.media.discoveryDiagnostics.count,0);
 assert.equal(p.videos[0].title,'Current playlist title');assert.notEqual(p.videos[1].title,'Current playlist title');
});

test('a missing feed source carries only its exact same-origin player permalink',{concurrency:false},async()=>{
 const a=video({src:''}),b=video({src:''}),observer={scanDocument(){},modelFor:()=>null,sourcesFor:()=>({candidates:[]})};
 const options={videos:[a,b],observer,pageUrl:'https://www.facebook.com/public',evidence:{collectMediaEvidence:({video:v})=>({identity:{id:v===a?'123':'456',key:v===a?'fb:123':'fb:456',anchor:v===a?'https://www.facebook.com/reel/123/':'https://other.example/reel/456/'}})}};
 const result=await snapshot(options);
 assert.deepEqual(result.videos[0].linkedMedia,{url:'https://www.facebook.com/reel/123/',id:'123'});
 assert.equal(result.videos[1].linkedMedia,undefined);
 assert.equal(result.videos[0].downloadUrl,null,'permalink is not itself a downloadable video');
});

test('generic observer source belongs to the selected video, not global resource guesses',{concurrency:false},async()=>{
 const a=video(),b=video();
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:v=>({candidates:v===b?[{url:'https://cdn/endpoint',kind:'dash',downloadable:true}]:[],reason:'no-associated-source'})};
 const page=await snapshot({videos:[a,b],observer,mediaIndex:1,resources:['https://ads/ad.m3u8'],pageUrl:'https://new.example/feed'});
 assert.equal(page.videos[0].downloadUrl,null);assert.equal(page.videos[1].downloadUrl,'https://cdn/endpoint');assert.equal(page.videos[1].sourceType,'dash');
 const model={id:'post-b',versions:[{url:'https://cdn/post-b.mp4'}]};observer.modelFor=v=>v===b?model:null;
 const selected=await snapshot({videos:[a,b],observer,mediaIndex:1,pageUrl:'https://new.example/feed'});assert.equal(selected.platform.id,'post-b');assert.equal(selected.platform.site,'embedded');
 const first=await snapshot({videos:[a,b],observer,mediaIndex:0,pageUrl:'https://new.example/feed'});assert.equal(first.platform,undefined);
});

test('page snapshot preserves source candidates per player without cross-player borrowing',{concurrency:false},async()=>{
 const a=video({title:'A'}),b=video({title:'B'});
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:v=>({candidates:[{url:v===a?'https://cdn/a.m3u8':'https://cdn/b.m3u8',kind:'hls',downloadable:true,evidence:['player-owned-source'],sourceGroup:'player-current-sources'}]})};
 const page=await snapshot({videos:[a,b],observer,mediaIndex:0,pageUrl:'https://player.example/feed'});
 assert.deepEqual(page.videos[0].sourceCandidates.map(item=>item.url),['https://cdn/a.m3u8']);
 assert.deepEqual(page.videos[1].sourceCandidates,[],'unselected player is kept as a summary entry');
 assert.equal(page.videos[0].sourceCandidates[0].sourceGroup,'player-current-sources');
});

test('an empty source resolves to the document URL in the DOM but cannot preempt the observed manifest',async()=>{
 const pageUrl='https://player.example.test/watch',v=video(),empty={src:pageUrl,getAttribute:()=>''},manifest='https://cdn.example.test/main.m3u8';
 v.querySelectorAll=selector=>selector==='source'?[empty]:[];
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:()=>({candidates:[{url:manifest,kind:'hls',downloadable:true}]})};
 const result=await snapshot({videos:[v],observer,pageUrl});assert.equal(result.videos[0].downloadUrl,manifest);
 const valid={src:'https://cdn.example.test/main.mp4',getAttribute:()=>'/main.mp4'};
 v.querySelectorAll=selector=>selector==='source'?[empty,valid]:[];
 const direct=await snapshot({videos:[v],pageUrl});assert.equal(direct.videos[0].downloadUrl,valid.src);
});

test('a live low-quality HLS child does not replace the bound full quality manifest',async()=>{
 const v=video(),master='https://cdn.test/master.m3u8',child='https://cdn.test/360.m3u8';
 const observer={scanDocument(){},modelFor:()=>({id:'current',manifestUrl:master,manifestType:'hls',manifestXml:'master fixture'}),sourcesFor:()=>({candidates:[{url:child,kind:'hls',downloadable:true,evidence:['mse-root']}]})};
 const page=await snapshot({videos:[v],observer});
 assert.equal(page.platform.manifestUrl,master);assert.equal(page.platform.manifestXml,'master fixture');
 assert.deepEqual(page.platform.playbackManifest,{url:child,type:'hls'});
});

test('Dailymotion main player is selected before ads and only its context becomes a metadata request',{concurrency:false},async()=>{
 const main=video({id:'video',title:''}),ad=video({title:'Advertisement'});
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:()=>({candidates:[],reason:'no-associated-source'}),pageContext:()=>({id:'x9qh9tw',title:'Current episode'})};
 const options={videos:[ad,main],observer,pageUrl:'https://geo.dailymotion.com/player/xtv3w.html?video=x9qh9tw'};
 const page=await snapshot(options);assert.equal(page.platform.site,'dailymotion');assert.equal(page.platform.id,'x9qh9tw');
 assert.equal(page.videos[0].dailymotionMain,true);assert.equal(page.videos[0].title,'Current episode');
 assert.equal(page.videos[1].dailymotionMain,undefined);
 const advertising=await snapshot({...options,mediaIndex:1});assert.equal(advertising.platform,undefined);
});

test('Dailymotion carries only a proven main-player source, including an iframe without a route ID',{concurrency:false},async()=>{
 const main=video({id:'video'}),ad=video({title:'Advertisement'}),manifest='https://vod.dmcdn.net/main.m3u8';
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:v=>({candidates:[{url:v===main?manifest:'https://ads.example/ad.m3u8',kind:'hls',downloadable:true,evidence:['mse-root']}]})};
 const options={videos:[ad,main],observer,pageUrl:'https://geo.dailymotion.com/player/xtv3w.html?'};
 const page=await snapshot(options);assert.equal(page.platform,undefined);assert.deepEqual(page.videos[0].observedSource,{url:manifest,type:'hls'});
 observer.pageContext=()=>({id:'x9qh9tw',title:'Episode'});
 assert.deepEqual((await snapshot(options)).platform.observedSource,{url:manifest,type:'hls'});
 observer.sourcesFor=()=>({candidates:[{url:manifest,kind:'hls',downloadable:true,evidence:['embedded-model.manifestUrl']}]});
 assert.equal((await snapshot(options)).platform.observedSource,undefined,'unassociated metadata must not become main-player playback proof');
});

function playerFor(v,source,{currentSrc=source,currentSource=()=>({src:source})}={}){
  return {el:()=>({contains:node=>node===v}),currentSource,currentSrc:()=>currentSrc,currentSources:()=>[],play:()=>{throw new Error('play must not be called')},pause:()=>{throw new Error('pause must not be called')},currentTime:()=>{throw new Error('seek must not be called')}};
}

test('Video.js exact player supplies MMOV master when video element is blob',{concurrency:false},async()=>{
  const master='https://hk.mmov.io/hls/main/master.m3u8?token=1';
  const v=video();
  let controls=0;
  const p={el:()=>v,currentSource:()=>{controls++;return {src:master}},currentSrc:()=>{controls++;return 'blob:player'},currentSources:()=>{controls++;return []},play:()=>{controls++;},pause:()=>{controls++;}};
  const page=await snapshot({videos:[v],players:[p],resources:[master,'https://hk.mmov.io/hls/main/720p/index.m3u8','https://ads.example/ad/master.m3u8']});
  assert.equal(page.videos[0].downloadUrl,master);
  assert.equal(controls,1);
});

test('two videos use only the Video.js player attached to the selected video',{concurrency:false},async()=>{
  const firstMaster='https://hk.mmov.io/hls/main/master.m3u8';
  const secondMaster='https://ads.example/ad/master.m3u8';
  const first=video({title:'主片'}),second=video({title:'廣告'});
  const page=await snapshot({videos:[first,second],players:[playerFor(first,firstMaster),playerFor(second,secondMaster)],resources:[firstMaster,secondMaster]});
  assert.equal(page.videos[0].downloadUrl,firstMaster);
  assert.equal(page.videos[1].downloadUrl,null,'unselected player registry is not explored');
  const selected=await snapshot({videos:[first,second],players:[playerFor(first,firstMaster),playerFor(second,secondMaster)],mediaIndex:1,resources:[firstMaster,secondMaster]});
  assert.equal(selected.videos[1].downloadUrl,secondMaster);
  assert.equal(selected.videos[0].downloadUrl,null);
});

test('multiple performance manifests without a player registry remain ambiguous',{concurrency:false},async()=>{
  const v=video();
  const page=await snapshot({videos:[v],resources:['https://hk.mmov.io/hls/main/master.m3u8','https://hk.mmov.io/hls/main/720p/index.m3u8']});
  assert.equal(page.videos[0].downloadUrl,null);
});

test('currentSrc is used when Video.js currentSource is unavailable',{concurrency:false},async()=>{
  const master='https://hk.mmov.io/hls/main/master.m3u8';
  const v=video();
  let currentSourceCalls=0,currentSrcCalls=0;
  const p={el:()=>v,currentSource:()=>{currentSourceCalls++;throw new Error('source not ready')},currentSrc:()=>{currentSrcCalls++;return master},currentSources:()=>[]};
  const page=await snapshot({videos:[v],players:[p],resources:[master,'https://hk.mmov.io/hls/main/720p/index.m3u8']});
  assert.equal(page.videos[0].downloadUrl,master);
  assert.equal(currentSourceCalls,1);
  assert.equal(currentSrcCalls,1);
});

test('module-scoped DOM-attached Video.js player supplies its active VHS source',{concurrency:false},async()=>{
  const master='https://hk.mmov.io/hls/main/master.m3u8';
  const v=video({src:'https://hk.mmov.io/hls/welcome_to_anigamer.m3u8',currentSrc:'blob:video'});
  const wrapper={contains:node=>node===v,player:null};
  const p={el:()=>wrapper,tech_:{vhs:{source_:{src:master}}},currentSource:()=>({src:'https://hk.mmov.io/hls/welcome.m3u8'})};
  wrapper.player=p;
  const page=await snapshot({videos:[v],wrappers:[wrapper],resources:[master]});
  assert.equal(page.videos[0].downloadUrl,master);
});

test('tech exact ownership prevents a wrapper player from matching its ad video',{concurrency:false},async()=>{
  const master='https://hk.mmov.io/hls/main/master.m3u8';
  const main=video({title:'主片'}),ad=video({title:'廣告'});
  const wrapper={contains:node=>node===main||node===ad,player:null};
  const tech={el:()=>main};
  const p={el:()=>wrapper,tech_:tech,source_:{src:master}};
  wrapper.player=p;main.player=p;ad.player=p;
  const page=await snapshot({videos:[main,ad],wrappers:[wrapper],resources:[master]});
  assert.equal(page.videos[0].downloadUrl,master);
  assert.equal(page.videos[1].downloadUrl,null);
});

test('active VHS source wins over a stale welcome currentSource',{concurrency:false},async()=>{
  const active='https://hk.mmov.io/hls/main/master.m3u8',stale='https://hk.mmov.io/hls/welcome.m3u8';
  const v=video(),p={el:()=>v,source_:{src:active},currentSource:()=>({src:stale}),currentSrc:()=>stale};
  const page=await snapshot({videos:[v],players:[p]});
  assert.equal(page.videos[0].downloadUrl,active);
});

test('throwing Video.js getters are ignored without playback controls',{concurrency:false},async()=>{
  const master='https://hk.mmov.io/hls/main/master.m3u8',v=video();
  const p={el:()=>v,currentSource:()=>{throw new Error('source unavailable')},currentSrc:()=>master,currentSources:()=>{throw new Error('sources unavailable')}};
  Object.defineProperty(p,'source_',{get(){throw new Error('source getter unavailable')}});
  const page=await snapshot({videos:[v],players:[p]});
  assert.equal(page.videos[0].downloadUrl,master);
});

test('Ani Gamer main video is first and uses the page title',{concurrency:false},async()=>{
  const main=video({id:'ani_video_html5_api',title:'主片'}),ad1=video({title:'廣告一'}),ad2=video({title:'廣告二'});
  const page=await snapshot({videos:[ad1,ad2,main],pageUrl:'https://ani.gamer.com.tw/animeVideo.php?sn=123',pageTitle:'精彩動畫 線上看 - 巴哈姆特動畫瘋'});
  assert.equal(page.mediaIndex,0);
  assert.equal(page.videos[0].title,'精彩動畫');
  assert.equal(page.videos[1].title,'廣告一');
  assert.equal(page.videos[2].title,'廣告二');
});

test('unplayed Anime1 video supplies its exact API descriptor without starting playback',{concurrency:false},async()=>{
 const v=video({src:'',currentSrc:''}),token=encodeURIComponent(JSON.stringify({c:1958,e:8,s:'fixture'}));
 v.getAttribute=name=>name==='data-apireq'?token:null;
 v.play=()=>{throw Error('must not play')};v.load=()=>{throw Error('must not load')};
 const result=await snapshot({videos:[v],pageUrl:'https://anime1.me/30114'});
 assert.equal(result.videos[0].downloadUrl,null);
 assert.equal(result.platform.site,'anime1');assert.equal(result.platform.apiRequest,token);
});

test('generic Reddit player labels are replaced by the owning post title or a numbered placeholder',async()=>{
 const named=video({title:'影片播放器'}),unnamed=video({title:'影片播放器'});
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:()=>({candidates:[]}),titleFor:v=>v===named?'Actual Reddit post':'',isGenericTitle:t=>t==='影片播放器'};
 const result=await snapshot({videos:[named,unnamed],observer,pageUrl:'https://www.reddit.com/r/example/'});
 assert.equal(result.videos[0].title,'Actual Reddit post');assert.equal(result.videos[1].title,'影片 2');
});

test('Twitch channel trailer and Clips use only their selected player metadata',async()=>{
 const trailer=video(),clip=video(),ad=video({title:'Advertisement'});
 const observer={scanDocument(){},modelFor:()=>null,sourcesFor:()=>({candidates:[]}),twitchPlayerFor:v=>v===trailer?{kind:'vod',id:'123456',title:'Channel trailer',duration:58}:v===clip?{kind:'clip',slug:'ClipSlug',title:'Actual clip',qualities:[]}:null};
 const base={videos:[trailer,clip,ad],observer,pageUrl:'https://www.twitch.tv/twitch/clips?range=7d'};
 const first=await snapshot(base);assert.equal(first.platform.site,'twitch');assert.equal(first.platform.id,'123456');assert.equal(first.videos[0].title,'Channel trailer');
 const second=await snapshot({...base,mediaIndex:1});assert.equal(second.platform.site,'twitch-clip');assert.equal(second.platform.slug,'ClipSlug');assert.equal(second.videos[1].mediaIdentity,'twitch-clip:ClipSlug');
 const advertising=await snapshot({...base,mediaIndex:2});assert.equal(advertising.platform,undefined);
});
