import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPreviewInfo,mediaSignature,mediaCanInitialize} from '../src/media-registry.js';
import {RateController} from '../src/rate-controller.js';
import {normalizeSettings} from '../src/settings.js';

function card(attrs={},hrefs=[]){return {getAttribute:name=>attrs[name]??null,querySelectorAll:()=>hrefs.map(href=>({href,getAttribute:()=>href}))};}
function previewVideo(container,source='blob:preview'){
 return {currentSrc:source,src:source,closest(selector){
  if(selector.includes('ytd-video-preview')||selector.includes('bili-video-card'))return container;
  return null;
 }};
}
function target(href){return {location:{href}};}
class Video extends EventTarget{
 constructor(src='blob:first'){super();this.value=1;this.writes=0;this.readyState=1;this.paused=false;this.ended=false;this.currentSrc=src;}
 get playbackRate(){return this.value;}
 set playbackRate(value){this.writes++;this.value=value;queueMicrotask(()=>this.dispatchEvent(new Event('ratechange')));}
}
const settings=()=>normalizeSettings({defaultMode:'follow'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('YouTube card preview identity comes from its thumbnail link, while the route player stays normal',()=>{
 const owner=card({},['https://www.youtube.com/watch?v=previewA']);
 const video=previewVideo(owner);
 const info=mediaPreviewInfo(video,target('https://www.youtube.com/'));
 assert.equal(info?.platform,'youtube');assert.equal(info?.id,'previewA');assert.match(info.signature,/^preview:yt:previewA:/);
 assert.equal(mediaSignature(video,target('https://www.youtube.com/')),info.signature);
 const main={currentSrc:'blob:main',closest:selector=>selector==='#movie_player,.html5-video-player'?{}:null};
 assert.equal(mediaPreviewInfo(main,target('https://www.youtube.com/watch?v=main')),null);
 assert.equal(mediaSignature(main,target('https://www.youtube.com/watch?v=main')),'yt:main');
});

test('Bilibili video-card preview uses its card BV ID and leaves the player unclassified',()=>{
 const owner=card({'data-bvid':'BV1preview'}),video=previewVideo(owner);
 const info=mediaPreviewInfo(video,target('https://www.bilibili.com/'));
 assert.equal(info?.platform,'bilibili');assert.equal(info?.id,'BV1preview');
 const main={currentSrc:'blob:main',closest:selector=>selector==='.bpx-player-container,#bilibili-player,bwp-video'?{}:null};
 assert.equal(mediaPreviewInfo(main,target('https://www.bilibili.com/video/BV1main')),null);
 assert.equal(mediaSignature(main,target('https://www.bilibili.com/video/BV1main')),'bili:/video/BV1main:1');
});

test('a confirmed YouTube card preview is not blocked by the main-player readiness gate',()=>{
 const owner=card({},['https://www.youtube.com/watch?v=previewA']);
 const video={currentSrc:'blob:preview',closest(selector){
  if(selector.includes('ytd-video-preview'))return owner;
  if(selector==='#movie_player,.html5-video-player')return {classList:{contains:()=>false}};
  return null;
 },getAttribute:()=>null};
 assert.equal(mediaCanInitialize(video,target('https://www.youtube.com/watch?v=main')),true);
});

test('preview pause/reset and re-entry always use the followed rate without changing remembered rate',async()=>{
 const video=new Video(),remembered=[];video.paused=true;
 const controller=new RateController(video,settings(),{selected:true,lastRate:4,isPreview:()=>true,onRate:rate=>remembered.push(rate)});
 const start=()=>{video.paused=false;video.dispatchEvent(new Event('play'));assert.equal(video.playbackRate,4);};
 start();
 video.paused=true;video.dispatchEvent(new Event('pause'));video.playbackRate=1;await tick();
 assert.equal(controller.lastRate,4);assert.deepEqual(remembered,[]);
 start();
 video.paused=true;video.dispatchEvent(new Event('ended'));video.dispatchEvent(new Event('emptied'));video.playbackRate=1;await tick();
 assert.equal(controller.lastRate,4);assert.deepEqual(remembered,[]);
 video.currentSrc='blob:second-card';video.paused=false;video.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(video.playbackRate,4);assert.equal(controller.lastRate,4);assert.deepEqual(remembered,[]);controller.dispose();
});

test('preview extension commands do not replace the remembered default',()=>{
 const video=new Video(),remembered=[];
 const controller=new RateController(video,settings(),{selected:true,lastRate:4,isPreview:()=>true,onRate:rate=>remembered.push(rate)});
 controller.command('set',1.5);assert.equal(video.playbackRate,1.5);assert.equal(controller.lastRate,4);assert.deepEqual(remembered,[]);controller.dispose();
});

test('custom 4x default is reapplied to the next preview regardless of remembered rate',()=>{
 const video=new Video(),custom=normalizeSettings({defaultMode:'custom',customRate:4});video.paused=true;
 const controller=new RateController(video,custom,{selected:true,lastRate:1,isPreview:()=>true});
 video.paused=false;video.dispatchEvent(new Event('play'));assert.equal(video.playbackRate,4);
 video.paused=true;video.dispatchEvent(new Event('pause'));video.playbackRate=1;
 video.paused=false;video.dispatchEvent(new Event('play'));assert.equal(video.playbackRate,4);assert.equal(controller.lastRate,1);controller.dispose();
});

test('native 1x remains authoritative for a normal YouTube player',async()=>{
 const video=new Video(),remembered=[];
 const controller=new RateController(video,settings(),{selected:true,lastRate:4,isPreview:()=>false,onRate:rate=>remembered.push(rate)});
 assert.equal(video.playbackRate,4);video.playbackRate=1;
 controller.observe({origin:'user',status:'ready',actualRate:1,defaultRate:video.defaultPlaybackRate,mediaKey:controller.mediaKey,evidence:'native-rate-option'});await tick();
 assert.equal(controller.lastRate,1);assert.equal(remembered.at(-1),1);controller.dispose();
});
